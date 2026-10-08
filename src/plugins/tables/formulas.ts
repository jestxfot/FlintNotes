import { expr } from '../../api'
import type { TableModel } from './model'

export interface CellValue {
  value: unknown
  /** Why a formula could not be computed. */
  error?: string
}

const flat = (args: unknown[]) => args.flat(Infinity)
const numbers = (args: unknown[]) => flat(args).filter((value): value is number => typeof value === 'number')
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)

/** `B2` -> zero-based row and column; rows count from 1 below the header. */
function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]+)([1-9]\d*)$/.exec(ref)
  if (!m) return null
  let c = 0
  for (const letter of m[1]) c = c * 26 + letter.charCodeAt(0) - 64
  return { r: Number(m[2]) - 1, c: c - 1 }
}

/** `B1:B9` cannot be parsed as an expression, so ranges become `range("B1","B9")`. Text in quotes is left alone. */
const expandRanges = (formula: string) =>
  formula
    .split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/)
    .map((part, i) => (i % 2 ? part : part.replace(/\b([A-Z]+[1-9]\d*):([A-Z]+[1-9]\d*)\b/g, 'range("$1","$2")')))
    .join('')

/** What a cell's text means as a value: a number, a date, a yes/no, or the text itself. */
function literal(text: string, type: string): unknown {
  const cell = text.trim()
  if (type === 'checkbox') return /^(x|true|да|✓|1)$/i.test(cell)
  if (!cell || cell === '<' || cell === '^') return null
  if (/^-?\d+(?:[.,]\d+)?$/.test(cell)) return Number(cell.replace(',', '.'))
  return expr.parseDate(cell) ?? cell
}

/**
 * Computes every cell of a table. A cell starting with `=` is a formula in the
 * app's expression language, with spreadsheet references on top:
 * `=B1*C1`, `=sum(B1:B5)`, `=avg(Цена)` (a column by its name), `=if(C2, "да", "нет")`.
 */
export function computeTable(model: TableModel): (r: number, c: number) => CellValue {
  const cache = new Map<string, CellValue>()
  const running = new Set<string>()

  const cell = (r: number, c: number): CellValue => {
    const key = `${r}:${c}`
    const known = cache.get(key)
    if (known) return known
    const text = model.rows[r]?.[c]
    if (text === undefined) return { value: null }
    let result: CellValue
    if (!text.startsWith('=')) result = { value: literal(text, model.columns[c].type) }
    else if (running.has(key)) result = { value: null, error: 'Формулы ссылаются друг на друга' }
    else {
      running.add(key)
      try {
        result = { value: expr.evaluate(expandRanges(text.slice(1)), scope(r)) }
      } catch (err) {
        result = { value: null, error: err instanceof Error ? err.message : String(err) }
      }
      running.delete(key)
    }
    cache.set(key, result)
    return result
  }

  /** The value a formula sees in another cell; an error there is an error here. */
  const read = (r: number, c: number): unknown => {
    const { value, error } = cell(r, c)
    if (error) throw new expr.ExprError(error)
    return value
  }

  const scope = (ownRow: number): expr.Scope => ({
    get: (name) => {
      const ref = parseRef(name)
      if (ref) return read(ref.r, ref.c)
      // A column's name gives the whole column, except the formula's own row
      // (so a totals row can sum the column it sits in).
      const column = model.columns.findIndex((col) => col.name.trim().toLowerCase() === name.replace(/_/g, ' ').toLowerCase())
      if (column < 0) return undefined
      return model.rows.map((_, r) => (r === ownRow ? null : read(r, column))).filter((value) => value !== null)
    },
    functions: {
      range: (from, to) => {
        const a = parseRef(String(from))
        const b = parseRef(String(to))
        if (!a || !b) throw new expr.ExprError('Неверный диапазон')
        const values: unknown[] = []
        for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) {
          for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) values.push(read(r, c))
        }
        return values
      },
      sum: (...args) => sum(numbers(args)),
      avg: (...args) => (numbers(args).length ? sum(numbers(args)) / numbers(args).length : null),
      average: (...args) => (numbers(args).length ? sum(numbers(args)) / numbers(args).length : null),
      min: (...args) => (numbers(args).length ? Math.min(...numbers(args)) : null),
      max: (...args) => (numbers(args).length ? Math.max(...numbers(args)) : null),
      count: (...args) => flat(args).filter((value) => !expr.isEmpty(value)).length,
      round: (value, digits) => (typeof value === 'number' ? Math.round(value * 10 ** Number(digits ?? 0)) / 10 ** Number(digits ?? 0) : null),
      abs: (value) => (typeof value === 'number' ? Math.abs(value) : null),
    },
  })

  return cell
}
