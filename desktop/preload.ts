/**
 * The bridges from a page to the desktop app (desktop/main.ts). The app has two kinds of page and each gets only its own:
 *   - the server's page (the notes): `window.flintDesktop`, which src/core/desktop.ts describes;
 *   - the app's own local pages (connecting to a server, no connection): `window.flintShell`.
 * Which kind a page is, the main process says by the address the frame has; any other page (a frame of the web inside
 * the notes, say) gets nothing. Built by `npm run release` into `release/preload.cjs`.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { AlertAction, AlertModel, ReminderPresentation } from '../shared/reminders'

const kind = ipcRenderer.sendSync('whoami') as 'server' | 'shell' | 'alert' | ''

if (kind === 'server') {
  let save: (() => Promise<unknown>) | undefined
  let run: ((id: string) => void) | undefined
  ipcRenderer.on('flush', (_event, id: number) => {
    void Promise.resolve()
      .then(() => save?.())
      // `false` is the page saying that something could not be saved.
      .then((saved) => saved !== false, () => false)
      .then((saved) => ipcRenderer.send('flushed', id, saved))
  })
  ipcRenderer.on('command', (_event, id: string) => run?.(id))

  contextBridge.exposeInMainWorld('flintDesktop', {
    setTitleBarColors: (colors: { color: string; symbolColor: string }) => ipcRenderer.send('title-bar-colors', { color: String(colors.color), symbolColor: String(colors.symbolColor) }),
    fetchBytes: (address: string) => ipcRenderer.invoke('fetch-bytes', String(address)),
    fetchPage: (address: string) => ipcRenderer.invoke('fetch-page', String(address)),
    autostart: () => ipcRenderer.invoke('autostart'),
    setAutostart: (enabled: boolean) => ipcRenderer.invoke('set-autostart', !!enabled),
    quit: () => ipcRenderer.send('quit'),
    show: () => ipcRenderer.send('show'),
    setReminders: (presentation: ReminderPresentation) => ipcRenderer.send('reminders', presentation),
    /** The reminders live in a window of their own; what was chosen there comes back here to be done. */
    onReminderAction: (handler: (action: AlertAction) => void) => {
      const listener = (_event: unknown, action: AlertAction) => handler(action)
      ipcRenderer.on('reminder-action', listener)
      return () => ipcRenderer.removeListener('reminder-action', listener)
    },
    onReminderTick: (check: () => void) => {
      ipcRenderer.on('reminder-tick', check)
      return () => ipcRenderer.removeListener('reminder-tick', check)
    },
    updates: () => ipcRenderer.invoke('updates'),
    setUpdates: (enabled: boolean) => ipcRenderer.invoke('set-updates', !!enabled),
    checkUpdates: () => ipcRenderer.invoke('check-updates'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onFlush: (handler: () => Promise<unknown>) => void (save = handler),
    onCommand: (handler: (id: string) => void) => void (run = handler),
  })
}

if (kind === 'alert') {
  contextBridge.exposeInMainWorld('flintAlert', {
    onModel: (show: (model: AlertModel) => void) => ipcRenderer.on('alert:model', (_event, model) => show(model)),
    ready: () => ipcRenderer.send('alert:ready'),
    size: (height: number) => ipcRenderer.send('alert:size', Number(height)),
    act: (action: AlertAction) => ipcRenderer.send('alert:action', action),
  })
}

if (kind === 'shell') {
  contextBridge.exposeInMainWorld('flintShell', {
    /** Which server this window is for and why it is not showing it: `{ origin, message, nextRetryAt }`. */
    state: () => ipcRenderer.invoke('shell:state'),
    /** Tries the link of `flintnotes pair`; when it works the window moves to the server's page by itself. */
    connect: (link: string) => ipcRenderer.invoke('shell:connect', String(link)),
    retry: () => ipcRenderer.send('shell:retry'),
    change: () => ipcRenderer.send('shell:change'),
    onStatus: (show: (state: { message: string; nextRetryAt: number }) => void) => ipcRenderer.on('shell:status', (_event, state) => show(state)),
  })
}
