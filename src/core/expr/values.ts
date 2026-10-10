import { moment } from '../moment'

/** A span of time: whole months (which vary in length) plus milliseconds. */
export class Duration {
  constructor(
    readonly months: number,
    readonly ms: number,
  ) {}
}

/** A link to a file, as produced by `[[target|display]]` in a property. */
export class Link {
  constructor(
    readonly target: string,
    readonly display?: string,
  ) {}

  toString(): string {
    return this.display ?? this.target
  }
}

/** What the engine needs to know about a file; the app supplies it. */
export interface FileInfo {
  path: string
  size: number
  ctime: number
  mtime: number
  tags(): string[]
  links(): Link[]
  backlinks(): Link[]
  properties(): Record<string, unknown>
  /** The file a link target refers to, seen from this file. */
  resolve(target: string): string | null
  /** Whether this file links to the file at `path`; a quick answer from the link index. */
  /** Whether the file links to `path`; with `subpath` (`#Heading`, a view of a base), only links to that very part count. */
  linksTo?(path: string, subpath?: string): boolean
}

/** A file as a value in expressions: `file.name`, `file.hasTag("x")`. */
export class FileRef {
  constructor(readonly info: FileInfo) {}

  get path(): string {
    return this.info.path
  }

  get name(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }

  get ext(): string {
    const dot = this.name.lastIndexOf('.')
    return dot <= 0 ? '' : this.name.slice(dot + 1)
  }

  get basename(): string {
    return this.ext ? this.name.slice(0, -this.ext.length - 1) : this.name
  }

  get folder(): string {
    const slash = this.path.lastIndexOf('/')
    return slash < 0 ? '' : this.path.slice(0, slash)
  }

  toString(): string {
    return this.basename
  }
}

const DAY = 86_400_000
const UNITS: Record<string, [months: number, ms: number]> = {
  y: [12, 0],
  M: [1, 0],
  w: [0, 7 * DAY],
  d: [0, DAY],
  h: [0, 3_600_000],
  m: [0, 60_000],
  s: [0, 1000],
}
const UNIT_NAMES: Record<string, string> = {
  year: 'y',
  month: 'M',
  week: 'w',
  day: 'd',
  hour: 'h',
  minute: 'm',
  second: 's',
}

/** `"1d"`, `"2 weeks"`, `"-3M"` -> a duration; `null` if the text is not one. */
export function parseDuration(text: string): Duration | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*$/.exec(text)
  if (!m) return null
  const long = m[2].toLowerCase().replace(/s$/, '')
  const unit = Object.hasOwn(UNITS, m[2]) ? m[2] : Object.hasOwn(UNIT_NAMES, long) ? UNIT_NAMES[long] : null
  if (!unit) return null
  const [months, ms] = UNITS[unit]
  return new Duration(months * Number(m[1]), ms * Number(m[1]))
}

/** `2026-10-09` or `2026-10-09 14:30[:00]` (or with `T`) -> a local date; `null` otherwise. */
export function parseDate(text: string): Date | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(text)
  if (!m) return null
  const date = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  return Number.isNaN(date.getTime()) ? null : date
}

export function addDuration(date: Date, duration: Duration, sign = 1): Date {
  const result = new Date(date)
  if (duration.months) result.setMonth(result.getMonth() + sign * duration.months)
  return new Date(result.getTime() + sign * duration.ms)
}

/** Formats a date with moment.js tokens (`YYYY-MM-DD`, `dddd`, `D MMMM`, ...). */
export const formatDate = (date: Date, format: string): string => moment(date).format(format)

/** `2026-10-09`, with the time appended unless it is midnight. */
export function isoDate(date: Date): string {
  const time = date.getHours() || date.getMinutes() || date.getSeconds()
  return formatDate(date, time ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD')
}

export type ValueType =
  | 'null'
  | 'boolean'
  | 'number'
  | 'string'
  | 'date'
  | 'duration'
  | 'list'
  | 'link'
  | 'file'
  | 'object'

export function typeOf(value: unknown): ValueType {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return typeof value as ValueType
  if (value instanceof Date) return 'date'
  if (value instanceof Duration) return 'duration'
  if (Array.isArray(value)) return 'list'
  if (value instanceof Link) return 'link'
  if (value instanceof FileRef) return 'file'
  return 'object'
}

/** Whether a value counts as "yes": empty values, zero and `false` do not. */
export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return !(value === null || value === undefined || value === false || value === 0 || value === '')
}

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return typeOf(value) === 'object' && Object.keys(value as object).length === 0
}

const linkKey = (target: string) => target.toLowerCase().replace(/\.md$/, '')

export function equal(a: unknown, b: unknown): boolean {
  const type = typeOf(a)
  if (type !== typeOf(b)) return false
  if (type === 'null') return true
  if (type === 'date') return (a as Date).getTime() === (b as Date).getTime()
  if (type === 'link') return linkKey((a as Link).target) === linkKey((b as Link).target)
  if (type === 'file') return (a as FileRef).path === (b as FileRef).path
  if (type === 'list') {
    const [x, y] = [a as unknown[], b as unknown[]]
    return x.length === y.length && x.every((item, i) => equal(item, y[i]))
  }
  return a === b
}

/** Orders two values of the same kind; values that cannot be compared count as equal. */
export function compare(a: unknown, b: unknown): number {
  const type = typeOf(a)
  if (type !== typeOf(b)) return type === 'null' ? 1 : typeOf(b) === 'null' ? -1 : 0
  if (type === 'number' || type === 'boolean') return Number(a) - Number(b)
  if (type === 'date') return (a as Date).getTime() - (b as Date).getTime()
  if (type === 'string' || type === 'link' || type === 'file') {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  }
  return 0
}

/** Text form of a value, as shown in a cell. */
export function toText(value: unknown): string {
  const type = typeOf(value)
  if (type === 'null') return ''
  if (type === 'date') return isoDate(value as Date)
  if (type === 'list') return (value as unknown[]).map(toText).join(', ')
  if (type === 'number') return String(Math.round((value as number) * 1e10) / 1e10)
  if (type === 'object') return JSON.stringify(value)
  return String(value)
}
