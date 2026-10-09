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
  /** Where pictures for icon names that are not Lucide's come from; set by a plugin. */
  custom: (name: string) => string | undefined = () => undefined

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
        if (!shapes && !old) return void (el.textContent = '')
        const svg = el.appendChild(document.createElementNS(SVG, 'svg'))
        svg.setAttribute('viewBox', '0 0 24 24')
        if (!shapes) return void (svg.innerHTML = old!)
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
