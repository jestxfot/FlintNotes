import { Events, type Off } from './events'

/** What an item looks like: an icon (see `Icons.draw`) and a colour (a name such as `red`, or any CSS colour). */
export interface Look {
  icon?: string
  color?: string
}

export type LookKind = 'file' | 'folder' | 'tag' | 'property'
type Provider = (kind: LookKind, id: string) => Look | undefined
type Nodes = Record<string, [tag: string, attrs: Record<string, string>][]>

const SVG = 'http://www.w3.org/2000/svg'
/**
 * Icons drawn for this app: names that Obsidian knows but no version of Lucide
 * at hand has. The inside of a 24x24 `<svg>`, in Lucide's line style.
 */
const OWN: Record<string, string> = {
  'book-template':
    '<path d="M20 22h-2"/><path d="M20 15v2h-2"/><path d="M4 19.5V15"/><path d="M20 8v3"/><path d="M18 2h2v2"/><path d="M4 11V9"/><path d="M12 2h2"/><path d="M12 22h2"/><path d="M12 17h2"/><path d="M8 22H6.5a2.5 2.5 0 0 1 0-5H8"/><path d="M4 5v-.5A2.5 2.5 0 0 1 6.5 2H8"/>',
}
/** Stands in for an icon whose name is not known at all: a dashed square with a question mark. */
const UNKNOWN = '<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="3 3"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.2 1-1.2 1.9"/><path d="M12 16.8h.01"/>'
/** Colour names of Obsidian's palette; anything else is taken as a CSS colour. */
const NAMED = new Set(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'gray'])

/**
 * Icons and colours of files, folders, tags and properties. The core only
 * draws them; which item gets what is decided by plugins that register a
 * provider (the Iconic plugin reads it from Obsidian's Iconic data).
 *
 * An icon is a Lucide name (`lucide-apple` or `apple`), the address of a
 * picture (`url:...`), or any text, drawn as it is (an emoji).
 */
export class Icons extends Events<{ change: [] }> {
  private providers: Provider[] = []
  private nodes: Nodes | null = null
  /** Icons Lucide has renamed or redrawn since, by their old names: the inside of their `<svg>`. */
  private legacy: Record<string, string> = {}
  private loading: Promise<Nodes> | null = null
  /** Whether icons are also shown inside notes: before links to notes and beside a note's title. Set from a plugin's setting. */
  inNotes = true
  /** Opens the choice of an icon for an item; set by the plugin that keeps the icons. */
  pick: ((kind: LookKind, id: string) => void) | null = null

  /**
   * Makes a drawn icon a button for changing it: wherever the icon of a note, a
   * folder, a tag or a property is shown, a click on it opens the choice of icons.
   */
  clickable(el: HTMLElement, kind: LookKind, id: string): HTMLElement {
    el.classList.add('icon-pick')
    el.addEventListener('click', (event) => {
      if (!this.pick) return
      event.preventDefault()
      event.stopPropagation()
      this.pick(kind, id)
    })
    // A press on the icon must not start what a press on its row would (a drag, moving the cursor).
    el.addEventListener('mousedown', (event) => this.pick && event.stopPropagation())
    return el
  }

  /** Where pictures for icon names that are not Lucide's come from; set by a plugin. */
  custom: (name: string) => string | undefined = () => undefined
  /** Names of those pictures, for the icon picker; set by the same plugin. */
  customNames: () => string[] = () => []

  provide(provider: Provider): Off {
    this.providers.push(provider)
    this.trigger('change')
    return () => {
      this.providers = this.providers.filter((p) => p !== provider)
      this.trigger('change')
    }
  }

  /** Tells everything that shows icons to draw them again. */
  refresh(): void {
    this.trigger('change')
  }

  look(kind: LookKind, id: string): Look | undefined {
    for (const provider of this.providers) {
      const look = provider(kind, id)
      if (look && (look.icon || look.color)) return look
    }
  }

  /** A colour as CSS: `red` -> `var(--color-red)`. */
  css(color: string | undefined): string {
    return !color ? '' : NAMED.has(color) ? `var(--color-${color})` : color
  }

  /** The Lucide set, fetched when an icon is first needed. */
  load(): Promise<Nodes> {
    return (this.loading ??= Promise.all([import('lucide-static/icon-nodes.json'), import('./icon-legacy.json')]).then(([nodes, legacy]) => {
      this.legacy = legacy.default
      return (this.nodes = nodes.default as unknown as Nodes)
    }))
  }

  /** Names of all Lucide icons (after `load`). */
  names(): string[] {
    return Object.keys(this.nodes ?? {})
  }

  /** An element showing the icon, sized by the font (1em). Lucide icons appear once the set has loaded. */
  draw(icon: string, color?: string): HTMLElement {
    const el = document.createElement('span')
    el.className = 'icon'
    el.style.color = this.css(color)
    const name = icon.replace(/^lucide-/, '')
    const picture = icon.startsWith('url:') ? icon.slice(4) : this.custom(icon)
    if (picture) {
      const img = el.appendChild(document.createElement('img'))
      img.src = picture
      img.alt = ''
    } else if (/^[a-z0-9-]+$/.test(name)) {
      const fill = (nodes: Nodes) => {
        const shapes = Object.hasOwn(nodes, name) ? nodes[name] : null
        // An icon chosen long ago may go by a name Lucide has since dropped; those come from the app's own list.
        const old = Object.hasOwn(this.legacy, name) ? this.legacy[name] : null
        const svg = el.appendChild(document.createElementNS(SVG, 'svg'))
        svg.setAttribute('viewBox', '0 0 24 24')
        // A name found nowhere still gets a picture, so that no button or row is left blank.
        if (!shapes) return void (svg.innerHTML = old ?? (Object.hasOwn(OWN, name) ? OWN[name] : UNKNOWN))
        for (const [tag, attrs] of shapes) {
          const shape = svg.appendChild(document.createElementNS(SVG, tag))
          for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value)
        }
      }
      if (this.nodes) fill(this.nodes)
      else void this.load().then(fill)
    } else {
      el.classList.add('emoji')
      el.textContent = icon
    }
    return el
  }
}
