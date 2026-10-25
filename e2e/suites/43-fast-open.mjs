// Starting and opening faster: the server's list of files kept for its next start, notes left a moment ago kept whole,
// pictures kept by the browser, bases drawn as they come near; and a folder of its own for each template's notes.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture } from '../helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const base = (name) => `\`\`\`base\nviews:\n  - type: table\n    name: ${name}\n\`\`\``
const lines = Array.from({ length: 300 }, (_, i) => `Строка ${i}`).join('\n\n')

export const vault = {
  plugins: ['bases', 'templates'],
  settings: { core: { reuseTab: true }, templates: { folder: 'Templates', ask: true, onCreate: true } },
  files: {
    'A.md': 'Заметка A\n',
    'B.md': 'Заметка B\n',
    'Gone.md': 'x\n',
    'pic.png': fixture('pic.png'),
    'Long.md': `# Длинная\n\n${base('Top')}\n\n${lines}\n\n${base('Bottom')}\n\nend\n`,
    'Templates/Встреча.md': '# Встреча\n',
    'Templates/Plain.md': 'plain\n',
    'Проекты/x.md': 'x\n',
  },
}

/** A server of its own on the suite's vault, keeping what it keeps in `cache`; stopped as the launcher stops it. */
async function startServer(t, port, cache) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, FLINT_VAULT: t.vault, FLINT_PORT: String(port), FLINT_CONFIG: `${t.vault}.config2.json`, FLINT_AUTOSTART_DIR: `${t.vault}.autostart2`, FLINT_CACHE: cache },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  await new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(out)), 30_000)
    const listen = (chunk) => {
      out += chunk
      if (out.includes('FlintNotes:')) resolve(clearTimeout(timer))
    }
    child.stdout.on('data', listen)
    child.stderr.on('data', listen)
  })
  return child
}
const stopServer = (child) => new Promise((resolve) => (child.once('exit', resolve), child.send('stop')))
const tree = async (port) => (await (await fetch(`http://localhost:${port}/api/tree`)).json()).map((entry) => entry.path)

/** The changes a server tells its pages about, until `enough` says they are all there (or ten seconds pass). */
async function events(port, name, enough) {
  const seen = []
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), 10_000)
  try {
    const res = await fetch(`http://localhost:${port}/api/events?vault=${encodeURIComponent(name)}`, { signal: stop.signal })
    const decoder = new TextDecoder()
    for await (const chunk of res.body) {
      for (const line of decoder.decode(chunk, { stream: true }).split('\n')) if (line.startsWith('data:')) seen.push(JSON.parse(line.slice(5)))
      if (enough(seen)) break
    }
  } catch {
    // Ten seconds passed.
  }
  clearTimeout(timer)
  stop.abort()
  return seen
}

export async function run(t) {
  const { page, ok, wait, exists } = t

  // ---- the server keeps its list of files for the next start, and checks it against the disk a moment after
  const cache = `${t.vault}.cache2`
  const port = 4795
  let server = await startServer(t, port, cache)
  try {
    const first = await tree(port)
    await stopServer(server)
    const kept = fs.readdirSync(path.join(cache, 'trees')).filter((file) => file.endsWith('.json'))
    ok('a stopping server writes its list of files into its temporary folder', kept.length === 1 && first.includes('Gone.md'), kept.join(', '))
    // While it is off, a file comes and another goes.
    t.write('New.md', 'new\n')
    fs.rmSync(path.join(t.vault, 'Gone.md'))
    server = await startServer(t, port, cache)
    const watching = events(port, path.basename(t.vault), (seen) => seen.some((e) => e.type === 'upsert' && e.entry.path === 'New.md') && seen.some((e) => e.type === 'delete' && e.path === 'Gone.md'))
    const atStart = await tree(port)
    ok('started again, it gives that list at once, without walking the vault', atStart.includes('Gone.md') && !atStart.includes('New.md'), atStart.join(', '))
    const told = await watching
    ok('then finds what changed while it was off and tells the pages', told.some((e) => e.type === 'upsert' && e.entry.path === 'New.md') && told.some((e) => e.type === 'delete' && e.path === 'Gone.md'), JSON.stringify(told.map((e) => e.type)))
    const after = await tree(port)
    ok('and its list is right again', after.includes('New.md') && !after.includes('Gone.md'), after.join(', '))
  } finally {
    await stopServer(server).catch(() => {})
    for (const extra of [cache, `${t.vault}.config2.json`, `${t.vault}.autostart2`]) fs.rmSync(extra, { recursive: true, force: true })
  }

  // ---- pictures of the vault are kept by the browser until the file changes
  await t.open('A')
  const picture = await page.evaluate(async () => {
    const url = app.vault.url('pic.png')
    const [kept, other] = await Promise.all([fetch(url), fetch(url.replace(/v=[^&]+/, 'v=1-1'))])
    return { url, kept: kept.headers.get('cache-control'), other: other.headers.get('cache-control') }
  })
  ok('a picture\'s address names its version, and the browser keeps it', /&v=\d+-\d+$/.test(picture.url) && /immutable/.test(picture.kept ?? ''), JSON.stringify(picture))
  ok('an address of another version is not kept', picture.other === 'no-store', JSON.stringify(picture))

  // ---- a note left a moment ago comes back as it was: the same editor, with its undo history
  await t.cursorToEnd()
  await page.keyboard.type(' plus')
  await wait(700)
  await page.evaluate(() => (window.__editorA = app.workspace.activeEditor))
  await t.open('B')
  ok('another note opened in the tab takes its place', (await page.evaluate(() => app.workspace.active.path)) === 'B.md' && (await page.evaluate(() => app.workspace.leaves.length)) === 1)
  await page.evaluate(() => app.workspace.openFile('A.md'))
  await wait(400)
  ok('opened again, the note comes back whole: the same editor', await page.evaluate(() => app.workspace.activeEditor === window.__editorA))
  ok('with what was typed, saved', (await t.text()).includes('plus') && t.read('A.md').includes('plus'), `${await t.text()} | ${t.read('A.md')}`)
  await page.keyboard.press('Control+z')
  await wait(700)
  ok('and its undo history', !(await t.text()).includes('plus'), await t.text())
  // Changed on disk while it was away: it comes back changed.
  await t.open('B')
  t.write('A.md', 'Изменено снаружи\n')
  await wait(2500)
  await page.evaluate(() => app.workspace.openFile('A.md'))
  await wait(800)
  ok('a note changed elsewhere meanwhile comes back with its new text', (await t.text()).includes('Изменено снаружи'), await t.text())
  await t.open('B')
  const parked = () => page.evaluate(() => document.querySelector('.parked-views').childElementCount)
  const before = await parked()
  await page.evaluate(() => app.vault.trash('A.md'))
  await wait(500)
  ok('a note kept that way and deleted is let go', before >= 1 && (await parked()) === before - 1, `${before} → ${await parked()}`)

  // ---- bases: the one in sight drawn at once, softly; the one further down when it comes near
  await page.evaluate(() => app.workspace.openFile('Long.md'))
  await wait(800)
  const bases = page.locator(`${t.leaf} .base`)
  ok('a base in sight is drawn at once and comes in softly', (await bases.first().locator('.base-toolbar').count()) === 1 && (await bases.first().getAttribute('class')).includes('base-fade'), `${await bases.count()} ${await bases.first().getAttribute('class').catch(() => 'none')} ${await bases.first().innerHTML().catch(() => '').then((html) => html.slice(0, 200))}`)
  await page.evaluate(() => {
    const editor = app.workspace.activeEditor
    editor.dispatch({ selection: { anchor: editor.state.doc.length }, scrollIntoView: true })
  })
  await wait(1500)
  ok('the one at the end of a long note is there when the note is scrolled to it', (await page.locator(`${t.leaf} .base .base-toolbar b`, { hasText: 'Bottom' }).count()) === 1)

  // ---- each template may have a folder of its own for its notes
  await page.evaluate(() => app.commands.run('core:settings'))
  await page.locator('nav button', { hasText: 'Шаблоны' }).click()
  await wait(500)
  const rows = page.locator('.tpl-folder')
  ok('the settings list every template with the folder of its notes', (await rows.count()) === 2 && (await rows.allInnerTexts()).join('|').includes('Встреча') && (await rows.first().innerText()).includes('как обычно'), await rows.allInnerTexts())
  await rows.filter({ hasText: 'Встреча' }).locator('.tpl-folder-pick').click()
  await page.locator('dialog:has([role=option]) input').last().fill('/Встречи/')
  await wait(300)
  await page.keyboard.press('Enter')
  await wait(900)
  const saved = JSON.parse(t.read('.flint/settings.json')).templates?.folders
  ok('a folder typed that does not exist yet is taken, kept by the template', saved?.['Templates/Встреча.md'] === 'Встречи', JSON.stringify(saved))
  ok('a template with a folder stands first, marked', (await rows.first().getAttribute('class')).includes('is-set') && (await rows.first().innerText()).includes('Встречи'), await rows.allInnerTexts())
  await page.locator('.tpl-folders-head input').fill('plain')
  ok('the list can be searched', (await rows.count()) === 1, await rows.allInnerTexts())
  await page.locator('.tpl-folders-head input').fill('')
  await page.keyboard.press('Escape')
  await wait(300)

  const choose = async (name) => {
    const dialog = page.locator('dialog:has([role=option])')
    await dialog.waitFor({ timeout: 5000 }).catch(() => {})
    await dialog.locator('[role=option]', { hasText: name }).first().click()
    await wait(1000)
  }
  await t.open('B')
  await page.keyboard.press('Alt+n')
  await choose('Встреча')
  ok('a new note given that template goes to its folder', exists('Встречи/Без названия.md') && t.read('Встречи/Без названия.md').includes('# Встреча'), (await page.evaluate(() => app.vault.files().map((f) => f.path))).join(', '))
  await page.keyboard.press('Alt+n')
  await choose('Plain')
  ok('a template with no folder leaves the note where it would go', exists('Без названия.md'))
  await page.evaluate(() => app.commands.run('templates:create'))
  await choose('Встреча')
  ok('«a note from a template» goes there too', exists('Встречи/Без названия 1.md'))
  await t.row('Проекты').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Новая заметка' }).click()
  await choose('Встреча')
  ok('a folder the user named stays the note\'s folder', exists('Проекты/Без названия.md') && !exists('Встречи/Без названия 2.md'))
  await page.evaluate(() => app.vault.rename('Templates/Встреча.md', 'Templates/Собрание.md'))
  await wait(900)
  ok('a template renamed keeps its folder', JSON.parse(t.read('.flint/settings.json')).templates?.folders?.['Templates/Собрание.md'] === 'Встречи')
}
