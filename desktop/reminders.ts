import type { ReminderPresentation } from '../shared/reminders'

/** The window the reminders live in: shown on top of everything, or put away. */
export interface ReminderSurface {
  show(): void
  hide(): void
}

/**
 * Decides when the reminder window is on the screen: while something is outstanding, except while another
 * program is fullscreen (a film, a game), when it waits and comes back as that ends.
 */
export class ReminderPresenter {
  private keys = new Set<string>()
  private blocked = true
  private stopWatching: (() => void) | undefined

  constructor(
    private surface: ReminderSurface,
    private watch: (changed: (blocked: boolean) => void) => () => void,
  ) {}

  update(presentation: ReminderPresentation): void {
    this.keys = new Set(presentation.items.map((item) => item.key))
    if (!this.keys.size) return this.clear()
    if (!this.stopWatching) {
      this.stopWatching = this.watch((blocked) => {
        this.blocked = blocked
        this.apply()
      })
    }
    this.apply()
  }

  clear(): void {
    this.stopWatching?.()
    this.stopWatching = undefined
    this.keys.clear()
    this.blocked = true
    this.surface.hide()
  }

  private apply(): void {
    if (this.blocked || !this.keys.size) this.surface.hide()
    else this.surface.show()
  }
}
