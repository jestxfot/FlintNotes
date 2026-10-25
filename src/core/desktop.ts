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
  /** The app asks the page to save what it has before it quits or loads a new build. */
  onFlush(save: () => Promise<unknown>): void
  /** A command chosen outside the page (the tray menu). */
  onCommand(run: (id: string) => void): void
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
