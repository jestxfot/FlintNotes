import { Events, type Off } from './events'
import type { Menus } from './menu'
import type { VaultState } from './state'

/** A button somewhere in the app's frame. */
export interface ToolbarButton {
  id: string
  /** A Lucide icon name, a custom icon, or an emoji; see `Icons.draw`. */
  icon: string
  title: string
  /** A colour name of the palette or any CSS colour. */
  color?: string
  onClick(event: MouseEvent): void
}

/**
 * Where buttons can be put: the top and the bottom of the strips along the left
 * and right edges, the tab strip, the header above a note, the header of the
 * file list, the status bar, the bar over a phone's keyboard.
 */
export const TOOLBAR_PLACES = ['left-ribbon', 'left-ribbon-end', 'right-ribbon', 'right-ribbon-end', 'tab-bar', 'page-header', 'explorer', 'status-bar', 'keyboard'] as const
export type ToolbarPlace = (typeof TOOLBAR_PLACES)[number]

export const TOOLBAR_NAMES: Record<ToolbarPlace, string> = {
  'left-ribbon': 'Полоса слева, вверху',
  'left-ribbon-end': 'Полоса слева, внизу',
  'right-ribbon': 'Полоса справа, вверху',
  'right-ribbon-end': 'Полоса справа, внизу',
  'tab-bar': 'Полоса вкладок',
  'page-header': 'Над заметкой',
  explorer: 'Список файлов',
  'status-bar': 'Строка состояния',
  keyboard: 'Над клавиатурой телефона',
}

/** The places where the user put buttons: each with the ids of its buttons, in order. */
type Arrangement = Partial<Record<ToolbarPlace, string[]>>

const KEY = 'toolbars'

/**
 * Buttons that plugins put into the app's frame. The core only shows them and
 * knows nothing about what they do; a right click on a strip or on a button
 * opens the `toolbar` menu, to which plugins add their items.
 *
 * Whoever adds a button names the place it goes to; the user may move any
 * button to any place and order (by dragging it, or from its menu), and that
 * wins: the arrangement is kept with the vault's layout and holds the ids of
 * buttons that are away too (their plugin off), so they come back where they were.
 */
export class Toolbars extends Events<{ change: []; move: [id: string, place: ToolbarPlace] }> {
  /** By the place their owner named, in the order they came. */
  private buttons = new Map<ToolbarPlace, ToolbarButton[]>()
  private arranged: Arrangement = {}
  private state: VaultState | null = null

  /** Takes the arrangement kept in the vault's layout, and offers moving a button in its menu. */
  init(state: VaultState, menus: Menus): void {
    this.state = state
    const saved = state.get<unknown>(KEY, {})
    this.arranged = {}
    if (saved && typeof saved === 'object') {
      for (const place of TOOLBAR_PLACES) {
        const ids = (saved as Record<string, unknown>)[place]
        if (Array.isArray(ids)) this.arranged[place] = ids.filter((id): id is string => typeof id === 'string')
      }
    }
    this.trigger('change')
    menus.register('toolbar', (target: { button?: string }, add) => {
      const id = target?.button
      const place = id ? this.placeOf(id) : null
      if (!id || !place) return
      const ids = this.list(place).map((button) => button.id)
      const at = ids.indexOf(id)
      add({ section: 'edit', icon: 'arrow-left', title: 'Сдвинуть к началу', disabled: at <= 0, onClick: () => this.shift(id, -1) })
      add({ section: 'edit', icon: 'arrow-right', title: 'Сдвинуть к концу', disabled: at === ids.length - 1, onClick: () => this.shift(id, 1) })
      add({
        section: 'edit',
        icon: 'move',
        title: 'Переместить',
        submenu: TOOLBAR_PLACES.filter((other) => other !== place).map((other) => ({ title: TOOLBAR_NAMES[other], onClick: () => this.move(id, other) })),
      })
      const home = this.homeOf(id)
      if (home && home !== place) add({ section: 'edit', icon: 'undo-2', title: `Вернуть на место: ${TOOLBAR_NAMES[home].toLowerCase()}`, onClick: () => this.forget(id) })
    })
  }

  /** Puts a button into `place`, unless the user moved it elsewhere before. */
  add(place: ToolbarPlace, button: ToolbarButton): Off {
    this.buttons.set(place, [...(this.buttons.get(place) ?? []), button])
    this.trigger('change')
    return () => {
      this.buttons.set(place, (this.buttons.get(place) ?? []).filter((b) => b !== button))
      this.trigger('change')
    }
  }

  /** The buttons shown in `place`: those the user put there in their order, then those added for it that the user did not move. */
  list(place: ToolbarPlace): ToolbarButton[] {
    const all = new Map<string, ToolbarButton>()
    for (const buttons of this.buttons.values()) for (const button of buttons) if (!all.has(button.id)) all.set(button.id, button)
    const moved = this.movedIds()
    const own = (this.arranged[place] ?? []).flatMap((id) => all.get(id) ?? [])
    return [...own, ...(this.buttons.get(place) ?? []).filter((button) => !moved.has(button.id))]
  }

  /** Where the button is shown: where the user put it, else where its owner did. */
  placeOf(id: string): ToolbarPlace | null {
    for (const place of TOOLBAR_PLACES) if (this.arranged[place]?.includes(id)) return place
    return this.homeOf(id)
  }

  /** Moves a button to `place`, before the button `before` or at the end. */
  move(id: string, place: ToolbarPlace, before: string | null = null): void {
    if (id === before) return
    // The order seen now becomes the order kept; buttons that are away stay among the others where they were.
    const moved = this.movedIds()
    const order = [...(this.arranged[place] ?? []), ...(this.buttons.get(place) ?? []).map((button) => button.id).filter((other) => !moved.has(other))].filter((other) => other !== id)
    for (const other of TOOLBAR_PLACES) if (this.arranged[other]) this.arranged[other] = this.arranged[other].filter((one) => one !== id)
    const at = before ? order.indexOf(before) : -1
    order.splice(at < 0 ? order.length : at, 0, id)
    this.arranged[place] = order
    this.changed()
    this.trigger('move', id, place)
  }

  /** Moves a button by `by` places within its strip. */
  shift(id: string, by: number): void {
    const place = this.placeOf(id)
    if (!place) return
    const ids = this.list(place).map((button) => button.id)
    const to = Math.max(0, Math.min(ids.length - 1, ids.indexOf(id) + by))
    const rest = ids.filter((other) => other !== id)
    this.move(id, place, rest[to] ?? null)
  }

  /** Forgets where the user put a button: it goes back to the place its owner named. Owners call it for a button that is gone for good. */
  forget(id: string): void {
    const place = this.placeOf(id)
    let found = false
    for (const other of TOOLBAR_PLACES) {
      const ids = this.arranged[other]
      if (!ids?.includes(id)) continue
      found = true
      this.arranged[other] = ids.filter((one) => one !== id)
    }
    if (!found) return
    this.changed()
    const home = this.homeOf(id)
    if (home && home !== place) this.trigger('move', id, home)
  }

  private homeOf(id: string): ToolbarPlace | null {
    for (const [place, buttons] of this.buttons) if (buttons.some((button) => button.id === id)) return place
    return null
  }

  private movedIds(): Set<string> {
    return new Set(Object.values(this.arranged).flat())
  }

  private changed(): void {
    for (const place of TOOLBAR_PLACES) if (!this.arranged[place]?.length) delete this.arranged[place]
    this.state?.set(KEY, this.arranged)
    this.trigger('change')
  }
}
