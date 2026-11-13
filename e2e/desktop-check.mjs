// Checks the Windows app (Electron, desktop/main.ts) as it runs on the user's computer: only a window for a server.
// The server is the real one (release/server.mjs, as the Debian service runs it) on this computer's loopback. Checked:
// asking for the link of `flintnotes pair` and what is said to a wrong one, going straight to the notes at the next
// start, saving, changes from outside, the title bar, settings that are not the app's to show, links going to the
// browser, the page of its own when the server is not there and the way back when it returns, a key that was
// changed, one app at a time, `--quit` from the installer, and the installed app's update of itself.
// Builds into a temporary folder; the project's own release/ is not touched. About two minutes:
//   node e2e/desktop-check.mjs
// Electron for Linux comes with `npm install` (or `node node_modules/electron/install.js`). With no display (DISPLAY)
// it runs headless; under WSL, WSLg gives :0 and GTK 3 comes from ~/.cache/flintnotes/gtk-libs (or FLINT_E2E_LIBS).
import { execSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
const readFileSync = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/"key":"[^"]*"/, '"key":"…"') : 'none')
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { _electron } from 'playwright'
import { ROOT } from './helpers.mjs'

const electron = createRequire(import.meta.url)('electron')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-desktop-'))
// FLINT_E2E_RELEASE=<release> uses a build made already (a minute saved); otherwise one is made in the temporary folder.
const out = process.env.FLINT_E2E_RELEASE || path.join(dir, 'release')
const vault = path.join(dir, 'vault')
const userData = path.join(dir, 'user-data')
const log = path.join(userData, 'flintnotes.log')
const config = path.join(dir, 'config.json')
const ADMIN = 4851
const LAN = 4852
fs.mkdirSync(vault)
fs.writeFileSync(path.join(vault, 'Note.md'), 'start\n')
fs.writeFileSync(config, JSON.stringify({ phone: { port: LAN, host: '127.0.0.1' } }))
if (!process.env.FLINT_E2E_RELEASE) execSync('npm run release', { cwd: ROOT, env: { ...process.env, FLINT_RELEASE_OUT: out }, stdio: 'ignore' })

const libs = process.env.FLINT_E2E_LIBS ?? path.join(os.homedir(), '.cache', 'flintnotes', 'gtk-libs')
const env = {
  ...process.env,
  ...(fs.existsSync(libs) ? { LD_LIBRARY_PATH: [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}),
  FLINT_USER_DATA: userData,
  FLINT_AUTOSTART_DIR: path.join(dir, 'autostart'),
  // The window is made only this long after the app is ready: the app makes it so fast that Playwright, attaching to a
  // started app, would otherwise miss it on every start but the first (the app is fine; the driver is late).
  FLINT_WINDOW_DELAY: '1500',
}
// Without a display Chromium is told to draw nowhere.
const flags = process.env.DISPLAY ? ['--no-sandbox'] : ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu']

let serverProcess
const startServer = async () => {
  serverProcess = spawn(process.execPath, [path.join(out, 'server.mjs'), vault], {
    env: { ...process.env, FLINT_SERVICE: '1', FLINT_CONFIG: config, FLINT_CACHE: path.join(dir, 'cache'), FLINT_PORT: String(ADMIN) },
    stdio: 'ignore',
  })
  await until(() => fetch(`http://127.0.0.1:${LAN}/api/build`).then((res) => res.ok, () => false), 30000)
}
const stopServer = async () => {
  serverProcess.kill('SIGTERM')
  await exited(serverProcess)
}
const shellKey = () => JSON.parse(fs.readFileSync(config, 'utf8')).shell.key
const link = () => `http://127.0.0.1:${LAN}/?key=${shellKey()}`

/** The window of a started app (see FLINT_WINDOW_DELAY above for why it is there when Playwright asks). */
const windowOf = (started) => started.firstWindow({ timeout: 30000 })

/** Starts the app: given the server's link (as the tests do), or with `FLINT_SERVER_URL: ''` to use what it kept. */
const launch = (more = {}, args = []) => {
  return _electron.launch({ executablePath: electron, args: [...flags, path.join(out, 'desktop.mjs'), ...args], env: { ...env, FLINT_SERVER_URL: link(), ...more } })
}
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

let app
let feed
let impostor
try {
  await startServer()

  // ---- the first start: no server known yet, so the app asks for the link, on a page of its own
  app = await launch({ FLINT_SERVER_URL: '' })
  let page = await windowOf(app)
  await page.waitForSelector('#link', { timeout: 30000 })
  const bridges = await page.evaluate(() => ({ shell: typeof window.flintShell, desktop: typeof window.flintDesktop }))
  ok("it asks for the link on a page of its own, which has the connecting bridge and not the notes' one", page.url().startsWith('file://') && page.url().endsWith('/shell/connect.html') && bridges.shell === 'object' && bridges.desktop === 'undefined', JSON.stringify({ url: page.url(), bridges }))

  impostor = http.createServer((_req, res) => res.end('hello, I am a web page')).listen(0, '127.0.0.1')
  await new Promise((resume) => impostor.once('listening', resume))
  const said = async (text) => {
    await page.fill('#link', text)
    await page.click('#go')
    await page.waitForFunction(() => document.getElementById('message').textContent.length > 0 && !document.getElementById('go').disabled, null, { timeout: 15000 })
    return page.locator('#message').innerText()
  }
  const wrongs = {
    'not a link %%': await said('not a link %%'),
    'no key': await said(`http://127.0.0.1:${LAN}/`),
    'wrong key': await said(`http://127.0.0.1:${LAN}/?key=this-is-not-the-key`),
    'nothing there': await said('http://127.0.0.1:1/?key=abc'),
    'not flintnotes': await said(`http://127.0.0.1:${impostor.address().port}/?key=abc`),
  }
  ok('a wrong link is told why, in words', /адрес/i.test(wrongs['not a link %%']) && /нет ключа/.test(wrongs['no key']) && /не принял/.test(wrongs['wrong key']) && /ничего не слушает/.test(wrongs['nothing there']) && /не сервер FlintNotes/.test(wrongs['not flintnotes']), JSON.stringify(wrongs))
  ok('and nothing is kept of them', !fs.existsSync(path.join(userData, 'server.json')))

  await page.fill('#link', link())
  await page.click('#go')
  await page.waitForSelector('.tabbar', { timeout: 30000 })
  const kept = JSON.parse(fs.readFileSync(path.join(userData, 'server.json'), 'utf8'))
  ok('the right link opens the notes from the server, the key is no longer in the address, and the address and key are kept for the next start', page.url().startsWith(`http://127.0.0.1:${LAN}/`) && !page.url().includes('key=') && kept.origin === `http://127.0.0.1:${LAN}` && !!kept.key && (fs.statSync(path.join(userData, 'server.json')).mode & 0o077) === 0, JSON.stringify({ url: page.url(), kept: { ...kept, key: '…' } }))
  await app.evaluate(({ app }) => app.exit(0))
  await exited(app.process())

  // ---- the next start goes straight to the notes
  app = await launch({ FLINT_SERVER_URL: '' })
  page = await windowOf(app)
  await page.waitForSelector('.tabbar', { timeout: 30000 })
  ok('the next start goes straight to the notes, with the desktop look, as the shell', page.url().startsWith(`http://127.0.0.1:${LAN}/`) && (await page.evaluate(() => document.documentElement.classList.contains('desktop') && app.vault.tier === 'shell')), page.url())

  await page.getByText('Note', { exact: true }).first().click()
  await page.waitForSelector('.cm-content')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' typed')
  ok('what is typed is saved to the vault, on the server', await until(() => fs.readFileSync(path.join(vault, 'Note.md'), 'utf8').includes(' typed')))

  fs.writeFileSync(path.join(vault, 'From outside.md'), 'x')
  ok('a note made by another program shows up', await page.waitForSelector('text=From outside', { timeout: 15000 }).then(() => true, () => false))

  const bar = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector)).getPropertyValue('-webkit-app-region')
    return { bar: style('.tabbar'), tab: style('.tab-title'), padding: parseFloat(getComputedStyle(document.querySelector('.tabbar')).paddingRight) }
  })
  ok('the bar of tabs moves the window, its tabs do not, and (with a display) it leaves room for the window buttons', bar.bar === 'drag' && bar.tab === 'no-drag' && (bar.padding > 40 || !process.env.DISPLAY), JSON.stringify(bar))

  await page.evaluate(() => app.commands.run('core:settings'))
  await page.locator('nav button', { hasText: 'Программа' }).first().click()
  await page.waitForSelector('.autostart-switch')
  const settings = { port: await page.locator('.port-setting').count(), autostart: await page.locator('.autostart-switch').isEnabled(), text: await page.locator('.panel-settings').innerText().catch(() => '') }
  await page.locator('.autostart-switch').click()
  ok('the settings show starting with the system (the app does it) and nothing that is the server\'s: no port, proxy or phones', settings.port === 0 && settings.autostart && !/Прокси|Доступ с телефона/.test(settings.text) && (await until(() => fs.existsSync(path.join(dir, 'autostart', 'flintnotes.desktop')))), JSON.stringify(settings))
  await page.keyboard.press('Escape')

  await app.evaluate(({ shell }) => (shell.openExternal = async (url) => void (globalThis.opened = url)))
  await page.evaluate(() => window.open('https://example.com/page', '_blank'))
  await page.waitForTimeout(500)
  ok('a link to the web opens in the browser, not in a window of the app', app.windows().length === 1 && (await app.evaluate(() => globalThis.opened)) === 'https://example.com/page', String(await app.evaluate(() => globalThis.opened)))

  // ---- the server goes away while a note is open: what is typed stays in the page, and is saved when the server returns
  await stopServer()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' while away')
  ok('the page says the server is not answering', await page.waitForFunction(() => !document.querySelector('.server-down')?.hidden, null, { timeout: 30000 }).then(() => true, () => false))
  // Quitting with text the server did not take asks first; staying keeps the window and the text.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (...args) => ((globalThis.quitAsked = args.at(-1)), { response: 0, checkboxChecked: false })
  })
  await page.evaluate(() => window.flintDesktop.quit())
  const quitAsked = (await until(() => app.evaluate(() => !!globalThis.quitAsked), 20000)) && (await app.evaluate(() => globalThis.quitAsked))
  ok('quitting while something could not be saved asks first, and «Остаться» keeps the app', quitAsked?.message?.includes('Не всё набранное сохранено') && quitAsked.buttons?.[0] === 'Остаться' && app.windows().length === 1, JSON.stringify(quitAsked))
  await startServer()
  ok('when the server is back, what was typed meanwhile is saved by itself, with no new keystroke', await until(() => fs.readFileSync(path.join(vault, 'Note.md'), 'utf8').includes('while away'), 40000), fs.readFileSync(path.join(vault, 'Note.md'), 'utf8'))

  // ---- the server goes away and the window is loaded anew (it was reloaded, or the page crashed)
  await stopServer()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload())
  await page.waitForSelector('#retry', { timeout: 30000 })
  const offline = { url: page.url(), origin: await page.locator('#origin').innerText(), reason: await page.locator('#reason').innerText(), bridges: await page.evaluate(() => typeof window.flintShell) }
  ok('with the server gone the app shows a page of its own: which server, why (in words), and that it tries again', offline.url.endsWith('/shell/offline.html') && offline.origin === `http://127.0.0.1:${LAN}` && /ничего не слушает|не отвечает/.test(offline.reason) && offline.bridges === 'object', JSON.stringify(offline))
  ok('it says when the next try is', await page.waitForFunction(() => /Следующая попытка через \d+ с/.test(document.getElementById('wait').textContent), null, { timeout: 15000 }).then(() => true, () => false))
  await startServer()
  ok('when the server is back the app goes to the notes by itself', await page.waitForSelector('.tabbar', { timeout: 60000 }).then(() => page.url().startsWith(`http://127.0.0.1:${LAN}/`), () => false), page.url())

  // ---- the key is changed at the server: the old one no longer opens it, and the app asks for the new link
  const asAdmin = { method: 'POST', headers: { origin: `http://127.0.0.1:${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ newKey: true }) }
  await fetch(`http://127.0.0.1:${ADMIN}/api/shell`, asAdmin)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload())
  await page.waitForSelector('#link', { timeout: 30000 })
  ok('a key that was changed brings the app back to asking for the link, and says why', /не принял ключ/.test(await page.locator('#message').innerText()) && page.url().endsWith('/shell/connect.html'), page.url())
  await page.fill('#link', link())
  await page.click('#go')
  ok('the new link opens the notes again', await page.waitForSelector('.tabbar', { timeout: 30000 }).then(() => true, () => false))

  // ---- a second start finds the app running and leaves; `--quit` (the installer's) closes it, saving first.
  const second = spawn(electron, [...flags, path.join(out, 'desktop.mjs')], { env: { ...env, FLINT_SERVER_URL: '' }, stdio: 'ignore' })
  ok('a second start leaves the running app alone', await Promise.race([exited(second).then(() => true), new Promise((resume) => setTimeout(() => resume(false), 15000))]) && app.windows().length === 1)
  await page.waitForSelector('.cm-content')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' at the end')
  const closed = exited(app.process())
  const running = descendants(app.process().pid)
  spawn(electron, [...flags, path.join(out, 'desktop.mjs'), '--quit'], { env: { ...env, FLINT_SERVER_URL: '' }, stdio: 'ignore' })
  ok('--quit closes the running app', await Promise.race([closed.then(() => true), new Promise((resume) => setTimeout(() => resume(false), 20000))]))
  ok('what was typed last is saved before the app closes', fs.readFileSync(path.join(vault, 'Note.md'), 'utf8').includes('at the end'), fs.readFileSync(path.join(vault, 'Note.md'), 'utf8'))
  ok('the app leaves no process behind', await until(() => !running.some((pid) => fs.existsSync(`/proc/${pid}`)), 10000), running.filter((pid) => fs.existsSync(`/proc/${pid}`)).join(' '))
  const starts = () => readLog().split('\n').filter((line) => line.includes('Запуск:')).length

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
    // What the window is doing is said if it never shows the notes: a missing window and a window on the wrong page are not the same.
    const shown = await windowOf(started)
    if (!(await shown.waitForSelector('.tabbar', { timeout: 30000 }).then(() => true, () => false))) throw new Error(`the notes did not come up: ${shown.url()}`)
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
  const next = spawn(electron, [...flags, path.join(out, 'desktop.mjs')], { env: { ...env, FLINT_SERVER_URL: link(), ...installed }, stdio: 'ignore' })
  const updated = await Promise.race([exited(next).then(() => true), new Promise((resume) => setTimeout(() => resume(false), 30000))])
  ok('at the next start the waiting version is put in silently, with no question, and started with its window', updated && (await until(() => fs.existsSync(ran) && fs.readFileSync(ran, 'utf8').trim() === 'ran:')) && fs.readFileSync(appImage, 'utf8') === newText && readLog().split('Запуск:').at(-1).includes('Ставлю обновление 9.9.9'), (fs.existsSync(ran) ? fs.readFileSync(ran, 'utf8') : 'not run') + readLog().slice(-300))
  app = await answering(1)
  ok('a version that did not take is not installed again: the app keeps working', (await until(() => readLog().includes('уже ставилась и не встала'), 20000)) && fs.readFileSync(ran, 'utf8').trim().split('\n').length === 1, readLog().slice(-300))
  const page2 = await windowOf(app)
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
  const build = JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8'))
  const installedDir = path.join(dir, 'installed')
  // What the installer packs: the window only (scripts/installer.mjs).
  const SHELL_FILES = ['desktop.mjs', 'preload.cjs', 'build.json', 'icons', 'shell']
  for (const name of SHELL_FILES) fs.cpSync(path.join(out, name), path.join(installedDir, 'release', name), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'desktop', 'stub.cjs'), path.join(installedDir, 'main.cjs'))
  const electronVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version
  fs.writeFileSync(path.join(installedDir, 'shell.json'), JSON.stringify({ version: '1.0.0', electron: electronVersion }))
  const files = []
  const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]))
  for (const file of walk(path.join(installedDir, 'release'))) {
    const name = path.relative(installedDir, file).split(path.sep).join('/')
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
  app = await _electron.launch({ executablePath: electron, args: [...flags, path.join(installedDir, 'main.cjs')], env: { ...env, FLINT_SERVER_URL: link(), ...stubbed } })
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (...args) => ((globalThis.asked = args.at(-1)), { response: 0, checkboxChecked: false })
  })
  const lightPage = await windowOf(app)
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
  spawn(electron, [...flags, path.join(installedDir, 'main.cjs'), '--quit'], { env: { ...env, FLINT_SERVER_URL: link(), ...stubbed }, stdio: 'ignore' })
  await until(() => readLog().split('Запуск:').at(-1).includes('остановился'), 20000)

} catch (err) {
  ok('the checks ran to the end', false, `${err.stack}\n--- flintnotes.log\n${readLog().slice(-1500)}`)
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  serverProcess?.kill('SIGKILL')
  feed?.close()
  impostor?.close()
  fs.rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((passed) => !passed).length
console.log(failed ? `\n${failed} из ${results.length} проверок не прошли` : `\nВсе ${results.length} проверок прошли`)
process.exit(failed ? 1 : 0)
