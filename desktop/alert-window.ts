import { BrowserWindow, screen, type NativeImage } from 'electron'
import type { AlertModel } from '../shared/reminders'
import type { ReminderSurface } from './reminders'

const WIDTH = 420
const MARGIN = 16

/**
 * The reminders' own window: frameless, always on top, in the bottom right corner of the main screen. It is
 * not the notes window and not an operating system notification; it draws what the notes page sends it
 * (desktop/pages/alert.html) and sends back what the person chose.
 */
export class AlertWindow implements ReminderSurface {
  private window: BrowserWindow | undefined
  private loaded = false
  private model: AlertModel | undefined
  private height = 200

  constructor(private options: { preload: string; page: string; icon: NativeImage }) {}

  get contents() {
    return this.window && !this.window.isDestroyed() ? this.window.webContents : undefined
  }

  /** The newest list to draw; it is drawn at once if the page is ready, otherwise when it is. */
  send(model: AlertModel): void {
    this.model = model
    this.push()
  }

  ready(): void {
    this.loaded = true
    this.push()
  }

  /** The page says how tall its card is; the window grows upward from the corner. */
  resize(height: number): void {
    if (!Number.isFinite(height)) return
    this.height = Math.max(80, Math.round(height))
    this.place()
  }

  show(): void {
    const window = (this.window ??= this.create())
    this.place()
    // Above other windows, full-screen ones included, and without taking the keyboard from whatever is being typed into.
    window.setAlwaysOnTop(true, 'screen-saver')
    if (!window.isVisible()) window.showInactive()
    else window.moveTop()
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide()
  }

  private push(): void {
    if (this.loaded && this.model) this.contents?.send('alert:model', this.model)
  }

  /** The bottom right of the main screen's usable area (clear of the taskbar). */
  private place(): void {
    if (!this.window || this.window.isDestroyed()) return
    const area = screen.getPrimaryDisplay().workArea
    const height = Math.max(80, Math.min(this.height, area.height - 2 * MARGIN))
    this.window.setBounds({ x: area.x + area.width - WIDTH - MARGIN, y: area.y + area.height - height - MARGIN, width: WIDTH, height })
  }

  private create(): BrowserWindow {
    const window = new BrowserWindow({
      width: WIDTH,
      height: this.height,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'FlintNotes — напоминания',
      icon: this.options.icon,
      // See-through, so that the card's rounded corners are corners (the page paints the card itself).
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: this.options.preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    })
    window.setMenuBarVisibility(false)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('did-start-loading', () => (this.loaded = false))
    screen.on('display-metrics-changed', () => this.place())
    void window.loadFile(this.options.page)
    return window
  }
}
