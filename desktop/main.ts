/**
 * FlintNotes as a desktop app (Electron): the main process. Built by `npm run release` into
 * `release/desktop.mjs`, next to the server and the page it runs.
 *
 * - The page is the same as in a browser, served from `flint://app/`: its files straight from
 *   `public/`, its `/api/...` requests to the server, which runs as a separate process and listens
 *   on a named pipe, not on a port. Nothing outside the app can reach it.
 * - A new build (`release/build.json` changes) replaces the server, and the window reloads itself
 *   keeping what is typed, as with the launcher of the browser version. When this file itself is new,
 *   the app saves and starts again.
 * - Closing the window hides it in the tray: reminders keep coming. «Выйти» in the tray quits.
 * - It starts with Windows by Windows' own list (hidden, in the tray), and takes over from the old
 *   background server (FlintNotes.vbs) where that one is still running or set to start.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, protocol, screen, session, shell, Tray, utilityProcess, type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type UtilityProcess } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)
const here = path.dirname(self)
const SERVER = path.join(here, 'server.mjs')
const PUBLIC = path.join(here, 'public')
const BUILD = path.join(here, 'build.json')
const PRELOAD = path.join(here, 'preload.cjs')
const ICONS = path.join(here, 'icons')
const CONFIG = process.env.FLINT_CONFIG ?? path.join(os.homedir(), '.flintnotes.json')
/** The copy of the build inside the installed app (see scripts/installer.mjs): no new builds come to it. */
const BUNDLED = process.env.FLINT_BUNDLED === '1'
const readText = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
const selfText = readText(self)
const preloadText = readText(PRELOAD)

app.setName('FlintNotes')
// Tests give each run a profile of its own.
if (process.env.FLINT_USER_DATA) app.setPath('userData', process.env.FLINT_USER_DATA)
// The same id as the installer's shortcuts: notifications and the taskbar know the app by it.
const APP_ID = 'md.flintnotes.app'
app.setAppUserModelId(APP_ID)

// ---- the log: what the app and its server say, there being no console to say it in
const LOG = path.join(app.getPath('userData'), 'flintnotes.log')
fs.mkdirSync(path.dirname(LOG), { recursive: true })
if ((fs.statSync(LOG, { throwIfNoEntry: false })?.size ?? 0) > 1_000_000) fs.rmSync(LOG, { force: true })
const logFile = fs.createWriteStream(LOG, { flags: 'a' })
const note = (text: string) => logFile.write(`${new Date().toLocaleString('ru')}  ${text}\n`)

// A second start (a double click on the shortcut while the app runs) brings the window forward.
// `--quit` is how the installer asks a running app to close before it replaces its files.
const first = app.requestSingleInstanceLock()
// Nothing to quit: the installer asks this whether or not the app is running.
if (!first || process.argv.includes('--quit')) app.exit(0)
app.on('second-instance', (_event, argv) => (argv.includes('--quit') ? void quit() : showWindow()))

protocol.registerSchemesAsPrivileged([{ scheme: 'flint', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }])

// ---- the server: a process of its own, listening on a named pipe
interface Server {
  child: UtilityProcess
  pipe: string
}
/** The server the window's requests go to; while it starts, they wait for it. */
let current: Promise<Server>
let serial = 0
let quitting = false
let quickFailures = 0

const pipeName = () => {
  const id = `flintnotes-${process.pid}-${++serial}`
  return process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(os.tmpdir(), `${id}.sock`)
}

function startServer(): Promise<Server> {
  const pipe = pipeName()
  const startedAt = Date.now()
  const child = utilityProcess.fork(SERVER, [], {
    // The default vault (`vault`) lies next to the build, as for the launcher.
    cwd: BUNDLED ? os.homedir() : path.dirname(here),
    env: { ...process.env, FLINT_PIPE: pipe, FLINT_UPDATES: BUNDLED ? '0' : '1' },
    stdio: 'pipe',
    serviceName: 'FlintNotes server',
  })
  child.stdout?.on('data', (chunk) => logFile.write(chunk))
  child.stderr?.on('data', (chunk) => logFile.write(chunk))
  const ready = new Promise<Server>((resolve, reject) => {
    child.on('message', (message: { type?: string }) => message?.type === 'ready' && resolve({ child, pipe }))
    child.once('exit', (code) => reject(new Error(`Сервер остановился при запуске (код ${code})`)))
  })
  child.once('exit', (code) => {
    note(`Сервер на ${pipe} остановился (код ${code})`)
    void ready.then(async (server) => {
      // Stopped on purpose (a new build took over, the app quits): nothing to do.
      if (quitting || (await current.catch(() => null)) !== server) return
      quickFailures = Date.now() - startedAt < 10_000 ? quickFailures + 1 : 0
      current = quickFailures >= 3 ? Promise.reject(new Error('Сервер FlintNotes не запускается')) : startServer()
      current.catch(failed)
    }, () => {})
  })
  return ready
}

/** A server that cannot start leaves nothing to show: the user learns where to look. */
function failed(err: Error): void {
  note(err.message)
  if (quitting) return
  dialog.showErrorBox('FlintNotes', `${err.message}.\n\nПодробности — в журнале:\n${LOG}`)
  void quit()
}

/** Puts a new build's server in place: new requests go to it, the old one finishes its saves and steps aside. */
async function replaceServer(): Promise<void> {
  const old = await current.catch(() => null)
  const next = startServer()
  try {
    await next
  } catch (err) {
    note(`Новая сборка: сервер не запустился, остаётся прежний — ${(err as Error).message}`)
    return
  }
  current = next
  note('Новая сборка: сервер запущен заново')
  old?.child.postMessage('stop')
}

async function stopServer(): Promise<void> {
  // None yet: the app quits before starting one (an update of itself at start).
  const server = await current?.catch(() => null)
  if (!server) return
  await new Promise<void>((resolve) => {
    server.child.once('exit', () => resolve())
    server.child.postMessage('stop')
    // It finishes the saves it has begun within 5 seconds; this is only for a server that hangs.
    setTimeout(() => (server.child.kill(), resolve()), 8000)
  })
}

// ---- flint://app/: the page's files from disk, its requests to the server
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
  map: 'application/json',
  txt: 'text/plain; charset=utf-8',
}

async function staticFile(pathname: string): Promise<Response> {
  const wanted = path.join(PUBLIC, decodeURIComponent(pathname))
  const isFile = wanted.startsWith(PUBLIC + path.sep) && !!fs.statSync(wanted, { throwIfNoEntry: false })?.isFile()
  // Any other address is a place inside the app (a vault, a note), which the app itself resolves.
  const file = isFile ? wanted : path.join(PUBLIC, 'index.html')
  const body = await fs.promises.readFile(file)
  return new Response(body, { headers: { 'content-type': MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream' } })
}

async function forward(request: Request, url: URL): Promise<Response> {
  let server: Server
  try {
    server = await current
  } catch (err) {
    return new Response((err as Error).message, { status: 503 })
  }
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : Buffer.from(await request.arrayBuffer())
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => (headers[key] = value))
  // Only this app's window sends requests here: to the server they are what its own page sends.
  headers.host = 'localhost'
  headers.origin = 'http://localhost'
  if (body) headers['content-length'] = String(body.length)
  return new Promise((resolve) => {
    const sent = http.request({ socketPath: server.pipe, path: url.pathname + url.search, method: request.method, headers }, (res) => {
      const status = res.statusCode ?? 502
      const answered = new Headers()
      for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) answered.set(key, Array.isArray(value) ? value.join(', ') : value)
      const empty = request.method === 'HEAD' || [101, 204, 205, 304].includes(status)
      if (empty) res.resume()
      resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, headers: answered }))
    })
    // A page that goes away (a stream of changes closed, a tab reloaded) takes its request with it.
    request.signal?.addEventListener('abort', () => sent.destroy())
    sent.on('error', (err) => resolve(new Response(`Сервер FlintNotes не ответил: ${err.message}`, { status: 502 })))
    sent.end(body)
  })
}

// ---- the window
interface WindowState {
  bounds?: Electron.Rectangle
  maximized?: boolean
  /** The bar's colours, for the next start to open in them without a flash. */
  colors?: { color: string; symbolColor: string }
  /** The old background server's start with Windows was moved to the app already. */
  migrated?: boolean
  /** The newest shell an update was tried for: a start does not try the same one twice. */
  shellTried?: string
}
const STATE = path.join(app.getPath('userData'), 'window.json')
const state: WindowState = (() => {
  try {
    return JSON.parse(readText(STATE)) as WindowState
  } catch {
    return {}
  }
})()
let saveTimer: NodeJS.Timeout | undefined
const saveState = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => fs.writeFile(STATE, JSON.stringify(state, null, 2), () => {}), 500)
}

let win: BrowserWindow | undefined
let tray: Tray | undefined

/** Where the window was, if that place is still on one of the screens. */
function placed(bounds: Electron.Rectangle | undefined): Partial<Electron.Rectangle> | undefined {
  if (!bounds) return undefined
  const visible = screen.getAllDisplays().some(({ workArea: area }) => bounds.x < area.x + area.width - 100 && bounds.x + bounds.width > area.x + 100 && bounds.y >= area.y - 10 && bounds.y < area.y + area.height - 100)
  // A screen taken away since: the same size, in the middle of the screen there is.
  return visible ? bounds : { width: bounds.width, height: bounds.height }
}

const icon = (name: string) => nativeImage.createFromPath(path.join(ICONS, name))

function createWindow(): BrowserWindow {
  const colors = state.colors ?? { color: '#262626', symbolColor: '#dadada' }
  const window = new BrowserWindow({
    ...(placed(state.bounds) ?? { width: 1280, height: 820 }),
    minWidth: 480,
    minHeight: 320,
    show: false,
    title: 'FlintNotes',
    icon: icon(process.platform === 'win32' ? 'flintnotes.ico' : 'flintnotes.png'),
    backgroundColor: colors.color,
    // No frame of the system's: the bar of tabs is the title bar, and the system's buttons lie over its right end.
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...colors, height: 40 },
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, backgroundThrottling: false },
  })
  if (state.maximized) window.maximize()
  // Started with Windows, the app waits in the tray; the page loads all the same, for the reminders.
  window.once('ready-to-show', () => !process.argv.includes('--hidden') && window.show())
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  const remember = () => {
    state.maximized = window.isMaximized()
    if (!state.maximized && !window.isFullScreen()) state.bounds = window.getNormalBounds()
    saveState()
  }
  window.on('resize', remember)
  window.on('move', remember)
  window.on('maximize', remember)
  window.on('unmaximize', remember)
  // Signing out of Windows ends the app without asking: what is typed is saved first.
  window.on('session-end', () => void flushPages())
  window.webContents.on('render-process-gone', (_event, details) => {
    note(`Страница упала (${details.reason}), загружаю заново`)
    if (!quitting) window.reload()
  })
  window.webContents.on('before-input-event', (event, input) => {
    // Tools for looking inside the page, as in a browser.
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      window.webContents.toggleDevTools()
      event.preventDefault()
    }
  })
  void window.loadURL('flint://app/')
  return window
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Asks every page to save what it has; a page that does not answer in time is not waited for. */
let flushes = 0
function flushPages(): Promise<void> {
  return Promise.all(
    BrowserWindow.getAllWindows().map(
      (window) =>
        new Promise<void>((resolve) => {
          const id = ++flushes
          const done = (_event: IpcMainEvent, answered: number) => answered === id && finish()
          const finish = () => {
            ipcMain.off('flushed', done)
            clearTimeout(late)
            resolve()
          }
          const late = setTimeout(finish, 4000)
          ipcMain.on('flushed', done)
          window.webContents.send('flush', id)
        }),
    ),
  ).then(() => {})
}

async function quit(): Promise<void> {
  if (quitting) return
  await flushPages()
  quitting = true
  tray?.destroy()
  await stopServer()
  app.exit(0)
}

// ---- starting with the system
// Linux keeps it as a file (used by the tests: FLINT_AUTOSTART_DIR); Windows and macOS in their own lists.
const LINUX_AUTOSTART = path.join(process.env.FLINT_AUTOSTART_DIR ?? path.join(os.homedir(), '.config', 'autostart'), 'flintnotes.desktop')
const loginArgs = ['--hidden']
function autostart(): boolean {
  if (process.platform === 'linux') return fs.existsSync(LINUX_AUTOSTART)
  return app.getLoginItemSettings({ path: process.execPath, args: loginArgs }).openAtLogin
}
function setAutostart(enabled: boolean): boolean {
  if (process.platform === 'linux') {
    if (!enabled) fs.rmSync(LINUX_AUTOSTART, { force: true })
    else {
      fs.mkdirSync(path.dirname(LINUX_AUTOSTART), { recursive: true })
      const command = [process.execPath, ...process.argv.slice(1).filter((arg) => !arg.startsWith('--')), ...loginArgs].map((part) => `"${part.replace(/(["\\$`])/g, '\\$1')}"`).join(' ')
      fs.writeFileSync(LINUX_AUTOSTART, `[Desktop Entry]\nType=Application\nName=FlintNotes\nExec=${command}\nTerminal=false\n`)
    }
  } else app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: loginArgs, name: 'FlintNotes' })
  buildTrayMenu()
  return autostart()
}

// ---- the old background server (FlintNotes.vbs, release/launcher.mjs): the app takes its place
const readConfig = (): { port?: number; proxy?: string } => {
  try {
    return JSON.parse(readText(CONFIG))
  } catch {
    return {}
  }
}

async function takeOver(): Promise<void> {
  if (process.platform !== 'win32') return
  // Its start with Windows becomes the app's: both at once would serve the same vaults.
  const startup = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'FlintNotes.vbs')
  if (fs.existsSync(startup) && Buffer.from(fs.readFileSync(startup)).toString('utf16le').includes('launcher.mjs')) {
    fs.rmSync(startup, { force: true })
    if (!state.migrated) setAutostart(true)
    note('Запуск вместе с Windows перенесён с FlintNotes.vbs на приложение')
  }
  state.migrated = true
  saveState()
  // A server running now is asked to stop the way the app's own page stops it; the launcher then stops too.
  const port = readConfig().port ?? 4600
  await new Promise<void>((resolve) => {
    const asked = http.request({ host: '127.0.0.1', port, path: '/api/quit', method: 'POST', headers: { origin: `http://127.0.0.1:${port}` }, timeout: 2000 }, (res) => {
      if (res.statusCode === 200) note(`Остановлен прежний сервер FlintNotes на порту ${port}`)
      res.resume()
      resolve()
    })
    asked.on('error', () => resolve())
    asked.on('timeout', () => (asked.destroy(), resolve()))
    asked.end()
  })
}

// ---- the way to the web: the same proxy as the server's (Программа → Сеть), for pictures and embeds of the page
let proxyApplied: string | undefined
function applyProxy(): void {
  const proxy = readConfig().proxy ?? 'system'
  if (proxy === proxyApplied) return
  proxyApplied = proxy
  if (proxy === 'system') void session.defaultSession.setProxy({ mode: 'system' })
  else if (proxy === 'off') void session.defaultSession.setProxy({ mode: 'direct' })
  else {
    try {
      const url = new URL(proxy)
      void session.defaultSession.setProxy({ proxyRules: `${url.protocol}//${url.host}`, proxyBypassRules: '<local>' })
    } catch {
      void session.defaultSession.setProxy({ mode: 'system' })
    }
  }
}
// A proxy that asks for a name and password gets those of its address.
app.on('login', (event, _webContents, _details, authInfo, callback) => {
  if (!authInfo.isProxy) return
  try {
    const url = new URL(readConfig().proxy ?? '')
    if (!url.username) return
    event.preventDefault()
    callback(decodeURIComponent(url.username), decodeURIComponent(url.password))
  } catch {}
})

// ---- the tray
function buildTrayMenu(): void {
  if (!tray) return
  const items: MenuItemConstructorOptions[] = [
    ...(pending ? [{ label: `${pending.title}: перезапустить`, click: pending.apply }, { type: 'separator' as const }] : []),
    { label: 'Открыть FlintNotes', click: showWindow },
    { label: 'Новая заметка', click: () => (showWindow(), win?.webContents.send('command', 'core:new-note')) },
    { label: 'Палитра команд', click: () => (showWindow(), win?.webContents.send('command', 'core:command-palette')) },
    { type: 'separator' },
    { label: 'Запускать вместе с Windows', type: 'checkbox', checked: autostart(), click: (item) => setAutostart(item.checked) },
    { label: 'Журнал работы', click: () => void shell.openPath(LOG) },
    { type: 'separator' },
    { label: 'Выйти', click: () => void quit() },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function createTray(): void {
  tray = new Tray(icon(process.platform === 'win32' ? 'flintnotes.ico' : 'tray.png'))
  tray.setToolTip('FlintNotes')
  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
  buildTrayMenu()
}

// ---- what pages may do
const isApp = (url: string | undefined) => !!url && url.startsWith('flint://app/')
/** Only the app's own page, not a frame inside it, talks to the app. */
const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => !!event.senderFrame && event.senderFrame === event.sender.mainFrame && isApp(event.senderFrame.url)
/** Links to the web open in the browser of the system, never in the app's window. */
const openOutside = (address: string) => {
  try {
    const url = new URL(address)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') void shell.openExternal(url.href)
  } catch {}
}
const ALLOWED = new Set(['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'])

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isApp(url)) return
    event.preventDefault()
    openOutside(url)
  })
  // The app saves before it closes or reloads; a page's «leave?» would only stand in the way.
  contents.on('will-prevent-unload', (event) => event.preventDefault())
  // The page's own menus come first; where it has none (text, links), the usual one, with spelling suggestions.
  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    for (const word of params.dictionarySuggestions.slice(0, 6)) items.push({ label: word, click: () => contents.replaceMisspelling(word) })
    if (params.misspelledWord) items.push({ label: 'Добавить в словарь', click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' })
    if (/^(https?|mailto):/i.test(params.linkURL)) items.push({ label: 'Открыть ссылку в браузере', click: () => openOutside(params.linkURL) }, { label: 'Копировать ссылку', click: () => clipboard.writeText(params.linkURL) }, { type: 'separator' })
    if (params.isEditable) items.push({ label: 'Вырезать', role: 'cut', enabled: params.editFlags.canCut }, { label: 'Копировать', role: 'copy', enabled: params.editFlags.canCopy }, { label: 'Вставить', role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { label: 'Выделить всё', role: 'selectAll' })
    else if (params.selectionText) items.push({ label: 'Копировать', role: 'copy' })
    while (items.at(-1)?.type === 'separator') items.pop()
    if (items.length) Menu.buildFromTemplate(items).popup()
  })
})

ipcMain.on('title-bar-colors', (event, colors: { color?: unknown; symbolColor?: unknown }) => {
  if (!trusted(event) || typeof colors?.color !== 'string' || typeof colors.symbolColor !== 'string') return
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return
  window.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 40 })
  window.setBackgroundColor(colors.color)
  state.colors = { color: colors.color, symbolColor: colors.symbolColor }
  saveState()
})
ipcMain.handle('autostart', (event) => (trusted(event) ? { enabled: autostart() } : null))
ipcMain.handle('set-autostart', (event, enabled: unknown) => (trusted(event) ? { enabled: setAutostart(!!enabled) } : null))
ipcMain.on('quit', (event) => trusted(event) && void quit())
ipcMain.on('show', (event) => trusted(event) && showWindow())

// ---- new builds: the server is replaced; a new app (this file, the preload) means starting again
const buildId = () => {
  try {
    return JSON.parse(readText(BUILD)).id ?? ''
  } catch {
    return ''
  }
}
let build = buildId()
if (first && !BUNDLED)
  // Polling, not file events: the build is written from WSL onto a Windows drive, and events do not always cross that border.
  fs.watchFile(BUILD, { interval: 2000 }, () => {
    const next = buildId()
    if (!next || next === build || quitting) return
    build = next
    // The notes app and its server change at once; the app's own part (this file, the preload) on a restart.
    void replaceServer()
    if (readText(self) === selfText && readText(PRELOAD) === preloadText) return
    note('Новая сборка приложения: оно обновится при перезапуске')
    offer({ title: 'Обновление FlintNotes готово', body: 'Щёлкните, чтобы перезапустить приложение. Иначе обновление придёт при следующем запуске', apply: restart })
  })

/** Starts the app again the way it is now: with its window, or in the tray. */
function restart(): void {
  app.relaunch({ args: [...process.argv.slice(1).filter((arg) => arg !== '--hidden'), ...(win?.isVisible() ? [] : ['--hidden'])] })
  void quit()
}

// ---- updates of the app itself (a new Electron, icon or stub): a new installer in the project's `updates`
// folder (scripts/installer.mjs). Only the installed app has a shell to update (desktop/stub.cjs says where it is).
interface Latest {
  shell: string
  file: string
  sha256: string
  version: string
}
const UPDATES_DIR = process.env.FLINT_UPDATES_DIR
const ownShell = (() => {
  try {
    return (JSON.parse(readText(process.env.FLINT_SHELL ?? '')) as { shell?: string }).shell
  } catch {
    return undefined
  }
})()

/** The newest installer, if it brings another shell than this one and is complete. */
function newerShell(): (Latest & { setup: string }) | undefined {
  if (!UPDATES_DIR || !ownShell) return undefined
  try {
    const latest = JSON.parse(readText(path.join(UPDATES_DIR, 'latest.json'))) as Latest
    if (!latest.shell || latest.shell === ownShell) return undefined
    const setup = path.join(UPDATES_DIR, path.basename(latest.file))
    if (createHash('sha256').update(fs.readFileSync(setup)).digest('hex') !== latest.sha256) return undefined
    return { ...latest, setup }
  } catch {
    return undefined
  }
}

/** Runs the installer silently; it closes this app (which saves first) and starts the new one. */
function installShell(update: Latest & { setup: string }, hidden: boolean): void {
  note(`Обновление приложения: ${ownShell} → ${update.shell}`)
  state.shellTried = update.shell
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2))
  spawn(update.setup, ['/S', '--run', ...(hidden ? ['--hidden'] : [])], { detached: true, stdio: 'ignore' }).unref()
  void quit()
}

let offered: string | undefined
function checkShell(): void {
  const update = newerShell()
  if (!update || offered === update.shell || quitting) return
  offered = update.shell
  offer({ title: `Обновление FlintNotes ${update.version}`, body: 'Щёлкните, чтобы перезапустить приложение с обновлением. Иначе оно установится при следующем запуске', apply: () => installShell(update, !win?.isVisible()) })
}

/** What an update offers: a notification to click, and the same in the tray's menu until it is done. */
let pending: { title: string; apply: () => void } | undefined
function offer({ title, body, apply }: { title: string; body: string; apply: () => void }): void {
  pending = { title, apply }
  buildTrayMenu()
  if (!Notification.isSupported()) return
  const shown = new Notification({ title, body, icon: icon(process.platform === 'win32' ? 'flintnotes.ico' : 'flintnotes.png') })
  shown.on('click', apply)
  shown.show()
}

/** On a Windows of today, the app's notifications are shown only for a Start menu shortcut that carries its id. */
function markShortcut(): void {
  if (process.platform !== 'win32') return
  const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'FlintNotes.lnk')
  try {
    const details = shell.readShortcutLink(link)
    if (details.appUserModelId !== APP_ID) shell.writeShortcutLink(link, 'update', { ...details, appUserModelId: APP_ID })
  } catch {
    // No shortcut (the app runs from a folder of its own): notifications may not show.
  }
}

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  void quit()
})
// The window only hides; should it ever be closed, the app stays in the tray.
app.on('window-all-closed', () => {})

process.on('uncaughtException', (err) => note(`Ошибка: ${err.stack ?? err.message}`))

void app.whenReady().then(async () => {
  if (!first) return
  note(`Запуск: ${process.execPath} ${process.argv.slice(1).join(' ')} (сборка ${build || 'для разработки'}${BUNDLED ? ', своя копия' : `, из ${here}`})`)
  Menu.setApplicationMenu(null)
  // An update of the app that was not taken last time is taken now, before anything else starts (once per update).
  const update = newerShell()
  if (update && state.shellTried !== update.shell) return installShell(update, process.argv.includes('--hidden'))
  markShortcut()
  await takeOver().catch((err) => note(`Не удалось сменить прежний сервер: ${err.message}`))
  current = startServer()
  current.catch(failed)
  applyProxy()
  fs.watchFile(CONFIG, { interval: 2000 }, applyProxy)
  session.defaultSession.setPermissionRequestHandler((_contents, permission, allow, details) => allow(ALLOWED.has(permission) && (permission === 'fullscreen' || isApp(details.requestingUrl))))
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => ALLOWED.has(permission) && (permission === 'fullscreen' || origin.startsWith('flint://app')))
  // Windows and macOS check spelling with the system's own languages; elsewhere they are named.
  if (process.platform === 'linux') session.defaultSession.setSpellCheckerLanguages(['ru', 'en-US'])
  protocol.handle('flint', (request) => {
    const url = new URL(request.url)
    if (url.host !== 'app') return new Response('Not found', { status: 404 })
    return url.pathname.startsWith('/api/') ? forward(request, url) : staticFile(url.pathname)
  })
  createTray()
  if (UPDATES_DIR) {
    checkShell()
    fs.watchFile(path.join(UPDATES_DIR, 'latest.json'), { interval: 10_000 }, checkShell)
  }
  win = createWindow()
})
