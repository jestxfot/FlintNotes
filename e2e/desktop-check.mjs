// Checks the desktop app (Electron, desktop/main.ts) as it runs on the user's computer: no port, the page
// at flint://app, saving, changes from outside, the title bar, a new build taken over keeping what is typed,
// one app at a time, `--quit` from the installer, links going to the browser, a restart of itself for a new
// app, and the installed app's update of itself from a newer release.
// Builds into a temporary folder; the project's own release/ is not touched. About a minute:
//   node e2e/desktop-check.mjs
// Electron for Linux comes with `npm install` (or `node node_modules/electron/install.js`). It needs a display (WSLg gives :0) and GTK 3; under WSL without
// GTK installed, the libraries unpacked into ~/.cache/flintnotes/gtk-libs (or FLINT_E2E_LIBS) are used.
import { execSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { _electron } from 'playwright'
import { ROOT } from './helpers.mjs'

const electron = createRequire(import.meta.url)('electron')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-desktop-'))
const out = path.join(dir, 'release')
const vault = path.join(dir, 'vault')
const userData = path.join(dir, 'user-data')
const log = path.join(userData, 'flintnotes.log')
fs.mkdirSync(vault)
fs.writeFileSync(path.join(vault, 'Note.md'), 'start\n')
execSync('npm run release', { cwd: ROOT, env: { ...process.env, FLINT_RELEASE_OUT: out }, stdio: 'ignore' })

const libs = process.env.FLINT_E2E_LIBS ?? path.join(os.homedir(), '.cache', 'flintnotes', 'gtk-libs')
const env = {
  ...process.env,
  DISPLAY: process.env.DISPLAY || ':0',
  ...(fs.existsSync(libs) ? { LD_LIBRARY_PATH: [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}),
  FLINT_VAULT: vault,
  FLINT_CONFIG: path.join(dir, 'config.json'),
  FLINT_USER_DATA: userData,
  FLINT_AUTOSTART_DIR: path.join(dir, 'autostart'),
}
const launch = (more = {}, args = []) => _electron.launch({ executablePath: electron, args: [path.join(out, 'desktop.mjs'), ...args], env: { ...env, ...more } })
const results = []
const ok = (name, passed, detail = '') => {
  results.push(passed)
  console.log(`${passed ? '✓' : '✗'} ${name}${passed ? '' : `\n    ${detail}`}`)
}
const readLog = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '')
const until = async (test, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resume) => setTimeout(resume, 200))) if (await test()) return true
  return false
}
const exited = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resume) => child.once('exit', resume)))

/** The processes started by `pid`, and theirs. */
const descendants = (pid) => {
  const all = fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name))
  const parentOf = (one) => {
    try {
      return fs.readFileSync(`/proc/${one}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')[1]
    } catch {
      // It ended while the list was read.
      return undefined
    }
  }
  const parent = new Map(all.map((one) => [one, parentOf(one)]).filter(([, ppid]) => ppid))
  const found = new Set([String(pid)])
  for (let grew = true; grew; ) {
    grew = false
    for (const [one, ppid] of parent) if (found.has(ppid) && !found.has(one)) (found.add(one), (grew = true))
  }
  return [...found]
}
/** The TCP ports a process listens on. */
const listening = (pid) => {
  const sockets = new Set()
  for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
    const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`, { throwIfNoEntry: false }) ?? ''
    const inode = link.match(/^socket:\[(\d+)\]$/)?.[1]
    if (inode) sockets.add(inode)
  }
  const tables = ['/proc/net/tcp', '/proc/net/tcp6'].map((file) => fs.readFileSync(file, 'utf8').split('\n').slice(1)).flat()
  return tables.map((line) => line.trim().split(/\s+/)).filter((cols) => cols[3] === '0A' && sockets.has(cols[9])).map((cols) => parseInt(cols[1].split(':')[1], 16))
}

let app
let feed
try {
  app = await launch()
  const page = await app.firstWindow()
  await page.waitForSelector('.tabbar', { timeout: 30000 })
  ok('the page comes from flint://app, with the desktop look', page.url().startsWith('flint://app/') && (await page.evaluate(() => document.documentElement.classList.contains('desktop'))), page.url())

  // The main process is left out: Playwright itself opens a port there, to drive the app.
  const children = descendants(app.process().pid).filter((pid) => pid !== String(app.process().pid))
  const server = children.find((pid) => fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('node.mojom.NodeService'))
  const ports = children.flatMap(listening)
  ok('the server listens on a pipe, and no part of the app opens a port', !!server && !ports.length && /FlintNotes: канал /.test(readLog()), `server ${server}, ports ${ports}`)

  await page.getByText('Note', { exact: true }).first().click()
  await page.waitForSelector('.cm-content')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' typed')
  ok('what is typed is saved to the vault', await until(() => fs.readFileSync(path.join(vault, 'Note.md'), 'utf8').includes(' typed')))

  fs.writeFileSync(path.join(vault, 'From outside.md'), 'x')
  ok('a note made by another program shows up', await page.waitForSelector('text=From outside', { timeout: 15000 }).then(() => true, () => false))

  const bar = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector)).getPropertyValue('-webkit-app-region')
    return { bar: style('.tabbar'), tab: style('.tab-title'), padding: parseFloat(getComputedStyle(document.querySelector('.tabbar')).paddingRight) }
  })
  ok('the bar of tabs moves the window, its tabs do not, and it leaves room for the window buttons', bar.bar === 'drag' && bar.tab === 'no-drag' && bar.padding > 40, JSON.stringify(bar))

  await page.evaluate(() => app.commands.run('core:settings'))
  await page.locator('nav button', { hasText: 'Программа' }).first().click()
  await page.waitForSelector('.autostart-switch')
  const settings = { port: await page.locator('.port-setting').count(), autostart: await page.locator('.autostart-switch').isEnabled() }
  await page.locator('.autostart-switch').click()
  ok('the settings have no port, and starting with the system is switched by the app', settings.port === 0 && settings.autostart && (await until(() => fs.existsSync(path.join(dir, 'autostart', 'flintnotes.desktop')))), JSON.stringify(settings))
  await page.keyboard.press('Escape')

  await app.evaluate(({ shell }) => (shell.openExternal = async (url) => void (globalThis.opened = url)))
  await page.evaluate(() => window.open('https://example.com/page', '_blank'))
  await page.waitForTimeout(500)
  ok('a link to the web opens in the browser, not in a window of the app', app.windows().length === 1 && (await app.evaluate(() => globalThis.opened)) === 'https://example.com/page', String(await app.evaluate(() => globalThis.opened)))

  // A new build: the server is replaced, the page reloads by itself and keeps what was typed and not saved yet.
  await page.evaluate(() => (window.oldPage = true))
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' before the update')
  const build = JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8'))
  fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ ...build, id: new Date().toISOString() }))
  const reloaded = await until(() => page.evaluate(() => !window.oldPage && !!document.querySelector('.tabbar')).catch(() => false), 30000)
  ok('a new build replaces the server and the page reloads by itself', reloaded && readLog().includes('Новая сборка: сервер запущен заново'), readLog().slice(-400))
  ok('what was typed before the update is in the note', fs.readFileSync(path.join(vault, 'Note.md'), 'utf8').includes('before the update'))

  // A second start finds the app running and leaves; `--quit` (the installer's) closes it, saving first.
  const second = spawn(electron, ['--no-sandbox', path.join(out, 'desktop.mjs')], { env, stdio: 'ignore' })
  ok('a second start leaves the running app alone', await Promise.race([exited(second).then(() => true), new Promise((resume) => setTimeout(() => resume(false), 15000))]) && app.windows().length === 1)
  await page.waitForSelector('.cm-content')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' at the end')
  const closed = exited(app.process())
  const running = descendants(app.process().pid)
  spawn(electron, ['--no-sandbox', path.join(out, 'desktop.mjs'), '--quit'], { env, stdio: 'ignore' })
  ok('--quit closes the running app', await Promise.race([closed.then(() => true), new Promise((resume) => setTimeout(() => resume(false), 20000))]))
  ok('what was typed last is saved before the app closes', fs.readFileSync(path.join(vault, 'Note.md'), 'utf8').includes('at the end'), fs.readFileSync(path.join(vault, 'Note.md'), 'utf8'))
  ok('the app leaves no process behind (its server among them)', await until(() => !running.some((pid) => fs.existsSync(`/proc/${pid}`)), 10000), running.filter((pid) => fs.existsSync(`/proc/${pid}`)).join(' '))

  // A new app (this time desktop.mjs itself): it restarts by itself, the way it was (here: in the tray).
  const starts = () => readLog().split('\n').filter((line) => line.includes('Запуск:')).length
  const before = starts()
  const tray = spawn(electron, ['--no-sandbox', path.join(out, 'desktop.mjs'), '--hidden'], { env, stdio: 'ignore' })
  await until(() => starts() === before + 1 && /FlintNotes: канал /.test(readLog().split('Запуск:').at(-1)))
  fs.appendFileSync(path.join(out, 'desktop.mjs'), '\n// changed\n')
  fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ ...build, id: new Date(Date.now() + 2000).toISOString() }))
  const restarted = await Promise.race([exited(tray).then(() => true), new Promise((resume) => setTimeout(() => resume(false), 20000))])
  ok('a new app restarts by itself, in the tray as it was', restarted && (await until(() => starts() === before + 2)) && readLog().includes('перезапускаю его') && readLog().split('Запуск:').at(-1).includes('--hidden'), readLog().slice(-500))
  spawn(electron, ['--no-sandbox', path.join(out, 'desktop.mjs'), '--quit'], { env, stdio: 'ignore' })
  await until(() => readLog().split('Запуск:').at(-1).includes('остановился'))

  // The installed app's update of itself: a newer release (a local server here, in GitHub's place) is downloaded
  // and checked, and the user is asked. «Позже» leaves the app as it is; «Обновить» puts the new version in and
  // starts it (here, on Linux: the new AppImage takes the old one's place and is started; on Windows the installer
  // runs silently); a version that did not take is not offered again. The «AppImage» here only notes how it was started.
  const ran = path.join(dir, 'new-version-ran')
  const appImage = path.join(dir, 'FlintNotes.AppImage')
  fs.writeFileSync(appImage, 'the old version', { mode: 0o755 })
  const newText = `#!/bin/sh\necho "ran:$*" >> '${ran}'\n`
  const linux = { file: 'FlintNotes-9.9.9-x86_64.AppImage', sha256: createHash('sha256').update(newText).digest('hex') }
  const latest = { version: '9.9.9', windows: { file: 'FlintNotes-Setup-9.9.9.exe', sha256: '0'.repeat(64) }, linux }
  feed = http.createServer((req, res) => {
    if (req.url.endsWith('/latest.json')) return res.end(JSON.stringify(latest))
    if (req.url.endsWith(`/${linux.file}`)) return res.end(newText)
    res.statusCode = 404
    res.end()
  })
  await new Promise((resume) => feed.listen(0, '127.0.0.1', resume))
  fs.writeFileSync(path.join(dir, 'shell.json'), JSON.stringify({ version: '0.1.0' }))
  const installed = { FLINT_UPDATE_FEED: `http://127.0.0.1:${feed.address().port}/releases/latest/download/latest.json`, FLINT_SHELL: path.join(dir, 'shell.json'), FLINT_UPDATE_DELAY: '4000', APPIMAGE: appImage }
  /** Starts the installed app, answering its question about the update with the given button. */
  const answering = async (button) => {
    const started = await launch(installed)
    await started.evaluate(({ dialog }, button) => {
      dialog.showMessageBox = async (...args) => ((globalThis.asked = args.at(-1)), { response: button, checkboxChecked: false })
    }, button)
    await (await started.firstWindow()).waitForSelector('.tabbar', { timeout: 30000 })
    return started
  }
  app = await answering(1)
  const later = await until(() => readLog().includes('Обновление 9.9.9 отложено'), 20000)
  const asked = await app.evaluate(() => globalThis.asked)
  ok('a newer release is downloaded, checked and offered in a window with «Обновить» and «Позже»', later && asked?.message?.includes('9.9.9') && asked.buttons?.[0] === 'Обновить', JSON.stringify(asked) + readLog().slice(-300))
  ok('«Позже» leaves the app running and installs nothing', !fs.existsSync(ran) && app.windows().length === 1)
  await app.evaluate(({ app }) => app.exit(0))
  await exited(app.process())
  // The next start (after the computer was restarted, say) puts the waiting version in by itself, with no question.
  const next = spawn(electron, ['--no-sandbox', path.join(out, 'desktop.mjs')], { env: { ...env, ...installed }, stdio: 'ignore' })
  const updated = await Promise.race([exited(next).then(() => true), new Promise((resume) => setTimeout(() => resume(false), 30000))])
  ok('at the next start the waiting version is put in silently, with no question, and started with its window', updated && (await until(() => fs.existsSync(ran) && fs.readFileSync(ran, 'utf8').trim() === 'ran:')) && fs.readFileSync(appImage, 'utf8') === newText && readLog().split('Запуск:').at(-1).includes('Ставлю обновление 9.9.9'), (fs.existsSync(ran) ? fs.readFileSync(ran, 'utf8') : 'not run') + readLog().slice(-300))
  app = await answering(1)
  ok('a version that did not take is not installed again: the app keeps working', (await until(() => readLog().includes('уже ставилась и не встала'), 20000)) && fs.readFileSync(ran, 'utf8').trim().split('\n').length === 1, readLog().slice(-300))
  const page2 = await app.firstWindow()
  const off = await page2.evaluate(() => window.flintDesktop.setUpdates(false))
  const checked = await page2.evaluate(() => window.flintDesktop.checkUpdates())
  await page2.evaluate(() => app.commands.run('core:settings'))
  await page2.locator('nav button', { hasText: 'Программа' }).first().click()
  const shown = await page2.locator('.app-updates-switch').isChecked({ timeout: 10000 }).catch(() => null)
  ok('updates can be switched off in the settings, and «Проверить сейчас» still looks', off.enabled === false && shown === false && /9\.9\.9/.test(checked.result), JSON.stringify({ off, checked, shown }))

  // A light update: a release made for the same Electron brings only the app's own files. The installed app (its stub,
  // desktop/stub.cjs, beside its own copy of the build) unpacks them into the user's folder and, on «Обновить», only
  // starts again: the stub then runs the new build.
  await app.evaluate(({ app }) => app.exit(0))
  await exited(app.process())
  const installedDir = path.join(dir, 'installed')
  fs.cpSync(out, path.join(installedDir, 'release'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'desktop', 'stub.cjs'), path.join(installedDir, 'main.cjs'))
  const electronVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version
  fs.writeFileSync(path.join(installedDir, 'shell.json'), JSON.stringify({ version: '1.0.0', electron: electronVersion }))
  const files = []
  const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]))
  for (const file of walk(out)) {
    const name = `release/${path.relative(out, file).split(path.sep).join('/')}`
    files.push({ path: name, bytes: name === 'release/build.json' ? Buffer.from(JSON.stringify({ ...build, id: 'light-build' })) : fs.readFileSync(file) })
  }
  files.push({ path: 'shell.json', bytes: Buffer.from(JSON.stringify({ version: '1.0.1', electron: electronVersion })) })
  const { gzipSync } = await import('node:zlib')
  const pack = gzipSync(Buffer.concat([Buffer.from(`${JSON.stringify(files.map((file) => ({ path: file.path, size: file.bytes.length })))}\n`), ...files.map((file) => file.bytes)]))
  const light = { file: 'FlintNotes-1.0.1-app.pack', sha256: createHash('sha256').update(pack).digest('hex'), size: pack.length }
  feed.close()
  feed = http.createServer((req, res) => {
    if (req.url.endsWith('/latest.json')) return res.end(JSON.stringify({ version: '1.0.1', electron: electronVersion, app: light, linux, windows: latest.windows }))
    if (req.url.endsWith(`/${light.file}`)) return res.end(pack)
    res.statusCode = 404
    res.end()
  })
  await new Promise((resume) => feed.listen(0, '127.0.0.1', resume))
  const stubbed = { FLINT_UPDATE_FEED: `http://127.0.0.1:${feed.address().port}/releases/latest/download/latest.json`, FLINT_UPDATE_DELAY: '3000' }
  const startsBefore = starts()
  app = await _electron.launch({ executablePath: electron, args: [path.join(installedDir, 'main.cjs')], env: { ...env, ...stubbed } })
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (...args) => ((globalThis.asked = args.at(-1)), { response: 0, checkboxChecked: false })
  })
  const lightPage = await app.firstWindow()
  await lightPage.waitForSelector('.tabbar', { timeout: 30000 })
  // Switched off above: on again, which looks at once.
  await lightPage.evaluate(() => window.flintDesktop.setUpdates(true))
  const relaunched = await Promise.race([exited(app.process()).then(() => true), new Promise((resume) => setTimeout(() => resume(false), 30000))])
  const builds = path.join(userData, 'builds')
  ok(
    'a light update is downloaded, unpacked beside the app, and «Обновить» only starts it again',
    relaunched && fs.existsSync(path.join(builds, '1.0.1', 'release', 'desktop.mjs')) && JSON.parse(fs.readFileSync(path.join(builds, 'current.json'), 'utf8')).version === '1.0.1' && readLog().includes('Загружаю обновление 1.0.0 → 1.0.1'),
    readLog().slice(-600),
  )
  ok('the stub starts the new build after the restart', await until(() => starts() >= startsBefore + 2 && readLog().split('Запуск:').at(-1).includes('сборка light-build'), 30000), readLog().slice(-600))
  spawn(electron, ['--no-sandbox', path.join(installedDir, 'main.cjs'), '--quit'], { env: { ...env, ...stubbed }, stdio: 'ignore' })
  await until(() => readLog().split('Запуск:').at(-1).includes('остановился'), 20000)

  // The sandbox: with no vault of one's own the app opens a vault of examples, and it is made anew at every start.
  const sandbox = path.join(userData, 'Песочница')
  const withoutVault = Object.fromEntries(Object.entries({ ...env, FLINT_CONFIG: path.join(dir, 'fresh-config.json') }).filter(([key]) => key !== 'FLINT_VAULT'))
  const startFresh = async () => {
    const started = await _electron.launch({ executablePath: electron, args: [path.join(out, 'desktop.mjs')], env: withoutVault })
    const shown = await started.firstWindow()
    await shown.waitForSelector('.tabbar', { timeout: 30000 })
    return [started, shown]
  }
  let [fresh, freshPage] = await startFresh()
  app = fresh
  ok('with no vault of its own, the app opens the sandbox of examples', (await freshPage.getByText('Добро пожаловать', { exact: true }).count()) > 0 && fs.existsSync(path.join(sandbox, 'Задачи.md')), freshPage.url())
  fs.writeFileSync(path.join(sandbox, 'Моя проба.md'), 'x')
  fs.rmSync(path.join(sandbox, 'Задачи.md'))
  await fresh.evaluate(({ app }) => app.exit(0))
  await exited(fresh.process())
  ;[fresh, freshPage] = await startFresh()
  app = fresh
  ok('what was done in the sandbox is gone at the next start', !fs.existsSync(path.join(sandbox, 'Моя проба.md')) && fs.existsSync(path.join(sandbox, 'Задачи.md')))
} catch (err) {
  ok('the checks ran to the end', false, err.stack)
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  feed?.close()
  fs.rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((passed) => !passed).length
console.log(failed ? `\n${failed} из ${results.length} проверок не прошли` : `\nВсе ${results.length} проверок прошли`)
process.exit(failed ? 1 : 0)
