// Checks what the Windows app knows about its server (desktop/connection.ts) without Electron: the link that
// `flintnotes pair` prints and what is made of whatever is typed, every way the server can answer when the app
// looks at it (not there, not FlintNotes, newer, older, a wrong key, a key that is right), the pause between tries,
// and how the key is kept. The servers are made up here, so each case is exact. Seconds:
//   node e2e/shell-connection-check.mjs
import { build } from 'esbuild'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './helpers.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-connection-'))
const bundle = path.join(dir, 'connection.mjs')
await build({ entryPoints: [path.join(ROOT, 'desktop', 'connection.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' })
const { parseLink, probe, nextDelay, sealKey, openKey } = await import(bundle)

const results = []
const ok = (name, passed, detail = '') => {
  results.push(passed)
  console.log(`${passed ? '✓' : '✗'} ${name}${passed ? '' : `\n    ${detail}`}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---- the link
ok('the link of `flintnotes pair` gives the address and the key', same(parseLink('http://192.168.1.50:4620/?key=abc123'), { origin: 'http://192.168.1.50:4620', key: 'abc123' }), JSON.stringify(parseLink('http://192.168.1.50:4620/?key=abc123')))
ok('spaces around it, a path or a fragment do not matter', same(parseLink('  http://debian:4620/some/page?key=k#x \n'), { origin: 'http://debian:4620', key: 'k' }))
ok('an address with no scheme is taken as http', same(parseLink('debian:4620/?key=k'), { origin: 'http://debian:4620', key: 'k' }), JSON.stringify(parseLink('debian:4620/?key=k')))
ok('https is allowed (a server behind a certificate)', parseLink('https://notes.example/?key=k').origin === 'https://notes.example')
ok('an address with no key says so by giving none', parseLink('http://debian:4620').key === null)
ok('what is not an address is refused with words', ['', '   ', 'http://', 'ftp://host/?key=k', 'not a link %%'].every((text) => typeof parseLink(text).error === 'string'), JSON.stringify(['', 'http://', 'ftp://host', 'not a link %%'].map((t) => parseLink(t))))

// ---- the pause between tries
ok('the pause grows from two seconds to half a minute and stays there', same([0, 1, 2, 3, 4, 5, 20].map(nextDelay), [2000, 4000, 8000, 16000, 30000, 30000, 30000]), [0, 1, 2, 3, 4, 5, 20].map(nextDelay).join())

// ---- how the key is kept
const system = { isEncryptionAvailable: () => true, encryptString: (text) => Buffer.from([...Buffer.from(text)].reverse()), decryptString: (data) => Buffer.from([...data].reverse()).toString() }
const bare = { isEncryptionAvailable: () => false }
const sealed = sealKey('secret-key', system)
ok('the key is sealed by the system where it can be, and then it is not in the file as it is', sealed.sealed === true && sealed.key !== 'secret-key' && openKey(sealed, system) === 'secret-key', JSON.stringify(sealed))
ok('where the system cannot, it is kept as it is, and read back', same(sealKey('secret-key', bare), { key: 'secret-key', sealed: false }) && openKey({ key: 'secret-key', sealed: false }, bare) === 'secret-key')
ok('a sealed key that cannot be opened (another account) is nothing, not a crash', openKey({ key: 'AAAA', sealed: true }, { ...system, decryptString: () => { throw new Error('no') } }) === null && openKey({}, system) === null && openKey({ key: '' }, system) === null)

// ---- looking at a server
const servers = []
const serve = async (handler) => {
  const server = http.createServer(handler)
  await new Promise((resume) => server.listen(0, '127.0.0.1', resume))
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}
const KEY = 'the-right-key'
/** A server that answers as FlintNotes does: /api/build to anyone, /api/vaults to the one with the key. */
const flint = (protocol, extra = {}) =>
  serve((req, res) => {
    if (extra.hang) return
    if (req.url === '/api/build') return res.end(JSON.stringify({ version: '1.2.3', protocol, build: 'x' }))
    if (req.url === '/api/vaults') {
      res.statusCode = extra.vaults ?? ((req.headers.cookie ?? '').includes(`flint-shell=${KEY}`) ? 200 : 401)
      return res.end('[]')
    }
    res.statusCode = 404
    res.end()
  })
const PROTOCOL = 7

const good = await probe(await flint(PROTOCOL), KEY, PROTOCOL)
ok('a server that speaks the protocol and takes the key is ok, and says which version it is', good.state === 'ok' && good.info.version === '1.2.3', JSON.stringify(good))
const locked = await probe(await flint(PROTOCOL), 'a-key-that-was-changed', PROTOCOL)
ok('a key it does not take is «locked»', locked.state === 'locked', JSON.stringify(locked))
const newer = await probe(await flint(PROTOCOL + 1), KEY, PROTOCOL)
ok('a newer server says the app must be updated', newer.state === 'newer-server' && /обновите FlintNotes для Windows/.test(newer.message), JSON.stringify(newer))
const older = await probe(await flint(PROTOCOL - 1), KEY, PROTOCOL)
ok('an older server says the server must be updated, and how', older.state === 'older-server' && /npm run release/.test(older.message), JSON.stringify(older))

const web = await probe(await serve((_req, res) => res.end('<html>a web page</html>')), KEY, PROTOCOL)
ok('a web page that is not FlintNotes is told apart', web.state === 'unreachable' && /не сервер FlintNotes/.test(web.message), JSON.stringify(web))
const json = await probe(await serve((_req, res) => res.end('{"hello":1}')), KEY, PROTOCOL)
ok('so is JSON that is not its', json.state === 'unreachable' && /не сервер FlintNotes/.test(json.message), JSON.stringify(json))
const off = await probe(await serve((_req, res) => ((res.statusCode = 503), res.end('FlintNotes: доступ по сети выключен'))), KEY, PROTOCOL)
ok('a server with the network turned off says that', off.state === 'unreachable' && /выключен/.test(off.message), JSON.stringify(off))
const limited = await probe(await flint(PROTOCOL, { vaults: 429 }), KEY, PROTOCOL)
ok('a server that has shut the app out for too many wrong keys says to wait', limited.state === 'unreachable' && /подождите/.test(limited.message), JSON.stringify(limited))
const broken = await probe(await flint(PROTOCOL, { vaults: 500 }), KEY, PROTOCOL)
ok('any other answer is told as it is', broken.state === 'unreachable' && /500/.test(broken.message), JSON.stringify(broken))

const free = http.createServer()
await new Promise((resume) => free.listen(0, '127.0.0.1', resume))
const closed = `http://127.0.0.1:${free.address().port}`
await new Promise((resume) => free.close(resume))
const refused = await probe(closed, KEY, PROTOCOL)
ok('where nothing listens it says so', refused.state === 'unreachable' && /ничего не слушает/.test(refused.message), JSON.stringify(refused))
const lost = await probe('http://no-such-host.invalid', KEY, PROTOCOL, 3000)
ok('a name nobody knows is told apart too', lost.state === 'unreachable' && !!lost.message, JSON.stringify(lost))
const began = Date.now()
const silent = await probe(await flint(PROTOCOL, { hang: true }), KEY, PROTOCOL, 600)
ok('a server that does not answer is given up after the time asked, not waited for', silent.state === 'unreachable' && Date.now() - began < 3000 && /не отвечает/.test(silent.message), `${Date.now() - began} ms ${JSON.stringify(silent)}`)
const huge = await probe(await serve((_req, res) => res.end('x'.repeat(2_000_000))), KEY, PROTOCOL)
ok('an answer of megabytes is not taken for FlintNotes', huge.state === 'unreachable', JSON.stringify(huge))

for (const server of servers) server.closeAllConnections?.(), server.close()
fs.rmSync(dir, { recursive: true, force: true })
const failed = results.filter((passed) => !passed).length
console.log(failed ? `\n${failed} из ${results.length} проверок не прошли` : `\nВсе ${results.length} проверок прошли`)
process.exit(failed ? 1 : 0)
