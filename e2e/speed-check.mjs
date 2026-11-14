// The server's speed work, against a real server (release/server.mjs) on a small vault of its own:
//   - the text search (server/search.ts) finds exactly what shared/search-text.ts finds in the same texts, for words of
//     every kind, and follows notes that are changed, made and deleted;
//   - /api/notes gives the notes as they are on disk;
//   - /api/thumb makes small WebP copies (kept on disk), refuses what is not a picture;
//   - /api/file tells the browser "unchanged" (304) and names versioned files immutable;
//   - a host the server cannot reach (here: a proxy that refuses) is tried once, then answered at once for a few minutes, for link cards and covers alike;
//   - the slowness log ([perf]): what the page reports, and a large answer.
//   node e2e/speed-check.mjs [release-folder]      (the folder needs `sharp` reachable from it, as in the repo's release/)
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { ROOT } from './helpers.mjs'

const release = path.resolve(process.argv[2] ?? path.join(ROOT, 'release'))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-speed-'))
const vault = path.join(dir, 'vault')
fs.mkdirSync(path.join(vault, 'Заметки'), { recursive: true })
fs.mkdirSync(path.join(vault, 'img'), { recursive: true })

// ---- the reference: the shared module, run directly on the texts
await build({ entryPoints: [path.join(ROOT, 'shared', 'search-text.ts')], outfile: path.join(dir, 'search-text.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'error' })
const { WordSet } = await import(path.join(dir, 'search-text.mjs'))

const notes = {
  'Alpha.md': 'The theory of everything.\nA theme, then the other thing.\nthere is nothing here',
  'Заметки/Видео про FNAF.md': 'Теория игры Five Nights at Freddy\'s.\nВидео про theory и FNAF.\nНичего больше.',
  'Заметки/Пунктуация.md': 'foo-bar and foo.bar, also "five nights" and Five\nNights apart.\nan a at',
  'Sigma.md': 'ΟΔΟΣ και οδός. Σίσυφος.',
  'Empty.md': '',
  'Long.md': Array.from({ length: 400 }, (_, i) => `line ${i} with the word theory ${i % 7 === 0 ? 'and five nights' : ''}`).join('\n'),
}
for (const [file, text] of Object.entries(notes)) fs.writeFileSync(path.join(vault, file), text)
// A picture much larger than a card needs, and a file that is not one.
await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 10, g: 80, b: 160 } } })
  .composite([{ input: await sharp({ create: { width: 1200, height: 800, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer(), left: 300, top: 200 }])
  .png()
  .toFile(path.join(vault, 'img', 'big.png'))
fs.writeFileSync(path.join(vault, 'img', 'fake.png'), 'this is not a picture')
fs.writeFileSync(path.join(vault, 'img', 'large.bin'), Buffer.alloc(4_000_000, 1))

// ---- the server
const port = 4796
let log = ''
const server = spawn(process.execPath, [path.join(release, 'server.mjs')], {
  env: { ...process.env, FLINT_VAULT: vault, FLINT_PORT: String(port), FLINT_CONFIG: path.join(dir, 'config.json'), FLINT_CACHE: path.join(dir, 'cache'), FLINT_AUTOSTART_DIR: path.join(dir, 'autostart'), FLINT_NO_OPEN: '1', FLINT_WATCH: 'native', HTTPS_PROXY: 'http://127.0.0.1:9' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))
for (let i = 0; i < 150 && !(await fetch(`http://localhost:${port}/api/build`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200))
const base = `http://localhost:${port}/api`

const results = []
const ok = (name, passed, detail = '') => {
  results.push(passed)
  console.log(`${passed ? '✓' : '✗'} ${name}${passed ? '' : `\n    ${detail}`}`)
}
const post = (route, body, headers = {}) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  // ---- search
  const reference = (words) =>
    Object.entries(current)
      .map(([file, text]) => ({ file, hit: new WordSet(words).scan(text, false) }))
      .filter(({ hit }) => hit.mask)
      .map(({ file, hit }) => [file, hit.mask, hit.phrase ? 1 : 0, hit.total])
      .sort((a, b) => a[0].localeCompare(b[0]))
  const asked = async (words) => ((await (await post('search/text', { words })).json()))
  const sorted = (rows) => [...rows].sort((a, b) => a[0].localeCompare(b[0]))
  let current = { ...notes }

  const queries = [['theory'], ['the'], ['a'], ['at'], ['five', 'nights'], ['foo-bar'], ['foo.bar'], ['теория'], ['видео', 'fnaf'], ['οδοσ'], ['ΟΔΟΣ'], ['th'], ['nothing', 'here'], ['zzzzqq'], ['line', 'theory', 'nights']]
  for (const words of queries) {
    const got = sorted(await asked(words))
    const want = reference(words)
    ok(`search ${JSON.stringify(words)} finds what the shared module finds (${want.length} notes)`, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`)
  }
  const lines = await (await post('search/text', { words: ['five', 'nights'], lines: ['Заметки/Пунктуация.md', 'Long.md', 'Nope.md'] })).json()
  const wantLines = new WordSet(['five', 'nights']).scan(notes['Long.md'], true).matches
  ok('the lines of a note are the shared module\'s, at most five; a note that is not there says nothing', JSON.stringify(lines['Long.md']) === JSON.stringify(wantLines) && wantLines.length === 5 && !('Nope.md' in lines), JSON.stringify(lines))
  ok('too many words, or words that are not words, are refused', (await post('search/text', { words: Array(9).fill('a') })).status === 400 && (await post('search/text', { words: [1] })).status === 400 && (await post('search/text', {})).status === 400)

  // A note changed, made and deleted on disk: the next answer follows.
  const until = async (check) => {
    for (let i = 0; i < 40; i++) {
      if (await check()) return true
      await sleep(150)
    }
    return false
  }
  fs.writeFileSync(path.join(vault, 'Alpha.md'), 'Completely different: xylophone.')
  current['Alpha.md'] = 'Completely different: xylophone.'
  ok('a changed note is found by its new words and no longer by its old ones', await until(async () => (await asked(['xylophone'])).length === 1 && !(await asked(['everything'])).length))
  fs.writeFileSync(path.join(vault, 'Нова.md'), 'Совсем новая заметка про xylophone')
  current['Нова.md'] = 'Совсем новая заметка про xylophone'
  ok('a new note is found', await until(async () => JSON.stringify(sorted(await asked(['xylophone']))) === JSON.stringify(reference(['xylophone']))))
  fs.rmSync(path.join(vault, 'Нова.md'))
  delete current['Нова.md']
  ok('a deleted note is not found any more', await until(async () => (await asked(['xylophone'])).length === 1))

  // ---- the notes at start
  const ndjson = (await (await fetch(`${base}/notes`)).text()).trim().split('\n').map((line) => JSON.parse(line))
  ok('/api/notes gives every note with the text it has on disk', ndjson.length === Object.keys(current).length && ndjson.every((n) => current[n.path] === n.text), `${ndjson.length} notes`)

  // ---- pictures
  const original = fs.statSync(path.join(vault, 'img', 'big.png')).size
  const first = await fetch(`${base}/thumb?path=${encodeURIComponent('img/big.png')}&w=300`)
  const bytes = Buffer.from(await first.arrayBuffer())
  const meta = await sharp(bytes).metadata()
  ok('a 2400 px picture is made 320 px wide (the next size up from 300), as WebP, a small part of the original', first.status === 200 && first.headers.get('content-type') === 'image/webp' && meta.format === 'webp' && meta.width === 320 && bytes.length < original / 10, `${first.status} ${first.headers.get('content-type')} ${meta.format} ${meta.width} ${bytes.length} of ${original}`)
  ok('it is not made twice: a copy is on disk', fs.existsSync(path.join(dir, 'cache', 'thumbs')) && fs.readdirSync(path.join(dir, 'cache', 'thumbs')).filter((f) => f.endsWith('.webp')).length === 1)
  const again = await fetch(`${base}/thumb?path=${encodeURIComponent('img/big.png')}&w=300`)
  ok('asked again, the same bytes', Buffer.compare(Buffer.from(await again.arrayBuffer()), bytes) === 0)
  const stat = fs.statSync(path.join(vault, 'img', 'big.png'))
  const versioned = await fetch(`${base}/thumb?path=${encodeURIComponent('img/big.png')}&w=300&v=${Math.round(stat.mtimeMs)}-${stat.size}`)
  ok('with the file\'s version in the address the browser may keep it for good', (versioned.headers.get('cache-control') ?? '').includes('immutable'), versioned.headers.get('cache-control'))
  const small = await sharp(Buffer.from(await (await fetch(`${base}/thumb?path=${encodeURIComponent('img/big.png')}&w=100`)).arrayBuffer())).metadata()
  ok('another width is another copy', small.width === 160)
  ok('what is not a picture is refused (415), what is not there is not found (404)', (await fetch(`${base}/thumb?path=img/fake.png&w=300`)).status === 415 && (await fetch(`${base}/thumb?path=img/none.png&w=300`)).status === 404)
  ok('a web address of this computer is refused, not fetched', (await fetch(`${base}/thumb?url=${encodeURIComponent('http://127.0.0.1:1/x.png')}&w=300`)).status === 400)

  // ---- files and the browser's cache
  const file = await fetch(`${base}/file?path=Sigma.md`)
  const etag = file.headers.get('etag')
  await file.arrayBuffer()
  ok('a file without a version in the address has a stamp and must be asked about', !!etag && file.headers.get('cache-control') === 'private, no-cache', `${etag} ${file.headers.get('cache-control')}`)
  const same = await fetch(`${base}/file?path=Sigma.md`, { headers: { 'if-none-match': etag } })
  ok('asked with the stamp, it answers 304 and sends nothing', same.status === 304 && (await same.arrayBuffer()).byteLength === 0)
  fs.appendFileSync(path.join(vault, 'Sigma.md'), ' changed')
  const changed = await fetch(`${base}/file?path=Sigma.md`, { headers: { 'if-none-match': etag } })
  ok('a file that changed is sent again', changed.status === 200 && (await changed.text()).endsWith('changed'))
  const st = fs.statSync(path.join(vault, 'Sigma.md'))
  const imm = await fetch(`${base}/file?path=Sigma.md&v=${Math.round(st.mtimeMs)}-${st.size}`)
  ok('a versioned address is immutable', (imm.headers.get('cache-control') ?? '').includes('immutable'))
  await imm.arrayBuffer()

  // ---- a host the server cannot get to
  const timed = async (route) => {
    const t = Date.now()
    const res = await fetch(`${base}/${route}`)
    return { status: res.status, text: await res.text(), ms: Date.now() - t }
  }
  const attempt = await timed(`unfurl?url=${encodeURIComponent('https://blocked.example.test/page')}`)
  ok('a link card for a host the server cannot connect to fails (502) and the log says it will not try again for a while', attempt.status === 502 && /не пробуем снова/.test(log), `${attempt.status} ${attempt.text}`)
  const second = await timed(`unfurl?url=${encodeURIComponent('https://www.blocked.example.test/other')}`)
  ok('the next card for that host (or its www) fails at once, saying why and what to do', second.status === 502 && second.ms < 400 && /не достучался до/.test(second.text) && /прокси/.test(second.text), `${second.status} ${second.ms} ms ${second.text}`)
  const cover = await timed(`thumb?url=${encodeURIComponent('https://blocked.example.test/cover.png')}&w=300`)
  ok('a cover from that host is refused at once as well (the page then shows the original)', cover.status === 502 && cover.ms < 400 && /не достучался до/.test(cover.text), `${cover.status} ${cover.ms} ms ${cover.text}`)
  const other = await timed(`unfurl?url=${encodeURIComponent('https://another.example.test/page')}`)
  ok('another host is still tried', other.status === 502 && !/повтор через/.test(other.text), `${other.status} ${other.text}`)

  // ---- the slowness log
  const before = log.length
  await (await fetch(`${base}/file?path=img/large.bin`)).arrayBuffer()
  await sleep(200)
  ok('an answer of 4 MB is written down', /\[perf\] запрос GET \/api\/file img\/large\.bin: .*4\.0 МБ/.test(log.slice(before)), log.slice(before))
  const mark = log.length
  const sent = await post('perf', { entries: ['кадр 312 мс: скрипты 20 — открыто: Alpha.md', 'прокрутка div.base-cards-wrap 2.5 с: кадров 130'] })
  await sleep(100)
  ok('what the page reports stands in the log with who said it', sent.status === 204 && /\[perf\] страница \(admin\): кадр 312 мс/.test(log.slice(mark)) && /прокрутка div\.base-cards-wrap/.test(log.slice(mark)), log.slice(mark))
  const mark2 = log.length
  await post('perf', { entries: [5, null, { a: 1 }] })
  await post('perf', 'text')
  await post('perf', { entries: 'no' })
  await sleep(100)
  ok('anything that is not a line of text is dropped', !log.slice(mark2).includes('[perf]'), log.slice(mark2))
  const flood = await post('perf', { entries: Array(500).fill('x') })
  await sleep(100)
  ok('a flood is cut: at most 20 lines at once', flood.status === 204 && (log.slice(mark2).match(/\[perf\] страница/g) ?? []).length <= 20)
  ok('a report too large is refused', (await fetch(`${base}/perf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: ['x'.repeat(70_000)] }) })).status === 413)
} finally {
  server.kill('SIGTERM')
  await new Promise((resolve) => (server.once('exit', resolve), setTimeout(resolve, 5000)))
  fs.rmSync(dir, { recursive: true, force: true })
}
const failed = results.filter((one) => !one).length
console.log(failed ? `\n${failed} of ${results.length} failed` : `\nAll ${results.length} passed`)
process.exit(failed ? 1 : 0)
