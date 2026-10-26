/**
 * FlintNotes as a desktop app (Electron): the main process. Built by `npm run release` into
 * `release/desktop.mjs`, next to the server and the page it runs.
 *
 * - The page is the same as in a browser, served from `flint://app/`: its files straight from
 *   `public/`, its `/api/...` requests to the server, which runs as a separate process and listens
 *   on a named pipe, not on a port. Nothing outside the app can reach it.
 * - A new build (`release/build.json` changes) replaces the server, and the window reloads itself
 *   keeping what is typed, as with the launcher of the browser version. When this file itself is new,
 *   the app saves and restarts itself, the way it was (with its window, or in the tray).
 * - Closing the window hides it in the tray: reminders keep coming. «Выйти» in the tray quits.
 * - It starts with Windows by Windows' own list (hidden, in the tray), and takes over from the old
 *   background server of the browser version (release/launcher.mjs) where that one is still running.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, Notification, protocol, screen, session, shell, Tray, utilityProcess, type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type UtilityProcess } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

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
// Written at once: the last words before the app exits (an update being put in) must not stay in a buffer.
const note = (text: string) => fs.appendFileSync(LOG, `${new Date().toLocaleString('ru')}  ${text}\n`)

// A second start (a double click on the shortcut while the app runs) brings the window forward.
// `--quit` is how the installer asks a running app to close before it replaces its files.
// With `--quit` and no app running there is nothing to do: the installer asks it whether or not the app runs.
const first = app.requestSingleInstanceLock() && !process.argv.includes('--quit')
if (!first) app.exit(0)
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
    // Until the user opens a vault of their own, the sandbox is the one opened.
    env: { ...process.env, FLINT_PIPE: pipe, FLINT_UPDATES: BUNDLED ? '0' : '1', ...(fs.existsSync(SANDBOX) ? { FLINT_FIRST_VAULT: SANDBOX } : {}) },
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
  /** The newest version an update was tried for: it is not tried again by itself. */
  updateTried?: string
  /** Updates are looked for, downloaded and put in by themselves (Программа → Обновление); on unless switched off. */
  autoUpdate?: boolean
  /** A newer version downloaded and checked, waiting for the user's word or the next start: an installer, or the folder of a light update. */
  ready?: { version: string; sha256: string; setup?: string; dir?: string }
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
    // A window in the tray, minimised or covered draws nothing: an animated picture in a note would
    // otherwise go on being decoded frame by frame (a GIF of 50 MB took half a processor core).
    // Reminders keep their time there all the same: their clock runs on a worker (tasks/reminders.ts).
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
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
/**
 * Windows keeps it in its Run list, under the app's id (Electron reads it back only under that name), and
 * Task Manager may switch it off there. What counts is whether this program really starts with Windows.
 */
function autostart(): boolean {
  if (process.platform === 'linux') return fs.existsSync(LINUX_AUTOSTART)
  const settings = app.getLoginItemSettings({ path: process.execPath, args: loginArgs })
  return process.platform === 'win32' ? settings.executableWillLaunchAtLogin : settings.openAtLogin
}
/** The entry the first builds wrote under the name «FlintNotes», which Electron could not read back. */
const LEGACY_LOGIN_NAME = 'FlintNotes'
const legacyLogin = () =>
  process.platform === 'win32' ? app.getLoginItemSettings({ path: process.execPath }).launchItems.filter((item) => item.name === LEGACY_LOGIN_NAME && item.path.toLowerCase() === process.execPath.toLowerCase()) : []
function setAutostart(enabled: boolean): boolean {
  if (process.platform === 'linux') {
    if (!enabled) fs.rmSync(LINUX_AUTOSTART, { force: true })
    else {
      fs.mkdirSync(path.dirname(LINUX_AUTOSTART), { recursive: true })
      // An AppImage runs from a new place each time: what starts it is the AppImage's own file.
      const command = [...(process.env.APPIMAGE ? [process.env.APPIMAGE] : [process.execPath, ...process.argv.slice(1).filter((arg) => !arg.startsWith('--'))]), ...loginArgs].map((part) => `"${part.replace(/(["\\$`])/g, '\\$1')}"`).join(' ')
      fs.writeFileSync(LINUX_AUTOSTART, `[Desktop Entry]\nType=Application\nName=FlintNotes\nExec=${command}\nTerminal=false\n`)
    }
  } else {
    for (const item of legacyLogin()) app.setLoginItemSettings({ openAtLogin: false, path: item.path, args: item.args, name: item.name })
    // `enabled` also switches it on again where Task Manager had switched it off.
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: loginArgs, name: APP_ID, enabled: true })
  }
  buildTrayMenu()
  return autostart()
}

// ---- the sandbox: a vault of examples to try anything in, as Obsidian has. It is made anew from its template
// (release/sandbox, from desktop/sandbox) at every start, so nothing done in it lasts.
const SANDBOX = path.join(app.getPath('userData'), 'Песочница')
function freshSandbox(): void {
  const template = path.join(here, 'sandbox')
  if (!fs.existsSync(template)) return
  // Only a folder the app made itself is emptied: it carries the template's mark.
  if (fs.existsSync(SANDBOX) && !fs.existsSync(path.join(SANDBOX, '.flint', 'sandbox'))) return void note(`${SANDBOX} — не песочница приложения, не трогаю`)
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.cpSync(template, SANDBOX, { recursive: true })
}

// ---- the browser version's background server (release/launcher.mjs): the app takes its place
const readConfig = (): { port?: number; proxy?: string } => {
  try {
    return JSON.parse(readText(CONFIG))
  } catch {
    return {}
  }
}

async function takeOver(): Promise<void> {
  if (process.platform !== 'win32') return
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
    ...(state.ready ? [{ label: `Обновить до версии ${state.ready.version}`, click: () => (showWindow(), void askToUpdate()) }, { type: 'separator' as const }] : []),
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
ipcMain.handle('updates', (event) => (trusted(event) ? updateInfo() : null))
ipcMain.handle('set-updates', (event, enabled: unknown) => {
  if (!trusted(event)) return null
  state.autoUpdate = !!enabled
  saveStateNow()
  if (enabled) void checkForUpdate()
  return updateInfo()
})
// The answer comes as soon as it is known whether there is something new; the settings follow a download by asking again.
ipcMain.handle('check-updates', async (event) => {
  if (!trusted(event)) return null
  const done = checkForUpdate(true)
  const result = await Promise.race([done, new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))])
  return { ...updateInfo(), result: result ?? lastResult }
})
ipcMain.handle('install-update', (event) => {
  if (!trusted(event) || !state.ready || !readyUsable(state.ready)) return false
  install(state.ready, false)
  return true
})

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
    // The notes app and its server change at once; the app's own part (this file, the preload) by a restart of itself.
    if (readText(self) === selfText && readText(PRELOAD) === preloadText) return void replaceServer()
    note('Новая сборка приложения: перезапускаю его')
    restart()
  })

/** Starts the app again the way it is now: with its window, or in the tray. */
function restart(): void {
  app.relaunch({ args: [...process.argv.slice(1).filter((arg) => arg !== '--hidden'), ...(win?.isVisible() ? [] : ['--hidden'])] })
  void quit()
}

// ---- updates of the installed app: the newest release of the project on GitHub (scripts/installer.mjs makes
// its files and latest.json). The app looks soon after start, every hour and when its window comes forward
// after a while. A release made for the same Electron brings only the app's own files (a pack of a few
// megabytes): it is unpacked into the user's folder, where the stub (desktop/stub.cjs) starts it from, and
// «Обновить» only starts the app again. Otherwise the new installer is downloaded and run silently. Either is
// checked against its checksum first, and the user is asked; one click saves what is typed and puts it in.
interface Asset {
  file: string
  sha256: string
  size?: number
}
/** The newest release: its version, the Electron it was made with, and the files that bring it. */
interface Latest {
  version: string
  electron?: string
  /** The app's own files, for an app whose Electron is the same. */
  app?: Asset
  windows?: Asset
  linux?: Asset
}
/**
 * What a whole new version comes as here: on Windows an installer (run silently), on Linux the AppImage itself,
 * which takes the place of the one running (its path is in APPIMAGE). Elsewhere only light updates come.
 */
const SYSTEM = process.platform === 'win32' ? ({ key: 'windows', file: /^FlintNotes-Setup-[\w.-]+\.exe$/ } as const) : process.platform === 'linux' && process.env.APPIMAGE ? ({ key: 'linux', file: /^FlintNotes-[\w.-]+\.AppImage$/ } as const) : undefined
const FEED = process.env.FLINT_UPDATE_FEED ?? 'https://github.com/jestxfot/FlintNotes/releases/latest/download/latest.json'
/** Where light updates are unpacked; the stub of an installed app says it (a run from the sources has none). */
const BUILDS = process.env.FLINT_BUILDS
/** The installed app's version (desktop/stub.cjs says where it is written); a run from the sources has none and updates nothing. */
const ownVersion = (() => {
  try {
    return (JSON.parse(readText(process.env.FLINT_SHELL ?? '')) as { version?: string }).version
  } catch {
    return undefined
  }
})()
const isNewer = (version: string, than: string) => {
  const [a, b] = [version, than].map((one) => one.split('.').map((part) => parseInt(part, 10) || 0))
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/** Where downloaded installers wait to be put in: the app's own folder, which the system does not clean as it does temp. */
const DOWNLOADS = path.join(app.getPath('userData'), 'updates')
const sha256Of = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const autoUpdates = () => state.autoUpdate !== false
const saveStateNow = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2))
const updatable = () => !!ownVersion && (!!SYSTEM || !!BUILDS)

let checking = false
/** The download under way, for the settings to show. */
let progress: { version: string; loaded: number; total: number; light: boolean } | null = null
/** What the last look found, in words. */
let lastResult = ''
let lastChecked = 0

/** What the settings show about updates. */
const updateInfo = () => ({
  supported: updatable(),
  enabled: autoUpdates(),
  version: ownVersion,
  ready: state.ready?.version,
  light: !!state.ready?.dir,
  checking,
  progress,
  result: lastResult,
  checkedAt: lastChecked || undefined,
})

/** A downloaded version is still there as it was checked. */
const readyUsable = (ready: NonNullable<WindowState['ready']>) =>
  ready.dir ? fs.existsSync(path.join(ready.dir, 'release', 'desktop.mjs')) : !!ready.setup && fs.existsSync(ready.setup) && sha256Of(ready.setup) === ready.sha256

/**
 * Looks for a newer release and downloads it (once). The app's own looks happen only with updates on;
 * the user's «Проверить» always. The answer is for the settings: what was found.
 */
async function checkForUpdate(manual = false): Promise<string> {
  if (!updatable()) return 'Обновления приходят только установленному приложению'
  if ((!manual && !autoUpdates()) || quitting) return ''
  if (checking) return lastResult
  checking = true
  const said = (text: string) => (lastResult = text)
  said('Проверяю…')
  try {
    // Through the app's own session: the same proxy as the window's.
    const answer = await net.fetch(FEED, { cache: 'no-store' })
    lastChecked = Date.now()
    if (answer.status === 404) return said('Опубликованных версий пока нет')
    if (!answer.ok) throw new Error(`${FEED} ответил ${answer.status}`)
    const latest = (await answer.json()) as Latest
    if (typeof latest?.version !== 'string' || !isNewer(latest.version, ownVersion!)) return said(`Установлена последняя версия (${ownVersion})`)
    // A version that was put in and did not take (the app is still the old one) is not tried again and again.
    if (state.updateTried === latest.version && !manual) return note(`Версия ${latest.version} уже ставилась и не встала: работаю на ${ownVersion}`), said('')
    // Downloaded already: asked again, and the next start puts it in.
    if (state.ready?.version === latest.version && readyUsable(state.ready)) return offerUpdate(), said(`Версия ${latest.version} загружена`)
    const light = !!BUILDS && !!latest.app && latest.electron === process.versions.electron
    const asset = light ? latest.app : SYSTEM ? latest[SYSTEM.key] : undefined
    if (!asset) return said(`Версия ${latest.version} вышла без сборки для этой системы`)
    const named = light ? /^FlintNotes-[\w.-]+-app\.pack$/ : SYSTEM!.file
    if (!named.test(asset.file) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error(`непонятный latest.json ${JSON.stringify(latest)}`)
    note(`Загружаю ${light ? 'обновление' : 'установщик'} ${ownVersion} → ${latest.version}`)
    said(`Загружаю версию ${latest.version}…`)
    const bytes = await download(new URL(asset.file, FEED).href, latest.version, asset.size ?? 0, light)
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('контрольная сумма новой версии не сошлась')
    fs.rmSync(DOWNLOADS, { recursive: true, force: true })
    if (light) {
      const dir = path.join(BUILDS!, latest.version)
      unpack(bytes, dir)
      // The next start runs it, whether or not the user says «Обновить» now.
      fs.writeFileSync(path.join(BUILDS!, 'current.json'), JSON.stringify({ version: latest.version, dir: latest.version }))
      state.ready = { version: latest.version, sha256: asset.sha256, dir }
    } else {
      fs.mkdirSync(DOWNLOADS, { recursive: true })
      const setup = path.join(DOWNLOADS, asset.file)
      fs.writeFileSync(setup, bytes, { mode: 0o755 })
      state.ready = { setup, version: latest.version, sha256: asset.sha256 }
    }
    saveStateNow()
    buildTrayMenu()
    offerUpdate()
    return said(`Загружена версия ${latest.version}`)
  } catch (err) {
    note(`Обновление не удалось: ${(err as Error).message}`)
    return said(`Не удалось: ${(err as Error).message}`)
  } finally {
    checking = false
    progress = null
  }
}

/** Downloads a file of a release, counting what came for the settings. */
async function download(url: string, version: string, size: number, light: boolean): Promise<Buffer> {
  const answer = await net.fetch(url)
  if (!answer.ok || !answer.body) throw new Error(`новая версия не загрузилась (${answer.status})`)
  const counting = { version, loaded: 0, total: Number(answer.headers.get('content-length')) || size, light }
  progress = counting
  const parts: Uint8Array[] = []
  const reader = answer.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    counting.loaded += value.length
  }
  return Buffer.concat(parts)
}

/**
 * Unpacks the app's own files (scripts/installer.mjs packs them: a line with the list of files and their sizes,
 * then the files one after another, all gzipped) into `dir`, beside it first, so a half-written build is never there.
 */
function unpack(packed: Buffer, dir: string): void {
  const all = zlib.gunzipSync(packed)
  const end = all.indexOf(10)
  const files = JSON.parse(all.subarray(0, end).toString('utf8')) as { path: string; size: number }[]
  const part = `${dir}.part`
  fs.rmSync(part, { recursive: true, force: true })
  let at = end + 1
  for (const file of files) {
    const target = path.resolve(part, file.path)
    if (!target.startsWith(part + path.sep) || !Number.isInteger(file.size) || file.size < 0) throw new Error(`непонятный файл в обновлении: ${file.path}`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, all.subarray(at, at + file.size))
    at += file.size
  }
  if (at !== all.length || !fs.existsSync(path.join(part, 'release', 'desktop.mjs'))) throw new Error('обновление пришло не целым')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.renameSync(part, dir)
}

/**
 * At start, before anything else: a newer installer downloaded earlier and not taken then («Позже», or the
 * computer was turned off) is put in now, with no question; the app comes back the way it was started.
 * A light update needs nothing: the stub has started it already.
 */
function installWaiting(): boolean {
  // The stub could not start a light update: it is not tried again by itself.
  const failed = BUILDS ? (JSON.parse(readText(path.join(BUILDS, 'failed.json')) || 'null') as { version?: string; error?: string } | null) : null
  if (failed?.version) {
    note(`Обновление ${failed.version} не запустилось, работаю на ${ownVersion}: ${failed.error ?? ''}`)
    state.updateTried = failed.version
    if (state.ready?.version === failed.version) delete state.ready
    fs.rmSync(path.join(BUILDS!, 'failed.json'), { force: true })
    saveStateNow()
  }
  const waiting = state.ready
  if (!waiting || !ownVersion) return false
  if (!isNewer(waiting.version, ownVersion) || !readyUsable(waiting)) {
    // Put in already (this is the new version), or spoilt: it goes.
    delete state.ready
    saveStateNow()
    fs.rmSync(DOWNLOADS, { recursive: true, force: true })
    return false
  }
  if (waiting.dir || !autoUpdates() || state.updateTried === waiting.version) return false
  install(waiting, process.argv.includes('--hidden'))
  return true
}

/** Builds of light updates that are neither running nor waiting go. */
function cleanBuilds(): void {
  if (!BUILDS || !fs.existsSync(BUILDS)) return
  const keep = new Set([path.basename(path.dirname(here)), state.ready?.dir ? path.basename(state.ready.dir) : ''])
  for (const entry of fs.readdirSync(BUILDS, { withFileTypes: true })) {
    if (entry.isDirectory() && !keep.has(entry.name)) fs.rmSync(path.join(BUILDS, entry.name), { recursive: true, force: true })
  }
}

let asking = false

/** With the window open the user is asked at once; in the tray, a notification asks to open the question. */
function offerUpdate(): void {
  const waiting = state.ready
  if (!waiting || asking || quitting) return
  if (win?.isVisible()) return void askToUpdate()
  note(`Обновление ${waiting.version} ждёт ответа или следующего запуска`)
  if (!Notification.isSupported()) return
  const shown = new Notification({ title: `Доступна новая версия FlintNotes ${waiting.version}`, body: 'Щёлкните, чтобы обновить сейчас. Иначе она установится при следующем запуске', icon: icon(process.platform === 'win32' ? 'flintnotes.ico' : 'flintnotes.png') })
  shown.on('click', () => (showWindow(), askToUpdate()))
  shown.show()
}

async function askToUpdate(): Promise<void> {
  const waiting = state.ready
  if (!waiting || asking || quitting) return
  asking = true
  const options = {
    type: 'info' as const,
    title: 'Обновление FlintNotes',
    message: `Доступна новая версия FlintNotes ${waiting.version}`,
    detail: waiting.dir
      ? `Сейчас у вас ${ownVersion}. Новая версия загружена и проверена: FlintNotes сохранит набранное и перезапустится за пару секунд. Если отложить, она запустится сама при следующем запуске.`
      : `Сейчас у вас ${ownVersion}. Новая версия уже загружена и проверена: FlintNotes сохранит набранное, установит её и откроется снова. Если отложить, она установится сама при следующем запуске.`,
    buttons: ['Обновить', 'Позже'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
  asking = false
  if (response === 0 && state.ready?.version === waiting.version) return install(waiting, !win?.isVisible())
  note(`Обновление ${waiting.version} отложено до следующего запуска`)
}

/**
 * Puts the new version in and starts it the way this one was (with its window, or in the tray). A light update
 * is in place already: the app only starts again. On Windows the installer does it, silently, closing this app
 * (which saves first); on Linux the new AppImage takes the old one's place.
 */
function install(ready: NonNullable<WindowState['ready']>, hidden: boolean): void {
  note(`Ставлю обновление ${ready.version}`)
  state.updateTried = ready.version
  saveStateNow()
  if (ready.dir) {
    app.relaunch({ args: [...process.argv.slice(1).filter((arg) => arg !== '--hidden'), ...(hidden ? ['--hidden'] : [])] })
    return void quit()
  }
  const appImage = process.env.APPIMAGE
  if (process.platform === 'linux' && appImage) {
    try {
      // Beside it first, then in its place at once: a half-written AppImage would not start.
      fs.copyFileSync(ready.setup!, `${appImage}.new`)
      fs.chmodSync(`${appImage}.new`, 0o755)
      fs.renameSync(`${appImage}.new`, appImage)
    } catch (err) {
      return void note(`Обновление не встало: ${(err as Error).message}`)
    }
    app.relaunch({ execPath: appImage, args: hidden ? ['--hidden'] : [] })
  } else spawn(ready.setup!, ['/S', '--run', ...(hidden ? ['--hidden'] : [])], { detached: true, stdio: 'ignore' }).unref()
  void quit()
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
  // A version downloaded before is put in before anything else starts; the app then comes back as the new one.
  if (installWaiting()) return
  markShortcut()
  await takeOver().catch((err) => note(`Не удалось сменить прежний сервер: ${err.message}`))
  if (legacyLogin().length) note(`Запуск вместе с Windows записан заново: ${setAutostart(true) ? 'включён' : 'не включился'}`)
  try {
    freshSandbox()
  } catch (err) {
    note(`Песочница не обновилась: ${(err as Error).message}`)
  }
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
  // A few seconds after start, not to compete with opening the vault; then every few hours.
  setTimeout(() => void checkForUpdate(), Number(process.env.FLINT_UPDATE_DELAY ?? 3000))
  setInterval(() => void checkForUpdate(), 3_600_000)
  setTimeout(() => {
    try {
      cleanBuilds()
    } catch (err) {
      note(`Старые сборки не убраны: ${(err as Error).message}`)
    }
  }, 60_000)
  win = createWindow()
  // The window brought forward after a while looks again: a release made meanwhile is found at once.
  win.on('focus', () => lastChecked && Date.now() - lastChecked > 20 * 60_000 && void checkForUpdate())
})
