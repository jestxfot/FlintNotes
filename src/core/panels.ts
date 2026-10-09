import { Events, type Off } from './events'
import type { VaultState } from './state'

export type Side = 'left' | 'right'

/** A widget of a sidebar: the file list, search, the calendar, ... */
export interface PanelDef {
  id: string
  title: string
  /** The sidebar it appears in until the user moves it. */
  side: Side
  /** Path data of a 16x16 outline icon for its tab. */
  icon?: string
  /** A widget that is as tall as its content (a calendar) instead of filling the space. */
  compact?: boolean
  /** Builds the widget inside `el`; the returned function tears it down. */
  mount(el: HTMLElement): Off | void
}

export interface PanelEntry {
  def: PanelDef
  /** Unique per registration, so re-adding a panel with the same id mounts it afresh. */
  key: number
}

/** Widgets stacked in one block of a sidebar; one of them shows at a time. */
export interface PanelGroup {
  /** Position in the stored layout; pass it to `move`. */
  index: number
  entries: PanelEntry[]
  active: string
}

interface StoredGroup {
  tabs: string[]
  active?: string
}

type Layout = Record<Side, StoredGroup[]>

type PanelEvents = {
  change: []
  /** A widget was brought to the front; its sidebar should open. */
  reveal: [id: string]
}

/**
 * The widgets of both sidebars and where each one sits. Any widget can be moved
 * to either side, into any block, or into a block of its own. The layout also
 * remembers widgets of plugins that are switched off, so they return to their
 * place when switched on again.
 */
export class Panels extends Events<PanelEvents> {
  private entries = new Map<string, PanelEntry>()
  private layout: Layout = { left: [], right: [] }
  private nextKey = 1

  constructor(private state: VaultState) {
    super()
  }

  /** Reads the saved layout. Called once the vault's state has been loaded. */
  init(): void {
    const saved = this.state.get<Partial<Layout>>('layout', {})
    const groups = (list: unknown): StoredGroup[] =>
      Array.isArray(list) ? list.filter((g) => Array.isArray(g?.tabs)).map((g) => ({ tabs: g.tabs.map(String), active: g.active })) : []
    this.layout = { left: groups(saved.left), right: groups(saved.right) }
  }

  add(def: PanelDef): Off {
    const entry = { def, key: this.nextKey++ }
    this.entries.set(def.id, entry)
    if (!this.locate(def.id)) {
      // New to the layout. A compact widget (a calendar) starts as a block of
      // its own at the top; the others join the first full-height block.
      const side = this.layout[def.side]
      const full = side.find((group) => !group.tabs.some((id) => this.entries.get(id)?.def.compact))
      if (def.compact) side.unshift({ tabs: [def.id] })
      else if (full) full.tabs.push(def.id)
      else side.push({ tabs: [def.id] })
    }
    this.trigger('change')
    return () => {
      if (this.entries.get(def.id) === entry) this.entries.delete(def.id)
      this.trigger('change')
    }
  }

  /** Drops a widget that is gone for good from the saved layout. */
  forget(id: string): void {
    for (const side of ['left', 'right'] as const) {
      for (const group of this.layout[side]) group.tabs = group.tabs.filter((tab) => tab !== id)
      this.layout[side] = this.layout[side].filter((group) => group.tabs.length > 0)
    }
    this.save()
  }

  /** Number of widgets currently available. */
  count(): number {
    return this.entries.size
  }

  has(side: Side): boolean {
    return this.groups(side).length > 0
  }

  sideOf(id: string): Side | undefined {
    return this.locate(id)?.side
  }

  /** The blocks of a sidebar, top to bottom, with the widgets that exist right now. */
  groups(side: Side): PanelGroup[] {
    return this.layout[side]
      .map((group, index) => {
        const entries = group.tabs.map((id) => this.entries.get(id)).filter((entry): entry is PanelEntry => !!entry)
        const active = entries.find((entry) => entry.def.id === group.active) ?? entries[0]
        return { index, entries, active: active?.def.id ?? '' }
      })
      .filter((group) => group.entries.length > 0)
  }

  /** Shows the widget in its block and opens its sidebar. */
  reveal(id: string): void {
    const found = this.locate(id)
    if (!found || !this.entries.has(id)) return
    found.group.active = id
    this.save()
    this.trigger('reveal', id)
  }

  /**
   * Moves a widget. With `group` it joins that block of `side` at position
   * `at`; with `group: null` it gets a block of its own, inserted before the
   * block at index `at` (or last).
   */
  move(id: string, side: Side, group: number | null, at: number): void {
    const from = this.locate(id)
    if (!from) return
    const target = group === null ? null : this.layout[side][group]
    // Positions are counted with the widget still in place.
    if (target === from.group && from.group.tabs.indexOf(id) < at) at--
    from.group.tabs.splice(from.group.tabs.indexOf(id), 1)
    if (from.group.active === id) from.group.active = undefined
    if (target) {
      target.tabs.splice(Math.max(0, at), 0, id)
      target.active = id
    } else {
      const anchor = this.layout[side][at]
      const fresh = { tabs: [id], active: id }
      const index = anchor ? this.layout[side].indexOf(anchor) : this.layout[side].length
      this.layout[side].splice(index, 0, fresh)
    }
    for (const s of ['left', 'right'] as const) this.layout[s] = this.layout[s].filter((g) => g.tabs.length > 0)
    this.save()
  }

  private locate(id: string): { side: Side; group: StoredGroup } | undefined {
    for (const side of ['left', 'right'] as const) {
      const group = this.layout[side].find((g) => g.tabs.includes(id))
      if (group) return { side, group }
    }
  }

  private save(): void {
    this.state.set('layout', this.layout)
    this.trigger('change')
  }
}
