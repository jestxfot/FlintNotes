import { parseDocument, type Document } from 'yaml'

/** A condition: an expression, or `and` / `or` / `not` over a list of conditions. */
export type FilterNode = string | { and?: FilterNode[]; or?: FilterNode[]; not?: FilterNode[] }

export interface SortRule {
  property: string
  direction?: string
}

export interface ViewConfig {
  type: string
  name?: string
  filters?: FilterNode
  /** Properties to show, in order. */
  order?: string[]
  sort?: SortRule[]
  groupBy?: SortRule | string
  limit?: number
  /** Property -> summary name (`Sum`, `Average`, ... or one defined in the base). */
  summaries?: Record<string, string>
  /** Cards: the property holding a picture for the card. */
  image?: string
  /** Cards: width of a card in pixels. */
  cardSize?: number
  /** Cards: height of the picture as a share of its width. */
  imageAspectRatio?: number
}

/** A base, as written in YAML. The format follows Obsidian Bases. */
export interface BaseConfig {
  filters?: FilterNode
  /** Computed properties: name -> expression, shown as `formula.<name>`. */
  formulas?: Record<string, string>
  properties?: Record<string, { displayName?: string }>
  /** Custom summaries: name -> expression over the list `values`. */
  summaries?: Record<string, string>
  views?: ViewConfig[]
}

export const VIEW_TYPES = [
  { type: 'table', label: 'Таблица' },
  { type: 'cards', label: 'Карточки' },
  { type: 'list', label: 'Список' },
  { type: 'board', label: 'Доска' },
]

export const viewLabel = (type: string) => VIEW_TYPES.find((v) => v.type === type)?.label ?? type

export function parseBase(source: string): { config: BaseConfig; error?: string } {
  const doc = parseDocument(source)
  if (doc.errors.length) return { config: {}, error: `Ошибка в YAML: ${doc.errors[0].message}` }
  const data = doc.toJS()
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) {
    return { config: {}, error: 'База должна быть набором ключей: filters, formulas, views…' }
  }
  return { config: data ?? {} }
}

/** The views of a base; one that defines none gets a plain table. */
export const viewsOf = (config: BaseConfig): ViewConfig[] =>
  Array.isArray(config.views) && config.views.length ? config.views : [{ type: 'table', name: 'Таблица' }]

/**
 * Changes a base's YAML and returns the new text. Everything the change does
 * not touch (comments, order, formatting) stays as written.
 */
export function editBase(source: string, edit: (doc: Document) => void): string {
  const doc = parseDocument(source)
  // A base relying on the default view gets it written out, so there is something to edit.
  if (!doc.has('views')) doc.set('views', viewsOf(parseBase(source).config))
  edit(doc)
  return doc.toString({ flowCollectionPadding: false }).replace(/\n$/, '')
}
