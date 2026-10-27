import { Events, type Off } from './events'
import { FLINT_ICONS } from './icon-set'

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
  /** Icons drawn as "unknown", by name: one of them may turn out to be a picture of the user's own. */
  private waiting = new Set<WeakRef<HTMLElement>>()
  /**
   * Each icon as first made, by name; it is drawn again as a copy of that. Made anew each time (the inside of
   * an `<svg>` read as text, for each row of each list) icons took a good part of switching notes.
   */
  private made = new Map<string, Element>()
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

  /**
   * Keeps a picture the user brought as an icon of their own and returns its name;
   * set by the plugin that keeps the icons. `null`: there is nowhere to keep one.
   */
  upload: ((file: File) => Promise<string | null>) | null = null

  /** The icon and colour given to this very item, not one it has by a rule; set by the plugin that keeps the icons. */
  own: ((kind: LookKind, id: string) => Look | undefined) | null = null
  /** Gives an item an icon and a colour of its own, and remembers that; set by the same plugin. */
  assign: ((kind: LookKind, id: string, look: Look) => Promise<void>) | null = null

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
    // Icons drawn before their picture was known get it now, wherever they are shown.
    for (const ref of this.waiting) {
      const el = ref.deref()
      const picture = el && this.custom(el.dataset.icon ?? '')
      if (!el) this.waiting.delete(ref)
      if (!el || !picture) continue
      const img = document.createElement('img')
      img.src = picture
      img.alt = ''
      el.replaceChildren(img)
      this.waiting.delete(ref)
    }
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

  /** The icons drawn for this app: name and the words they are found by. */
  ownIcons(): { name: string; label: string }[] {
    return Object.entries(FLINT_ICONS).map(([name, { label }]) => ({ name, label }))
  }

  /** An icon of the app's own as a file, for apps that know icons only as SVG files; `null` if the name is not one of them. */
  ownSvg(name: string): string | null {
    if (!Object.hasOwn(FLINT_ICONS, name)) return null
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${FLINT_ICONS[name].svg}</svg>\n`
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
    // The app's own icons are drawn as lines in the current colour even when a copy of them lies among the user's pictures.
    const picture = icon.startsWith('url:') ? icon.slice(4) : Object.hasOwn(FLINT_ICONS, name) ? undefined : this.custom(icon)
    if (picture) {
      const img = el.appendChild(document.createElement('img'))
      img.src = picture
      img.alt = ''
    } else if (/^[a-z0-9-]+$/.test(name)) {
      const fill = (nodes: Nodes) => {
        const made = this.made.get(name)
        if (made) return void el.appendChild(made.cloneNode(true))
        const shapes = Object.hasOwn(nodes, name) ? nodes[name] : null
        // An icon chosen long ago may go by a name Lucide has since dropped; those come from the app's own list.
        const old = Object.hasOwn(this.legacy, name) ? this.legacy[name] : null
        const svg = el.appendChild(document.createElementNS(SVG, 'svg'))
        svg.setAttribute('viewBox', '0 0 24 24')
        // A name found nowhere still gets a picture, so that no button or row is left blank.
        if (!shapes) {
          const own = Object.hasOwn(OWN, name) ? OWN[name] : Object.hasOwn(FLINT_ICONS, name) ? FLINT_ICONS[name].svg : null
          svg.innerHTML = old ?? own ?? UNKNOWN
          // It may be a picture of the user's own whose list has not been read yet: it is drawn once it is known.
          if (!old && !own) {
            el.dataset.icon = icon
            this.waiting.add(new WeakRef(el))
          } else this.made.set(name, svg.cloneNode(true) as Element)
          return
        }
        for (const [tag, attrs] of shapes) {
          const shape = svg.appendChild(document.createElementNS(SVG, tag))
          for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value)
        }
        this.made.set(name, svg.cloneNode(true) as Element)
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

/**
 * Turns a picture (PNG, JPEG, WebP, GIF) into an SVG icon: the picture, made no
 * larger than an icon needs, is put inside a square SVG of the size Obsidian's
 * icons have (100x100), centred, with its proportions kept. The shapes are not
 * traced: a photo stays a photo.
 */
export async function pictureToSvg(file: Blob, size = 128): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const longest = Math.max(bitmap.width, bitmap.height)
  const scale = Math.min(1, size / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')!
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const width = +((100 * canvas.width) / Math.max(canvas.width, canvas.height)).toFixed(2)
  const height = +((100 * canvas.height) / Math.max(canvas.width, canvas.height)).toFixed(2)
  // PNG keeps what is transparent in the picture.
  const data = canvas.toDataURL('image/png')
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"><image x="${(100 - width) / 2}" y="${(100 - height) / 2}" width="${width}" height="${height}" href="${data}" xlink:href="${data}"/></svg>\n`
}
