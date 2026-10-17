import { Moment } from '../../api'
import { sanitize, type Page } from './pages'
import { NAMED_DATES, QueryError, type Node } from './parser'
import { compare, Dur, equals, formatDuration, Link, parseDate, parseDuration, toText, truthy, typeOf } from './values'

/** What an expression is evaluated against. */
export interface Scope {
  /** The row: a page, a task, or a group. */
  row: Record<string, unknown>
  /** The note the query is written in (`this`). */
  self?: Page
  /** Arguments of the lambdas being run. */
  locals?: Record<string, unknown>
  /** Finds the page a link points to. */
  page(link: Link): Page | undefined
}

type Fn = (...args: any[]) => unknown

const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined)

/** Reads a field of an object by its name as written, or by its normalised name. */
function lookup(object: Record<string, unknown>, name: string): unknown {
  if (Object.hasOwn(object, name)) return object[name]
  const descriptor = Object.getOwnPropertyDescriptor(object, name)
  if (descriptor) return object[name]
  const clean = sanitize(name)
  return Object.hasOwn(object, clean) ? object[clean] : null
}

const DATE_PARTS: Record<string, (d: Moment) => number> = {
  year: (d) => d.year(), month: (d) => d.month() + 1, weekyear: (d) => d.isoWeek(), week: (d) => d.isoWeek(), weekday: (d) => d.isoWeekday(),
  day: (d) => d.date(), hour: (d) => d.hour(), minute: (d) => d.minute(), second: (d) => d.second(),
}
const DURATION_PARTS: Record<string, (d: Dur) => number> = {
  years: (d) => d.months / 12, months: (d) => d.months, weeks: (d) => d.ms / 604_800_000, days: (d) => d.ms / 86_400_000,
  hours: (d) => d.ms / 3_600_000, minutes: (d) => d.ms / 60_000, seconds: (d) => d.ms / 1000,
}
/** The parts of a difference of dates: each what is left after the larger ones, as on a calendar. */
const CALENDAR_PARTS: Record<string, (d: Dur) => number> = {
  years: (d) => Math.trunc(d.months / 12), months: (d) => d.months % 12, weeks: (d) => Math.trunc(d.ms / 604_800_000), days: (d) => Math.trunc(d.ms / 86_400_000),
  hours: (d) => Math.trunc((d.ms % 86_400_000) / 3_600_000), minutes: (d) => Math.trunc((d.ms % 3_600_000) / 60_000), seconds: (d) => Math.trunc((d.ms % 60_000) / 1000),
}

/** How far apart two dates are, in whole calendar months and what is left: from 26 December to 17 October is 9 months and 21 days. */
export function between(later: Moment, earlier: Moment): Dur {
  const months = later.diff(earlier, 'months')
  return new Dur(months, later.valueOf() - earlier.clone().add(months, 'months').valueOf(), true)
}

function index(object: unknown, key: unknown, scope: Scope): unknown {
  switch (typeOf(object)) {
    case 'null': return null
    case 'array': {
      const list = object as unknown[]
      if (typeof key === 'number') return list.at(key) ?? null
      if (key === 'length') return list.length
      // A field of a list is that field of each of its items: `rows.file.name`.
      return list.map((item) => index(item, key, scope))
    }
    case 'link': {
      const link = object as Link
      if (key === 'path' || key === 'display' || key === 'embed' || key === 'subpath') return link[key] ?? null
      // A field of a link is that field of the note it points to.
      const page = scope.page(link)
      return page ? lookup(page, String(key)) : null
    }
    case 'date': return own(DATE_PARTS, String(key))?.(object as Moment) ?? null
    case 'duration': return own((object as Dur).calendar ? CALENDAR_PARTS : DURATION_PARTS, String(key))?.(object as Dur) ?? null
    case 'string': return typeof key === 'number' ? ((object as string)[key] ?? null) : key === 'length' ? (object as string).length : null
    case 'object': return lookup(object as Record<string, unknown>, String(key))
    default: return null
  }
}

const addDuration = (date: Moment, dur: Dur, sign: number) => date.clone().add(sign * dur.months, 'month').add(sign * dur.ms, 'millisecond')

function binary(op: string, a: unknown, b: unknown): unknown {
  const [ta, tb] = [typeOf(a), typeOf(b)]
  switch (op) {
    case '=': return equals(a, b)
    case '!=': return !equals(a, b)
    case '<': return compare(a, b) < 0
    case '>': return compare(a, b) > 0
    case '<=': return compare(a, b) <= 0
    case '>=': return compare(a, b) >= 0
  }
  if (ta === 'number' && tb === 'number') {
    const [x, y] = [a as number, b as number]
    return op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? (y === 0 ? null : x / y) : y === 0 ? null : x % y
  }
  if (op === '+') {
    if (ta === 'date' && tb === 'duration') return addDuration(a as Moment, b as Dur, 1)
    if (ta === 'duration' && tb === 'duration') return new Dur((a as Dur).months + (b as Dur).months, (a as Dur).ms + (b as Dur).ms)
    if (ta === 'array' && tb === 'array') return [...(a as unknown[]), ...(b as unknown[])]
    if (ta === 'string' || tb === 'string') return toText(a) + toText(b)
  }
  if (op === '-') {
    if (ta === 'date' && tb === 'date') return between(a as Moment, b as Moment)
    if (ta === 'date' && tb === 'duration') return addDuration(a as Moment, b as Dur, -1)
    if (ta === 'duration' && tb === 'duration') return new Dur((a as Dur).months - (b as Dur).months, (a as Dur).ms - (b as Dur).ms)
  }
  if ((op === '*' || op === '/') && ta === 'duration' && tb === 'number') {
    const factor = op === '*' ? (b as number) : 1 / (b as number)
    return new Dur((a as Dur).months * factor, (a as Dur).ms * factor)
  }
  if (op === '*' && ta === 'string' && tb === 'number') return (a as string).repeat(Math.max(0, b as number))
  // Arithmetic with a missing value gives a missing value: most notes lack most fields.
  if (ta === 'null' || tb === 'null') return null
  throw new QueryError(`Нельзя применить «${op}» к ${ta} и ${tb}`)
}

/** Applies a text function to a value or to each item of a list, as Dataview does. */
const each = (fn: (value: any, ...rest: any[]) => unknown): Fn => (value, ...rest) => (Array.isArray(value) ? value.map((item) => fn(item, ...rest)) : fn(value, ...rest))
const text = (value: unknown) => (typeof value === 'string' ? value : toText(value))
const numbers = (values: unknown[]) => values.flat(Infinity).filter((v): v is number => typeof v === 'number')
const listOf = (args: unknown[]) => (args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args)

// Dataview formats dates with Luxon's tokens; they are turned into moment.js ones.
const LUXON: [RegExp, string][] = [[/yyyy/g, 'YYYY'], [/yy/g, 'YY'], [/dd/g, 'DD'], [/\bd\b/g, 'D'], [/EEEE/g, 'dddd'], [/EEE/g, 'ddd'], [/\ba\b/g, 'A'], [/'([^']*)'/g, '[$1]']]
const luxonFormat = (format: string) => LUXON.reduce((result, [from, to]) => result.replace(from, to), format)

function contains(container: unknown, value: unknown, same: (a: string, b: string) => boolean, exact = false): boolean {
  switch (typeOf(container)) {
    case 'array': return (container as unknown[]).some((item) => (exact ? equals(item, value) : equals(item, value) || (typeOf(item) === 'string' && typeOf(value) === 'string' && same(item as string, value as string)) || (Array.isArray(item) && contains(item, value, same))))
    case 'string': return same(container as string, text(value))
    case 'object': return Object.hasOwn(container as object, text(value))
    default: return false
  }
}

export const FUNCTIONS: Record<string, Fn> = {
  // ---- containers
  contains: (c, v) => contains(c, v, (a, b) => a.includes(b)),
  icontains: (c, v) => contains(c, v, (a, b) => a.toLowerCase().includes(b.toLowerCase())),
  econtains: (c, v) => contains(c, v, (a, b) => a.includes(b), true),
  containsword: each((s, word) => typeof s === 'string' && s.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(text(word).toLowerCase())),
  length: (v) => (typeof v === 'string' || Array.isArray(v) ? v.length : typeOf(v) === 'object' ? Object.keys(v).length : 0),
  list: (...items) => items,
  array: (...items) => items,
  object: (...pairs) => Object.fromEntries(Array.from({ length: pairs.length >> 1 }, (_, i) => [text(pairs[i * 2]), pairs[i * 2 + 1]])),
  extract: (object, ...keys) => Object.fromEntries(keys.map((key) => [text(key), object?.[text(key)] ?? null])),
  // ---- making values
  link: each((path, display) => (path instanceof Link ? new Link(path.path, display ?? path.display) : path === null ? null : new Link(text(path), display ?? undefined))),
  embed: each((link, on = true) => (link instanceof Link ? new Link(link.path, link.display, !!on, link.subpath) : link)),
  elink: (url, display) => `[${text(display ?? url)}](${text(url)})`,
  date: each((value) => (value instanceof Moment ? value : value instanceof Link ? parseDate(value.display ?? '') ?? parseDate(value.path.replace(/^.*\//, '').replace(/\.md$/, '')) : typeof value === 'string' ? (own(NAMED_DATES, value.trim().toLowerCase())?.() ?? parseDate(value)) : null)),
  dur: each((value) => (value instanceof Dur ? value : typeof value === 'string' ? parseDuration(value) : null)),
  number: each((value) => (typeof value === 'number' ? value : typeof value === 'string' ? (/-?\d+(\.\d+)?/.exec(value) ? Number(/-?\d+(\.\d+)?/.exec(value)![0]) : null) : null)),
  string: (value) => text(value),
  typeof: (value) => typeOf(value),
  meta: (link) => (link instanceof Link ? { display: link.display ?? null, embed: link.embed, path: link.path, subpath: link.subpath ?? null, type: link.subpath ? 'header' : 'file' } : null),
  // ---- numbers
  round: each((n, digits = 0) => (typeof n === 'number' ? Math.round(n * 10 ** digits) / 10 ** digits : n)),
  trunc: each((n) => (typeof n === 'number' ? Math.trunc(n) : n)),
  floor: each((n) => (typeof n === 'number' ? Math.floor(n) : n)),
  ceil: each((n) => (typeof n === 'number' ? Math.ceil(n) : n)),
  min: (...args) => [...listOf(args)].filter((v) => v !== null && v !== undefined).sort(compare)[0] ?? null,
  max: (...args) => [...listOf(args)].filter((v) => v !== null && v !== undefined).sort(compare).at(-1) ?? null,
  sum: (...args) => {
    const list: unknown[] = listOf(args).filter((v) => v !== null && v !== undefined)
    return list.length ? list.reduce((a, b) => binary('+', a, b)) : null
  },
  product: (...args) => numbers(listOf(args)).reduce((a, b) => a * b, 1),
  average: (...args) => {
    const list = numbers(listOf(args))
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null
  },
  reduce: (list, op) => (Array.isArray(list) && list.length ? list.reduce((a, b) => binary(text(op), a, b)) : null),
  minby: (list, fn) => (Array.isArray(list) && list.length ? [...list].sort((a, b) => compare(fn(a), fn(b)))[0] : null),
  maxby: (list, fn) => (Array.isArray(list) && list.length ? [...list].sort((a, b) => compare(fn(a), fn(b))).at(-1) : null),
  // ---- text
  lower: each((s) => (typeof s === 'string' ? s.toLowerCase() : s)),
  upper: each((s) => (typeof s === 'string' ? s.toUpperCase() : s)),
  replace: each((s, from, to) => (typeof s === 'string' ? s.split(text(from)).join(text(to)) : s)),
  regextest: (pattern, s) => (typeof s === 'string' ? new RegExp(text(pattern)).test(s) : false),
  // The whole text must match, unless the pattern says itself where it is anchored (`^2025` is "starts with").
  regexmatch: (pattern, s) => {
    const source = text(pattern)
    return typeof s === 'string' ? new RegExp(source.startsWith('^') || source.endsWith('$') ? source : `^(?:${source})$`).test(s) : false
  },
  regexreplace: each((s, pattern, to) => (typeof s === 'string' ? s.replace(new RegExp(text(pattern), 'g'), text(to)) : s)),
  split: (s, separator, limit) => (typeof s === 'string' ? s.split(new RegExp(text(separator)), limit ?? undefined) : []),
  startswith: each((s, prefix) => typeof s === 'string' && s.startsWith(text(prefix))),
  endswith: each((s, suffix) => typeof s === 'string' && s.endsWith(text(suffix))),
  padleft: each((s, length, pad = ' ') => text(s).padStart(length, text(pad))),
  padright: each((s, length, pad = ' ') => text(s).padEnd(length, text(pad))),
  substring: each((s, start, end) => (typeof s === 'string' ? s.substring(start, end ?? undefined) : s)),
  truncate: each((s, length, suffix = '...') => (typeof s === 'string' && s.length > length ? s.slice(0, Math.max(0, length - text(suffix).length)) + text(suffix) : s)),
  join: (list, separator = ', ') => (Array.isArray(list) ? list.map((item) => toText(item)).join(text(separator)) : toText(list)),
  // ---- lists
  sort: (list) => (Array.isArray(list) ? [...list].sort(compare) : list),
  reverse: (list) => (Array.isArray(list) ? [...list].reverse() : list),
  flat: (list, depth = 1) => (Array.isArray(list) ? list.flat(depth) : list),
  slice: (list, start, end) => (Array.isArray(list) ? list.slice(start ?? 0, end ?? undefined) : list),
  filter: (list, fn) => (Array.isArray(list) ? list.filter((item) => truthy(fn(item))) : list),
  map: (list, fn) => (Array.isArray(list) ? list.map((item) => fn(item)) : list),
  unique: (list) => (Array.isArray(list) ? list.filter((item, i) => list.findIndex((other) => equals(other, item)) === i) : list),
  nonnull: (...args) => listOf(args).filter((v) => v !== null && v !== undefined),
  firstvalue: (list) => (Array.isArray(list) ? (list.find((v) => v !== null && v !== undefined) ?? null) : list),
  all: (...args) => (typeof args.at(-1) === 'function' ? listOf(args.slice(0, -1)).every((v) => truthy(args.at(-1)(v))) : listOf(args).every(truthy)),
  any: (...args) => (typeof args.at(-1) === 'function' ? listOf(args.slice(0, -1)).some((v) => truthy(args.at(-1)(v))) : listOf(args).some(truthy)),
  none: (...args) => (typeof args.at(-1) === 'function' ? !listOf(args.slice(0, -1)).some((v) => truthy(args.at(-1)(v))) : !listOf(args).some(truthy)),
  // ---- choosing
  default: (value, fallback) => (Array.isArray(value) ? value.map((item, i) => item ?? (Array.isArray(fallback) ? fallback[i] : fallback)) : (value ?? fallback)),
  choice: (condition, yes, no) => (truthy(condition) ? yes : no),
  // ---- dates
  dateformat: each((date, format) => (date instanceof Moment ? date.format(luxonFormat(text(format))) : null)),
  durationformat: each((dur) => (dur instanceof Dur ? formatDuration(dur) : null)),
  striptime: each((date) => (date instanceof Moment ? date.clone().startOf('day') : null)),
  localtime: each((date) => date),
  currencyformat: each((n, currency = 'RUB') => (typeof n === 'number' ? new Intl.NumberFormat('ru', { style: 'currency', currency: text(currency) }).format(n) : n)),
}

/** Works out the value of an expression for one row. */
export function evaluate(node: Node, scope: Scope): unknown {
  switch (node.type) {
    case 'literal': return node.value
    case 'date': return node.make()
    case 'list': return node.items.map((item) => evaluate(item, scope))
    case 'object': return Object.fromEntries(node.entries.map(([key, value]) => [key, evaluate(value, scope)]))
    case 'field': {
      if (scope.locals && Object.hasOwn(scope.locals, node.name)) return scope.locals[node.name]
      if (node.name === 'this') return scope.self ?? null
      return lookup(scope.row, node.name)
    }
    case 'index': return index(evaluate(node.object, scope), evaluate(node.key, scope), scope)
    case 'unary': {
      const value = evaluate(node.arg, scope)
      if (node.op === '!') return !truthy(value)
      if (typeof value === 'number') return -value
      if (value instanceof Dur) return new Dur(-value.months, -value.ms, value.calendar)
      return null
    }
    case 'binary': {
      if (node.op === 'and') return truthy(evaluate(node.left, scope)) && truthy(evaluate(node.right, scope))
      if (node.op === 'or') return truthy(evaluate(node.left, scope)) || truthy(evaluate(node.right, scope))
      return binary(node.op, evaluate(node.left, scope), evaluate(node.right, scope))
    }
    case 'lambda':
      return (...args: unknown[]) =>
        evaluate(node.body, { ...scope, locals: { ...scope.locals, ...Object.fromEntries(node.params.map((name, i) => [name, args[i] ?? null])) } })
    case 'call': {
      const args = node.args.map((arg) => evaluate(arg, scope))
      if (node.callee.type === 'field') {
        const fn = own(FUNCTIONS, node.callee.name.toLowerCase())
        if (fn) return fn(...args)
        const local = scope.locals?.[node.callee.name]
        if (typeof local === 'function') return (local as Fn)(...args)
        throw new QueryError(`Нет функции «${node.callee.name}»`)
      }
      const callee = evaluate(node.callee, scope)
      if (typeof callee !== 'function') throw new QueryError('Это нельзя вызвать')
      return (callee as Fn)(...args)
    }
  }
}

