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

  // The installed app's update of itself: a newer release (a local server here, in GitHub's place) is
  // downloaded, checked against its checksum and installed silently, the app stepping aside; and only once.
  const ran = path.join(dir, 'installer-ran')
  const setupText = `#!/bin/sh\necho "$@" >> '${ran}'\n`
  const latest = { version: '9.9.9', file: 'FlintNotes-Setup-9.9.9.exe', sha256: createHash('sha256').update(setupText).digest('hex') }
  feed = http.createServer((req, res) => {
    if (req.url.endsWith('/latest.json')) return res.end(JSON.stringify(latest))
    if (req.url.endsWith(`/${latest.file}`)) return res.end(setupText)
    res.statusCode = 404
    res.end()
  })
  await new Promise((resume) => feed.listen(0, '127.0.0.1', resume))
  fs.writeFileSync(path.join(dir, 'shell.json'), JSON.stringify({ version: '0.1.0' }))
  const installed = { FLINT_UPDATE_FEED: `http://127.0.0.1:${feed.address().port}/releases/latest/download/latest.json`, FLINT_SHELL: path.join(dir, 'shell.json') }
  const updating = spawn(electron, ['--no-sandbox', path.join(out, 'desktop.mjs'), '--hidden'], { env: { ...env, ...installed }, stdio: 'ignore' })
  const quitForUpdate = await Promise.race([exited(updating).then(() => true), new Promise((resume) => setTimeout(() => resume(false), 30000))])
  ok('a newer release is downloaded, checked and installed silently, the app stepping aside', quitForUpdate && (await until(() => fs.existsSync(ran) && fs.readFileSync(ran, 'utf8').trim() === '/S --run --hidden')), (fs.existsSync(ran) ? fs.readFileSync(ran, 'utf8') : 'not run') + readLog().slice(-300))
  app = await launch(installed)
  await (await app.firstWindow()).waitForSelector('.tabbar', { timeout: 30000 })
  ok('a version that did not take is not installed again: the app keeps working', (await until(() => readLog().includes('уже ставилась и не встала'))) && fs.readFileSync(ran, 'utf8').trim().split('\n').length === 1, readLog().slice(-300))
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
