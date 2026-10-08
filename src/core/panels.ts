import { Events, type Off } from './events'

export type Side = 'left' | 'right'

/** A panel in one of the sidebars. */
export interface PanelDef {
  id: string
  title: string
  side: Side
  /** Builds the panel inside `el`; the returned function tears it down. */
  mount(el: HTMLElement): Off | void
}

export interface PanelEntry {
  def: PanelDef
  /** Unique per registration, so re-adding a panel with the same id mounts it afresh. */
  key: number
}

type PanelEvents = {
  change: []
  /** A panel was brought to the front; its sidebar should open. */
  reveal: [id: string]
}

const STORAGE_KEY = 'flint:panels'

export class Panels extends Events<PanelEvents> {
  private entries: PanelEntry[] = []
  private activeIds: Partial<Record<Side, string>> = {}
  private nextKey = 1

  constructor() {
    super()
    try {
      this.activeIds = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    } catch {
      // Remembering the open panel is optional.
    }
  }

  add(def: PanelDef): Off {
    const entry = { def, key: this.nextKey++ }
    this.entries.push(entry)
    this.trigger('change')
    return () => {
      this.entries.splice(this.entries.indexOf(entry), 1)
      this.trigger('change')
    }
  }

  list(side: Side): PanelEntry[] {
    return this.entries.filter((entry) => entry.def.side === side)
  }

  /** Id of the panel shown on a side: the last chosen one, or the first. */
  active(side: Side): string | undefined {
    const panels = this.list(side)
    return (panels.find((p) => p.def.id === this.activeIds[side]) ?? panels[0])?.def.id
  }

  /** Shows the panel and opens its sidebar. */
  reveal(id: string): void {
    const entry = this.entries.find((e) => e.def.id === id)
    if (!entry) return
    this.activeIds[entry.def.side] = id
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.activeIds))
    } catch {
      // See the constructor.
    }
    this.trigger('change')
    this.trigger('reveal', id)
  }
}
