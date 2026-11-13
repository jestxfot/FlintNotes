/**
 * FlintNotes for Windows: only the window. The notes, their search and everything that works on them run on a server
 * (the Debian service, `flintnotes.service`); this app shows the server's own page and keeps what belongs to the
 * computer in front of the person: the window with the tab bar for a title bar, the tray, starting with Windows,
 * reminders as notifications, and its own updates. Built by `npm run release` into `release/desktop.mjs`.
 *
 * - The address and key of the server come from the link that `flintnotes pair` prints, asked for once (a page of
 *   the app's own, release/shell/connect.html) and kept in the user's folder, the key sealed by the system.
 * - The page is the server's, loaded from its address: it is always the version of the server it talks to.
 *   When the server is not there, a page of the app says so and tries again, a little later each time.
 * - Closing the window hides it in the tray: reminders keep coming. «Выйти» in the tray quits.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, Notification, safeStorage, screen, session, shell, Tray, type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'
import { nextDelay, openKey, parseLink, probe, sealKey, SHELL_COOKIE, type Saved } from './connection'
import { watchFullscreen } from './fullscreen'
import { ReminderPresenter } from './reminders'
import { PROTOCOL } from '../shared/protocol'
import type { ReminderNotice } from '../shared/reminders'
import { isNewer } from '../shared/version'

const self = fileURLToPath(import.meta.url)
const here = path.dirname(self)
const PRELOAD = path.join(here, 'preload.cjs')
const ICONS = path.join(here, 'icons')
/** The app's own pages: connecting to a server, no connection. */
const SHELL_PAGES = path.join(here, 'shell')
const readText = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
const build = (() => {
  try {
    return JSON.parse(readText(path.join(here, 'build.json'))).id ?? ''
  } catch {
    return ''
  }
})()

app.setName('FlintNotes')
// Tests give each run a profile of its own.
if (process.env.FLINT_USER_DATA) app.setPath('userData', process.env.FLINT_USER_DATA)
// The same id as the installer's shortcuts: notifications and the taskbar know the app by it.
const APP_ID = 'md.flintnotes.app'
app.setAppUserModelId(APP_ID)

// ---- the log: what the app says, there being no console to say it in
const LOG = path.join(app.getPath('userData'), 'flintnotes.log')
fs.mkdirSync(path.dirname(LOG), { recursive: true })
if ((fs.statSync(LOG, { throwIfNoEntry: false })?.size ?? 0) > 1_000_000) fs.rmSync(LOG, { force: true })
// Written at once: the last words before the app exits (an update being put in) must not stay in a buffer.
const note = (text: string) => fs.appendFileSync(LOG, `${new Date().toLocaleString('ru')}  ${text}\n`)

// A second start (a double click on the shortcut while the app runs) brings the window forward.
// `--quit` is how the installer asks a running app to close before it replaces its files.
// With `--quit` and no app running there is nothing to do: the installer asks it whether or not the app runs.
const first = app.requestSingleInstanceLock() && !process.argv.includes('--quit')
if (!first) app.exit(0)
app.on('second-instance', (_event, argv) => (argv.includes('--quit') ? void quit() : showWindow()))

let quitting = false

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
let reminders: ReminderPresenter | undefined
const reminderNotifications = new Map<string, { notification: Notification; timer: ReturnType<typeof setTimeout> }>()

function closeReminderNotifications(keep: Set<string>): void {
  for (const [key, shown] of reminderNotifications) {
    if (keep.has(key)) continue
    clearTimeout(shown.timer)
    reminderNotifications.delete(key)
    shown.notification.removeAllListeners()
    shown.notification.close()
  }
}

function notifyReminder(item: ReminderNotice, failed: () => void): boolean {
  if (!Notification.isSupported()) return false
  try {
    const notification = new Notification({ title: item.title, body: item.body, silent: true, timeoutType: 'never', icon: icon(process.platform === 'win32' ? 'flintnotes.ico' : 'flintnotes.png') })
    // Some systems silently reject a toast (permissions, missing shortcut). Do not lose the reminder.
    const timer = setTimeout(failed, 5000)
    reminderNotifications.set(item.key, { notification, timer })
    notification.once('show', () => clearTimeout(timer))
    notification.once('failed', (_event, error) => {
      clearTimeout(timer)
      note(`Уведомление не показано: ${error}`)
      failed()
    })
    notification.once('click', () => {
      clearTimeout(timer)
      showWindow()
      win?.webContents.send('reminder-click', item.key)
    })
    notification.show()
    return true
  } catch (error) {
    const shown = reminderNotifications.get(item.key)
    if (shown) {
      clearTimeout(shown.timer)
      shown.notification.removeAllListeners()
      reminderNotifications.delete(item.key)
    }
    note(`Уведомление не создано: ${String(error)}`)
    return false
  }
}

/** Where the window was, if that place is still on one of the screens. */
function placed(bounds: Electron.Rectangle | undefined): Partial<Electron.Rectangle> | undefined {
  if (!bounds) return undefined
  const visible = screen.getAllDisplays().some(({ workArea: area }) => bounds.x < area.x + area.width - 100 && bounds.x + bounds.width > area.x + 100 && bounds.y >= area.y - 10 && bounds.y < area.y + area.height - 100)
  // A screen taken away since: the same size, in the middle of the screen there is.
  return visible ? bounds : { width: bounds.width, height: bounds.height }
}

const icon = (name: string) => nativeImage.createFromPath(path.join(ICONS, name))

/** Chromium told to draw nowhere (--ozone-platform=headless: the tests, with no display) cannot make the window buttons' overlay, and crashes on it. */
const headless = app.commandLine.getSwitchValue('ozone-platform') === 'headless'

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
    ...(headless ? {} : { titleBarOverlay: { ...colors, height: 40 } }),
    // A window in the tray, minimised or covered draws nothing: an animated picture in a note would
    // otherwise go on being decoded frame by frame (a GIF of 50 MB took half a processor core).
    // Reminders keep their time there all the same: their clock runs in this main process.
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
  window.on('hide', () => reminders?.hidden())
  window.webContents.on('did-start-loading', () => reminders?.clear())
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
    reminders?.clear()
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
  window.webContents.on('did-fail-load', (_event, code, description, address, isMainFrame) => {
    // -3 is a load that was cut short by another (a new address chosen); only the server's own page failing matters.
    if (!isMainFrame || code === -3 || quitting || !server || !address.startsWith(server.origin)) return
    note(`Страница сервера не загрузилась: ${description}`)
    // Said in words, as everywhere else: what the server answers (or does not) to a look.
    void probe(server.origin, server.key, PROTOCOL, 3000).then((result) => waitForServer(result.state === 'unreachable' || result.state === 'newer-server' || result.state === 'older-server' ? result.message.charAt(0).toUpperCase() + result.message.slice(1) : description))
  })
  // The server answers «no key» with a page of its own: the key was changed, so the app asks for the new link.
  window.webContents.on('did-navigate', (_event, address, code) => {
    if (code === 401 && server && address.startsWith(server.origin)) showShellPage('connect', 'Сервер не принял ключ: его могли сменить. На сервере выполните flintnotes pair и вставьте новую ссылку')
  })
  return window
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Asks every page to save what it has; a page that does not answer in time is not waited for. True if all of it was saved. */
let flushes = 0
function flushPages(): Promise<boolean> {
  return Promise.all(
    // Only the server's page has anything to save; the app's own pages (connecting, no connection) do not answer.
    BrowserWindow.getAllWindows()
      .filter((window) => isApp(window.webContents.getURL()))
      .map(
      (window) =>
        new Promise<boolean>((resolve) => {
          const id = ++flushes
          const done = (_event: IpcMainEvent, answered: number, saved: unknown) => answered === id && finish(saved !== false)
          const finish = (saved: boolean) => {
            ipcMain.off('flushed', done)
            clearTimeout(late)
            resolve(saved)
          }
          // A page that does not answer is hung: nothing more can be had from it, so it does not hold the app back.
          const late = setTimeout(() => finish(true), 4000)
          ipcMain.on('flushed', done)
          window.webContents.send('flush', id)
        }),
    ),
  ).then((saved) => saved.every(Boolean))
}

/** `ask`: the person chose to quit, so if something could not be saved (the server is away) they are asked before it is lost. */
async function quit(ask = false): Promise<void> {
  if (quitting) return
  const saved = await flushPages()
  if (!saved && ask && win && !win.isDestroyed()) {
    showWindow()
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'FlintNotes',
      message: 'Не всё набранное сохранено',
      detail: 'Нет связи с сервером, поэтому последние правки остались только в окне. Если выйти сейчас, они пропадут. Лучше остаться: как только связь вернётся, они сохранятся сами.',
      buttons: ['Остаться', 'Выйти без сохранения'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (response === 0) return
  }
  quitting = true
  reminders?.clear()
  tray?.destroy()
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

// ---- the server this window is for
/** Where the address and key are kept (the key sealed by the system where it can be). */
const SERVER_FILE = path.join(app.getPath('userData'), 'server.json')
/** Tests and trials: a link given here is used instead of the one kept, and is not kept. */
const GIVEN_LINK = process.env.FLINT_SERVER_URL

function loadServer(): Saved | undefined {
  if (GIVEN_LINK) {
    const given = parseLink(GIVEN_LINK)
    return 'origin' in given && given.key ? { origin: given.origin, key: given.key } : undefined
  }
  try {
    const stored = JSON.parse(readText(SERVER_FILE)) as { origin?: unknown; key?: unknown; sealed?: unknown }
    const key = openKey(stored, safeStorage)
    return typeof stored.origin === 'string' && key ? { origin: stored.origin, key } : undefined
  } catch {
    return undefined
  }
}

function keepServer(saved: Saved): void {
  if (GIVEN_LINK) return
  // Readable by this user only; the key is sealed on top of that where the system can.
  fs.writeFileSync(SERVER_FILE, JSON.stringify({ origin: saved.origin, ...sealKey(saved.key, safeStorage) }), { mode: 0o600 })
}

/** Read once the app is ready: the system's key store (`safeStorage`) is not there before. */
let server: Saved | undefined
/** What the app's own pages show: why the server's page is not there, and when the next try is. */
let shellState = { message: '', nextRetryAt: 0 }
let retryTimer: NodeJS.Timeout | undefined
let attempts = 0
/** Tries since the last time the server answered; the pause between tries grows with it. */
const shellPage = (name: string) => pathToFileURL(path.join(SHELL_PAGES, `${name}.html`)).href

function showShellPage(name: 'connect' | 'offline', message = ''): void {
  clearTimeout(retryTimer)
  shellState = { message, nextRetryAt: 0 }
  void win?.loadURL(shellPage(name))
}

/** The server is not there: the page that says so, and another try a little later (later each time, up to half a minute). */
function waitForServer(why: string): void {
  clearTimeout(retryTimer)
  const delay = nextDelay(attempts++)
  const wasOffline = win?.webContents.getURL().startsWith(shellPage('offline'))
  shellState = { message: why, nextRetryAt: Date.now() + delay }
  if (wasOffline) win?.webContents.send('shell:status', shellState)
  else void win?.loadURL(shellPage('offline'))
  retryTimer = setTimeout(() => void connect(), delay)
}

/** Looks at the server and, if it is there and takes the key, moves the window to its page. */
async function connect(): Promise<void> {
  clearTimeout(retryTimer)
  if (!server || quitting) return showShellPage('connect', shellState.message)
  const result = await probe(server.origin, server.key, PROTOCOL)
  if (quitting) return
  if (result.state === 'locked') return showShellPage('connect', 'Сервер не принял ключ: его могли сменить. На сервере выполните flintnotes pair и вставьте новую ссылку')
  if (result.state !== 'ok') {
    note(`Сервер ${server.origin}: ${result.state === 'unreachable' ? result.message : result.state}`)
    return waitForServer(result.message.charAt(0).toUpperCase() + result.message.slice(1))
  }
  attempts = 0
  // The key goes to the server as the cookie it keeps it in, never in an address.
  await session.defaultSession.cookies.set({ url: server.origin, name: SHELL_COOKIE, value: server.key, httpOnly: true, sameSite: 'strict', expirationDate: Date.now() / 1000 + 400 * 86_400 })
  void win?.loadURL(`${server.origin}/`)
}

// ---- the tray
function buildTrayMenu(): void {
  if (!tray) return
  const items: MenuItemConstructorOptions[] = [
    ...(state.ready ? [{ label: `Обновить до версии ${state.ready.version}`, click: () => (showWindow(), void askToUpdate()) }, { type: 'separator' as const }] : []),
    { label: 'Открыть FlintNotes', click: showWindow },
    { label: 'Новая заметка', click: () => (showWindow(), win?.webContents.send('command', 'core:new-note')) },
    { label: 'Палитра команд', click: () => (showWindow(), win?.webContents.send('command', 'core:command-palette')) },
    { label: 'О программе', click: () => (showWindow(), win?.webContents.send('command', 'core:about')) },
    { label: 'Проверить обновления', click: () => {
      showWindow()
      win?.webContents.send('command', 'core:about')
      win?.webContents.send('command', 'core:check-updates')
    } },
    { type: 'separator' },
    { label: 'Запускать вместе с Windows', type: 'checkbox', checked: autostart(), click: (item) => setAutostart(item.checked) },
    { label: 'Сервер…', click: () => (showWindow(), showShellPage('connect', server ? `Сейчас: ${server.origin}` : '')) },
    { label: 'Журнал работы', click: () => void shell.openPath(LOG) },
    { type: 'separator' },
    { label: 'Выйти', click: () => void quit(true) },
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
/** The server's own page (any address on the server this window is for). */
const isApp = (url: string | undefined) => {
  if (!url || !server) return false
  try {
    return new URL(url).origin === new URL(server.origin).origin
  } catch {
    return false
  }
}
/** One of the app's own local pages (connecting, no connection). */
const isShellPage = (url: string | undefined) => !!url && url.startsWith(pathToFileURL(SHELL_PAGES).href + '/')
/** Only the server's page, not a frame inside it, talks to the app. */
const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => !!event.senderFrame && event.senderFrame === event.sender.mainFrame && isApp(event.senderFrame.url)
const trustedShell = (event: IpcMainEvent | IpcMainInvokeEvent) => !!event.senderFrame && event.senderFrame === event.sender.mainFrame && isShellPage(event.senderFrame.url)
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
    if (isApp(url) || isShellPage(url)) return
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
  if (!headless) window.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 40 })
  window.setBackgroundColor(colors.color)
  state.colors = { color: colors.color, symbolColor: colors.symbolColor }
  saveState()
})
// The preload asks what kind of page it is in, to give it only the bridge that page may have.
ipcMain.on('whoami', (event) => {
  const main = !!event.senderFrame && event.senderFrame === event.sender.mainFrame
  event.returnValue = main && isApp(event.senderFrame?.url) ? 'server' : main && isShellPage(event.senderFrame?.url) ? 'shell' : ''
})
ipcMain.handle('shell:state', (event) => (trustedShell(event) ? { origin: server?.origin ?? '', ...shellState } : null))
ipcMain.handle('shell:connect', async (event, link: unknown) => {
  if (!trustedShell(event) || typeof link !== 'string') return { ok: false, message: '' }
  const given = parseLink(link)
  if ('error' in given) return { ok: false, message: given.error }
  if (!given.key) return { ok: false, message: 'В ссылке нет ключа: нужна вся ссылка, которую показывает flintnotes pair (с ?key=…)' }
  const result = await probe(given.origin, given.key, PROTOCOL)
  if (result.state === 'locked') return { ok: false, message: 'Сервер не принял этот ключ. Возьмите свежую ссылку: flintnotes pair' }
  if (result.state !== 'ok') return { ok: false, message: result.message.charAt(0).toUpperCase() + result.message.slice(1) }
  server = { origin: given.origin, key: given.key }
  keepServer(server)
  attempts = 0
  void connect()
  return { ok: true, message: '' }
})
ipcMain.on('shell:retry', (event) => trustedShell(event) && void connect())
ipcMain.on('shell:change', (event) => trustedShell(event) && showShellPage('connect', server ? `Сейчас: ${server.origin}` : ''))
ipcMain.handle('autostart', (event) => (trusted(event) ? { enabled: autostart() } : null))
ipcMain.handle('set-autostart', (event, enabled: unknown) => (trusted(event) ? { enabled: setAutostart(!!enabled) } : null))
ipcMain.on('quit', (event) => trusted(event) && void quit(true))
ipcMain.on('show', (event) => trusted(event) && showWindow())
ipcMain.on('reminders', (event, value: unknown) => {
  if (!trusted(event) || event.sender !== win?.webContents || !value || typeof value !== 'object') return
  const { system, items } = value as { system?: unknown; items?: unknown }
  if (typeof system !== 'boolean' || !Array.isArray(items) || items.length > 5000) return
  if (!items.every((item): item is ReminderNotice => item && typeof item.key === 'string' && typeof item.title === 'string' && typeof item.body === 'string')) return
  reminders?.update({ system, items })
})
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
  server = loadServer()
  note(`Запуск: ${process.execPath} ${process.argv.slice(1).join(' ')} (сборка ${build || 'для разработки'}, из ${here}; сервер ${server?.origin ?? 'не задан'})`)
  Menu.setApplicationMenu(null)
  // A version downloaded before is put in before anything else starts; the app then comes back as the new one.
  if (installWaiting()) return
  markShortcut()
  if (legacyLogin().length) note(`Запуск вместе с Windows записан заново: ${setAutostart(true) ? 'включён' : 'не включился'}`)
  session.defaultSession.setPermissionRequestHandler((_contents, permission, allow, details) => allow(ALLOWED.has(permission) && (permission === 'fullscreen' || isApp(details.requestingUrl))))
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => ALLOWED.has(permission) && (permission === 'fullscreen' || isApp(origin)))
  // Windows and macOS check spelling with the system's own languages; elsewhere they are named.
  if (process.platform === 'linux') session.defaultSession.setSpellCheckerLanguages(['ru', 'en-US'])
  // No tray where nothing is drawn (headless): its menu is made of the system's own widgets, which need a display.
  if (!headless) createTray()
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
  // Tests: a driver (Playwright) attached to an app that has only just started sees the windows made after it attached, and
  // this app makes its window almost at once, so the driver is given this long to attach first.
  if (Number(process.env.FLINT_WINDOW_DELAY)) await new Promise((resume) => setTimeout(resume, Number(process.env.FLINT_WINDOW_DELAY)))
  win = createWindow()
  void connect()
  reminders = new ReminderPresenter(win, (changed) => watchFullscreen(changed, (error) => note(`Проверка полноэкранного режима: ${error}`)), notifyReminder, closeReminderNotifications)
  setInterval(() => {
    if (win && !win.isDestroyed()) win.webContents.send('reminder-tick')
  }, 15_000)
  // The window brought forward after a while looks again: a release made meanwhile is found at once.
  win.on('focus', () => lastChecked && Date.now() - lastChecked > 20 * 60_000 && void checkForUpdate())
})
