/**
 * The desktop app (Electron, see desktop/main.ts) around the same page: its preload script
 * (desktop/preload.ts) puts a small bridge on `window.flintDesktop`. In a browser there is none,
 * and everything here answers as for a page in a browser.
 */
export interface DesktopBridge {
  /** The window's controls (minimise, maximise, close) take the colours of the bar they sit on. */
  setTitleBarColors(colors: { color: string; symbolColor: string }): void
  /** Starting together with Windows, as the system keeps it for the app. */
  autostart(): Promise<{ enabled: boolean }>
  setAutostart(enabled: boolean): Promise<{ enabled: boolean }>
  /** Closes the app for good: the window, the tray icon and the server. */
  quit(): void
  /** Brings the window out of the tray. */
  show(): void
  /** The installed app's own updates (from the project's releases): whether they come by themselves, which version is waiting. */
  updates(): Promise<DesktopUpdates>
  setUpdates(enabled: boolean): Promise<DesktopUpdates>
  /** Looks for a newer version now, whatever the setting; `result` says what was found. */
  checkUpdates(): Promise<DesktopUpdates & { result: string }>
  /** The app asks the page to save what it has before it quits or loads a new build. */
  onFlush(save: () => Promise<unknown>): void
  /** A command chosen outside the page (the tray menu). */
  onCommand(run: (id: string) => void): void
}

export interface DesktopUpdates {
  /** Only the installed app updates itself; a run from the sources does not. */
  supported: boolean
  enabled: boolean
  version?: string
  /** A newer version downloaded and waiting for «Обновить» or the next start. */
  ready?: string
}

export const desktop: DesktopBridge | undefined = (window as Window & { flintDesktop?: DesktopBridge }).flintDesktop

if (desktop) {
  document.documentElement.classList.add('desktop')
  // What brings a tab forward in a browser (a click on a reminder's notification) brings the window out of the tray.
  const focus = window.focus.bind(window)
  window.focus = () => {
    desktop?.show()
    focus()
  }
}

/** A colour the page uses, as #rrggbb, which the system draws the window's buttons with. */
export function cssColor(value: string): string {
  const probe = document.body.appendChild(document.createElement('span'))
  probe.style.color = value
  const [r, g, b] = (getComputedStyle(probe).color.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).map(Number)
  probe.remove()
  return `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, '0')).join('')}`
}
