import type { ReminderNotice, ReminderPresentation } from '../shared/reminders'

interface ReminderWindow {
  isDestroyed(): boolean
  isFullScreen(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  isAlwaysOnTop(): boolean
  restore(): void
  showInactive(): void
  setAlwaysOnTop(value: boolean): void
}

/** Raises the window over others for each new reminder; held back during fullscreen. Finishing or snoozing removes it from the queue. */
export class ReminderPresenter {
  private items = new Map<string, ReminderNotice>()
  private pending = new Set<string>()
  private blocked = true
  private raised = false
  private windowPending = false
  private stopWatching: (() => void) | undefined

  constructor(
    private window: ReminderWindow,
    private watch: (changed: (blocked: boolean) => void) => () => void,
  ) {}

  update(presentation: ReminderPresentation): void {
    const previous = this.items
    this.items = new Map(presentation.items.map((item) => [item.key, item]))
    for (const key of this.pending) if (!this.items.has(key)) this.pending.delete(key)
    for (const key of this.items.keys()) if (!previous.has(key)) this.pending.add(key)
    if (!this.items.size) return this.clear()
    if (!this.stopWatching) this.stopWatching = this.watch((blocked) => {
      this.blocked = blocked || this.window.isFullScreen()
      if (this.blocked) {
        this.windowPending ||= this.raised
        this.lower()
      } else this.deliver()
    })
    this.deliver()
  }

  /** Hiding the app manually must not bring it back every polling tick. */
  hidden(): void {
    this.windowPending = false
    this.lower()
  }

  clear(): void {
    this.stopWatching?.()
    this.stopWatching = undefined
    this.items.clear()
    this.pending.clear()
    this.windowPending = false
    this.blocked = true
    this.lower()
  }

  private lower(): void {
    if (this.raised && !this.window.isDestroyed()) this.window.setAlwaysOnTop(false)
    this.raised = false
  }

  private deliver(): void {
    if (this.blocked || this.window.isDestroyed() || this.window.isFullScreen()) return
    if (this.pending.size) {
      this.pending.clear()
      this.windowPending = true
    }
    if (!this.windowPending) {
      // The window manager may finish mapping the window after showInactive returns.
      if (this.raised && !this.window.isAlwaysOnTop()) this.window.setAlwaysOnTop(true)
      return
    }
    this.windowPending = false
    // Raise without moving keyboard focus away from the program the user is working in.
    if (this.window.isMinimized()) this.window.restore()
    this.window.showInactive()
    // Mapping a previously hidden window can reset its topmost state (e.g. on X11).
    this.window.setAlwaysOnTop(true)
    this.raised = true
  }
}
