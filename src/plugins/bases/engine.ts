import { expr, fileRef, path as paths, type App } from '../../api'
import type { BaseConfig, FilterNode, SortRule, ViewConfig } from './model'

export interface Row {
  path: string
  file: expr.FileRef
  /** The note's properties, converted to values (dates, links). */
  props: Record<string, unknown>
  scope: expr.Scope
}

export interface Group {
  /** Value of the grouping property; `undefined` when the view is not grouped. */
  key: unknown
  rows: Row[]
}

export interface ViewResult {
  groups: Group[]
  rows: Row[]
  errors: string[]
}

const FILE_LABELS: Record<string, string> = {
  'file.name': 'Имя',
  'file.basename': 'Название',
  'file.path': 'Путь',
  'file.folder': 'Папка',
  'file.ext': 'Тип',
  'file.size': 'Размер',
  'file.ctime': 'Создан',
  'file.mtime': 'Изменён',
  'file.tags': 'Теги',
  'file.links': 'Ссылки',
  'file.backlinks': 'Обратные ссылки',
}

/** `note.status` and `status` are the same property; this gives the bare name. */
export const noteKey = (property: string): string | null => {
  if (property.startsWith('note.')) return property.slice(5)
  return property.startsWith('file.') || property.startsWith('formula.') ? null : property
}

const descending = (rule: SortRule) => rule.direction?.toUpperCase() === 'DESC'

function compareValues(a: unknown, b: unknown): number {
  // Empty values go last whichever way the sort runs.
  if (expr.isEmpty(a) || expr.isEmpty(b)) return Number(expr.isEmpty(a)) - Number(expr.isEmpty(b))
  return expr.compare(a, b)
}

type Summary = (values: unknown[]) => unknown

const filled = (values: unknown[]) => values.filter((value) => !expr.isEmpty(value))
const numeric = (values: unknown[]) => values.filter((value): value is number => typeof value === 'number')
const total = (values: number[]) => values.reduce((a, b) => a + b, 0)
const sorted = (values: unknown[]) => filled(values).sort(expr.compare)

const SUMMARIES: Record<string, Summary> = {
  sum: (values) => total(numeric(values)),
  average: (values) => (numeric(values).length ? total(numeric(values)) / numeric(values).length : null),
  min: (values) => sorted(values)[0] ?? null,
  max: (values) => sorted(values).at(-1) ?? null,
  earliest: (values) => sorted(values)[0] ?? null,
  latest: (values) => sorted(values).at(-1) ?? null,
  range: (values) => {
    const list = numeric(values)
    return list.length ? Math.max(...list) - Math.min(...list) : null
  },
  median: (values) => {
    const list = numeric(values).sort((a, b) => a - b)
    const mid = list.length >> 1
    return list.length ? (list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2) : null
  },
  count: (values) => values.length,
  filled: (values) => filled(values).length,
  empty: (values) => values.length - filled(values).length,
  unique: (values) => new Set(filled(values).map(expr.toText)).size,
  checked: (values) => values.filter((value) => value === true).length,
  unchecked: (values) => values.filter((value) => value !== true).length,
}

const SUMMARY_NAMES = ['Sum', 'Average', 'Min', 'Max', 'Median', 'Range', 'Count', 'Filled', 'Empty', 'Unique', 'Checked', 'Unchecked']

/** What every record of one base shares. */
interface RowSource {
  app: App
  /** The note containing the base; `this` in expressions. */
  self: expr.FileRef
  formulas(scope: expr.Scope): Record<string, unknown>
}

/**
 * One file as a record. A vault has tens of thousands of files and a filter mostly looks at one thing of each
 * (its folder, a tag): the file's value, its properties and formulas are made only when something asks for them.
 * The record is its own scope for expressions, where a bare name is a property of the note.
 */
class FileRow implements Row, expr.Scope {
  private fileValue: expr.FileRef | undefined
  private propsValue: Record<string, unknown> | undefined
  private names: Record<string, unknown> | undefined

  constructor(
    readonly path: string,
    private source: RowSource,
  ) {}

  get file(): expr.FileRef {
    return (this.fileValue ??= fileRef(this.source.app, this.path))
  }

  get props(): Record<string, unknown> {
    return (this.propsValue ??= this.file.info.properties())
  }

  get scope(): expr.Scope {
    return this
  }

  get(name: string): unknown {
    this.names ??= { file: this.file, note: this.props, formula: this.source.formulas(this), this: this.source.self }
    return Object.hasOwn(this.names, name) ? this.names[name] : Object.hasOwn(this.props, name) ? this.props[name] : undefined
  }
}

/** Turns a base's configuration into rows: applies filters, formulas, sorting and grouping. */
export class BaseEngine {
  /**
   * The vault's files as they were when the base was worked out. Their records are made for each query and
   * only those it keeps live on: a base is kept for a while after it is shown, and with it every record it holds.
   */
  private files: string[]
  private source: RowSource

  constructor(
    private app: App,
    private config: BaseConfig,
    /** The note containing the base; `this` in expressions. */
    private sourcePath: string,
  ) {
    this.source = { app, self: fileRef(app, sourcePath), formulas: (scope) => this.formulas(() => scope) }
    this.files = app.vault.files().map((entry) => entry.path)
  }

  /** `formula.<name>` for one row: each formula is computed when first read. */
  private formulas(scope: () => expr.Scope): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const running = new Set<string>()
    for (const [name, source] of Object.entries(this.config.formulas ?? {})) {
      let cached: { value: unknown } | undefined
      Object.defineProperty(result, name, {
        enumerable: true,
        get: () => {
          if (cached) return cached.value
          if (running.has(name)) throw new expr.ExprError(`Формула «${name}» ссылается сама на себя`)
          running.add(name)
          try {
            cached = { value: expr.evaluate(String(source), scope()) }
          } finally {
            running.delete(name)
          }
          return cached.value
        },
      })
    }
    return result
  }

  /** Value of a property (`file.name`, `formula.total`, `note.status`, `status`) for a row. */
  value(row: Row, property: string): unknown {
    try {
      if (property.startsWith('formula.')) return (row.scope.get('formula') as Record<string, unknown>)[property.slice(8)] ?? null
      if (property.startsWith('file.')) return expr.evaluate(property, row.scope)
      const key = noteKey(property)!
      return Object.hasOwn(row.props, key) ? row.props[key] : null
    } catch (err) {
      return err instanceof Error ? `⚠ ${err.message}` : null
    }
  }

  label(property: string): string {
    const custom = this.config.properties?.[property]?.displayName
    if (custom) return custom
    if (property.startsWith('formula.')) return property.slice(8)
    return FILE_LABELS[property] ?? noteKey(property) ?? property.replace(/^file\./, '')
  }

  /** Every property a view could show: file fields, formulas, and note properties seen in `rows`. */
  available(rows: Row[]): string[] {
    const note = new Set<string>()
    for (const row of rows) for (const key of Object.keys(row.props)) note.add(key)
    return [
      'file.name',
      ...[...note].sort((a, b) => a.localeCompare(b)),
      ...Object.keys(this.config.formulas ?? {}).map((name) => `formula.${name}`),
      'file.folder',
      'file.tags',
      'file.mtime',
      'file.ctime',
      'file.size',
      'file.path',
    ]
  }

  /** The columns of a view: its `order`, or the name plus the most used note properties. */
  columns(view: ViewConfig, rows: Row[]): string[] {
    if (Array.isArray(view.order) && view.order.length) return view.order.map(String)
    const counts = new Map<string, number>()
    for (const row of rows) for (const key of Object.keys(row.props)) counts.set(key, (counts.get(key) ?? 0) + 1)
    const common = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key]) => key)
    return ['file.name', ...common, ...Object.keys(this.config.formulas ?? {}).map((name) => `formula.${name}`)]
  }

  query(view: ViewConfig): ViewResult {
    const errors = new Set<string>()
    const matches = (node: FilterNode | undefined, row: Row): boolean => {
      if (node === undefined || node === null) return true
      if (typeof node === 'string') {
        try {
          return expr.truthy(expr.evaluate(node, row.scope))
        } catch (err) {
          errors.add(`${node}: ${err instanceof Error ? err.message : String(err)}`)
          return false
        }
      }
      if (typeof node !== 'object') return expr.truthy(node)
      return (
        (node.and ?? []).every((part) => matches(part, row)) &&
        (!node.or || node.or.some((part) => matches(part, row))) &&
        !(node.not ?? []).some((part) => matches(part, row))
      )
    }

    let rows = this.files.map((path): Row => new FileRow(path, this.source)).filter((row) => matches(this.config.filters, row) && matches(view.filters, row))
    const sort = Array.isArray(view.sort) ? view.sort.filter((rule) => rule?.property) : []
    // Without an explicit sort, rows go by name so the order is stable.
    rows.sort((a, b) => {
      for (const rule of sort) {
        const [x, y] = [this.value(a, rule.property), this.value(b, rule.property)]
        const order = compareValues(x, y)
        if (order) return descending(rule) && !expr.isEmpty(x) && !expr.isEmpty(y) ? -order : order
      }
      return paths.basename(a.path).localeCompare(paths.basename(b.path), undefined, { numeric: true })
    })
    if (typeof view.limit === 'number') rows = rows.slice(0, view.limit)

    const group = groupRule(view)
    if (!group) return { groups: [{ key: undefined, rows }], rows, errors: [...errors] }
    const groups: Group[] = []
    for (const row of rows) {
      const key = this.value(row, group.property)
      // A row with several values (tags, a list) appears in each of their groups.
      for (const part of Array.isArray(key) && key.length ? key : [Array.isArray(key) ? null : key]) {
        const found = groups.find((g) => expr.equal(g.key, part))
        if (found) found.rows.push(row)
        else groups.push({ key: part, rows: [row] })
      }
    }
    groups.sort((a, b) => {
      const order = compareValues(a.key, b.key)
      return descending(group) && !expr.isEmpty(a.key) && !expr.isEmpty(b.key) ? -order : order
    })
    return { groups, rows, errors: [...errors] }
  }

  /** Names a view may use in `summaries`: the built-in ones and those the base defines. */
  summaryNames(): string[] {
    return [...SUMMARY_NAMES, ...Object.keys(this.config.summaries ?? {})]
  }

  /** A view's summary of one property over the given rows, or `undefined` if it has none. */
  summary(view: ViewConfig, property: string, rows: Row[]): { name: string; value: unknown } | undefined {
    const name = view.summaries?.[property]
    if (!name) return undefined
    const values = rows.map((row) => this.value(row, property))
    const defined = this.config.summaries ?? {}
    const custom = Object.hasOwn(defined, name) ? defined[name] : undefined
    try {
      if (custom) return { name, value: expr.evaluate(String(custom), { get: (n) => (n === 'values' ? values : undefined) }) }
      const key = name.toLowerCase()
      return { name, value: Object.hasOwn(SUMMARIES, key) ? SUMMARIES[key](values) : `⚠ нет итога «${name}»` }
    } catch (err) {
      return { name, value: `⚠ ${err instanceof Error ? err.message : String(err)}` }
    }
  }
}

export function groupRule(view: ViewConfig): SortRule | null {
  const group = view.groupBy
  if (!group) return null
  return typeof group === 'string' ? { property: group } : group.property ? group : null
}
