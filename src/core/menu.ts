import { Events, type Off } from './events'

export interface MenuItem {
  title: string
  /** A Lucide icon name, e.g. `pencil`. */
  icon?: string
  /** Items of one section are kept together, with a line between sections. */
  section?: string
  /** Shown in red: deleting and the like. */
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  /** Items of a submenu that opens beside this one. */
  submenu?: MenuItem[]
}

/** The order of sections in a menu; items of unknown sections go before `edit`. */
const ORDER = ['new', 'open', 'action', 'copy', 'system', 'plugin', 'edit', 'danger']

type Provider = (target: any, add: (item: MenuItem) => void) => void

/**
 * Context menus. Whoever shows a menu names its kind (`file`, `tab`, `tag`,
 * `property`, ...) and what it is for; plugins add their own items to menus of
 * a kind without knowing who shows them.
 */
export class Menus extends Events<{ show: [menu: { x: number; y: number; items: MenuItem[] }] }> {
  private providers = new Map<string, Provider[]>()
  /** Whether the user asked for the browser's menus instead of the app's; set by the core from the settings. */
  native: () => boolean = () => false

  /** Adds items to every menu of the kind. `target` is what the menu is for (a file entry, a tag name, ...). */
  register(kind: string, provider: Provider): Off {
    this.providers.set(kind, [...(this.providers.get(kind) ?? []), provider])
    return () => this.providers.set(kind, (this.providers.get(kind) ?? []).filter((p) => p !== provider))
  }

  /** Opens a menu at the pointer with the given items plus those that plugins add for the kind. */
  show(event: MouseEvent | { x: number; y: number }, kind: string, target: unknown, items: MenuItem[] = []): boolean {
    const all = [...items]
    for (const provider of this.providers.get(kind) ?? []) provider(target, (item) => all.push({ section: 'plugin', ...item }))
    // With nothing to offer, or when the user prefers it, the browser's own menu is left alone.
    if (!all.length || (this.native() && event instanceof MouseEvent)) return false
    if (event instanceof MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
    }
    const rank = (item: MenuItem) => {
      const at = ORDER.indexOf(item.section ?? 'action')
      return at < 0 ? ORDER.indexOf('edit') - 0.5 : at
    }
    // A stable sort: within a section the items stay in the order they were added.
    const sorted = all.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i)
    this.trigger('show', { x: 'clientX' in event ? event.clientX : event.x, y: 'clientY' in event ? event.clientY : event.y, items: sorted.map((entry) => entry.item) })
    return true
  }
}
