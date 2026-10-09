import type { App } from '../../api'

/** A colour group: notes matching the query are drawn in the colour. */
export interface ColorGroup {
  query: string
  color: { a: number; rgb: number }
}

/**
 * The graph's settings, with the names and value ranges of Obsidian's own
 * `graph.json`, so that the settings of an Obsidian vault can be taken as they are.
 */
export interface GraphSettings {
  search: string
  showTags: boolean
  showAttachments: boolean
  hideUnresolved: boolean
  showOrphans: boolean
  colorGroups: ColorGroup[]
  /** Not in Obsidian: colour the largest top-level folders when no group matches. */
  colorFolders: boolean
  showArrow: boolean
  /** -3..3: how far one must zoom in before names appear. */
  textFadeMultiplier: number
  /** Not in Obsidian: which names are shown — chosen so they do not overlap, all of them, or only around the pointer. */
  labelMode: 'smart' | 'all' | 'hover'
  /** Not in Obsidian: 0.6..2.5, size of the names. */
  labelSize: number
  /** Not in Obsidian: 10..600, how many names at most. */
  labelLimit: number
  /** 0.1..5 */
  nodeSizeMultiplier: number
  /** 0.1..5 */
  lineSizeMultiplier: number
  /** 0..1 */
  centerStrength: number
  /** 0..20 */
  repelStrength: number
  /** 0..1 */
  linkStrength: number
  /** 30..500 */
  linkDistance: number
  /** Not in Obsidian: where the layout is worked out — by the graphics card for big graphs, always, or never. */
  gpuLayout: 'auto' | 'on' | 'off'
  /** Which sections of the panel are folded, and whether the panel is closed. */
  'collapse-filter': boolean
  'collapse-color-groups': boolean
  'collapse-display': boolean
  'collapse-forces': boolean
  close: boolean
}

export const DEFAULTS: GraphSettings = {
  search: '',
  showTags: false,
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
  colorGroups: [],
  colorFolders: true,
  showArrow: false,
  textFadeMultiplier: 0,
  labelMode: 'smart',
  labelSize: 1,
  labelLimit: 160,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
  centerStrength: 0.52,
  repelStrength: 10,
  linkStrength: 1,
  linkDistance: 250,
  gpuLayout: 'auto',
  'collapse-filter': false,
  'collapse-color-groups': false,
  'collapse-display': false,
  'collapse-forces': false,
  close: true,
}

const KEY = 'graph'

/** The saved settings; the first time, those of Obsidian's graph if the vault has them. */
export async function loadSettings(app: App): Promise<GraphSettings> {
  const saved = app.state.get<Partial<GraphSettings> | null>(KEY, null)
  if (saved) return { ...DEFAULTS, ...saved }
  let imported: Partial<GraphSettings> = {}
  if (app.obsidianConfig) {
    try {
      const text = await app.vault.readOptional(`${app.obsidianConfig}/graph.json`)
      const parsed: unknown = text ? JSON.parse(text) : null
      if (parsed && typeof parsed === 'object') imported = Object.fromEntries(Object.entries(parsed).filter(([key]) => key in DEFAULTS))
    } catch {
      // A broken file is the same as none.
    }
  }
  return { ...DEFAULTS, ...imported, close: true }
}

export const saveSettings = (app: App, settings: GraphSettings) => app.state.set(KEY, settings)

export const cssColor = ({ a, rgb }: ColorGroup['color']) => `rgb(${(rgb >> 16) & 255} ${(rgb >> 8) & 255} ${rgb & 255} / ${a})`
export const hexColor = ({ rgb }: ColorGroup['color']) => `#${rgb.toString(16).padStart(6, '0')}`

/** What a query is tested against. */
export interface Subject {
  path: string
  name: string
  tags: string[]
}

/**
 * A search as in Obsidian's graph: words that must all be found in the path,
 * `path:folder`, `file:name`, `tag:#name`, a `-` in front to exclude, quotes
 * around text with spaces, and `OR` between alternatives.
 */
export function compileQuery(query: string): (subject: Subject) => boolean {
  const alternatives = query
    .split(/\s+OR\s+/)
    .map((part) => [...part.matchAll(/(-?)(?:(path|file|tag):)?(?:"([^"]*)"|(\S+))/g)].map(([, minus, field, quoted, bare]) => ({ negate: !!minus, field, text: (quoted ?? bare).toLowerCase() })))
    .filter((terms) => terms.length)
  if (!alternatives.length) return () => true
  return (subject) =>
    alternatives.some((terms) =>
      terms.every(({ negate, field, text }) => {
        const found =
          field === 'tag'
            ? subject.tags.some((tag) => tag === text.replace(/^#/, '') || tag.startsWith(`${text.replace(/^#/, '')}/`))
            : field === 'file'
              ? subject.name.includes(text)
              : subject.path.includes(text)
        return found !== negate
      }),
    )
}
