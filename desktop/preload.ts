/**
 * The bridge from the app's page to the desktop app (desktop/main.ts): `window.flintDesktop`, which
 * src/core/desktop.ts describes. Only the app's own page gets it, not a frame of the web inside it.
 * Built by `npm run release` into `release/preload.cjs`.
 */
import { contextBridge, ipcRenderer } from 'electron'

if (location.protocol === 'flint:') {
  let save: (() => Promise<unknown>) | undefined
  let run: ((id: string) => void) | undefined
  ipcRenderer.on('flush', (_event, id: number) => {
    void Promise.resolve()
      .then(() => save?.())
      .catch(() => {})
      .finally(() => ipcRenderer.send('flushed', id))
  })
  ipcRenderer.on('command', (_event, id: string) => run?.(id))

  contextBridge.exposeInMainWorld('flintDesktop', {
    setTitleBarColors: (colors: { color: string; symbolColor: string }) => ipcRenderer.send('title-bar-colors', { color: String(colors.color), symbolColor: String(colors.symbolColor) }),
    autostart: () => ipcRenderer.invoke('autostart'),
    setAutostart: (enabled: boolean) => ipcRenderer.invoke('set-autostart', !!enabled),
    quit: () => ipcRenderer.send('quit'),
    show: () => ipcRenderer.send('show'),
    onFlush: (handler: () => Promise<unknown>) => void (save = handler),
    onCommand: (handler: (id: string) => void) => void (run = handler),
  })
}
