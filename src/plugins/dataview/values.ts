import { moment, Moment } from '../../api'

/** A link as a value: `[[path|display]]`. */
export class Link {
  constructor(
    public path: string,
    public display?: string,
    public embed = false,
    public subpath?: string,
  ) {}

  toString(): string {
    return `${this.embed ? '!' : ''}[[${this.path}${this.subpath ? `#${this.subpath}` : ''}${this.display ? `|${this.display}` : ''}]]`
  }
}

/** A span of time: whole months (which vary in length) plus milliseconds. */
export class Dur {
  constructor(
    public months: number,
    public ms: number,
    /**
     * A difference of two dates, as Dataview gives it: its parts are read like a calendar's,
     * whole years, then the months left over, then the days (`(date(today) - birthday).years`
     * is an age), where a duration written out (`dur(36 hours)`) gives each part in full.
     */
    public calendar = false,
  ) {}

  /** Length in milliseconds, counting a month as 30 days, for comparing and sorting. */
  valueOf(): number {
    return this.months * 2_592_000_000 + this.ms
  }
}

export type TypeName = 'null' | 'number' | 'string' | 'boolean' | 'date' | 'duration' | 'link' | 'array' | 'object' | 'function'

export function typeOf(value: unknown): TypeName {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'function') {
    return typeof value as TypeName
  }
  if (value instanceof Moment) return 'date'
  if (value instanceof Dur) return 'duration'
  if (value instanceof Link) return 'link'
  return Array.isArray(value) ? 'array' : 'object'
}

/** Dataview's idea of "yes": empty text, zero, an empty list and nothing at all are "no". */
export function truthy(value: unknown): boolean {
  switch (typeOf(value)) {
    case 'null': return false
    case 'number': return value !== 0
    case 'string': return (value as string).length > 0
    case 'boolean': return value as boolean
    case 'array': return (value as unknown[]).length > 0
    case 'object': return Object.keys(value as object).length > 0
    case 'duration': return (value as Dur).valueOf() !== 0
    case 'link': return !!(value as Link).path
    default: return true
  }
}

// When two values of different kinds are compared, they go in this order.
const ORDER: TypeName[] = ['null', 'boolean', 'number', 'string', 'date', 'duration', 'link', 'array', 'object', 'function']

const linkKey = (link: Link) => link.path.toLowerCase().replace(/\.md$/, '')

/** Orders any two values; nothing sorts first. */
export function compare(a: unknown, b: unknown): number {
  const [ta, tb] = [typeOf(a), typeOf(b)]
  if (ta !== tb) return ORDER.indexOf(ta) - ORDER.indexOf(tb)
  switch (ta) {
    case 'number':
    case 'boolean':
      return Number(a) - Number(b)
    case 'string':
      return (a as string).localeCompare(b as string, undefined, { numeric: true })
    case 'date':
    case 'duration':
      return (a as Moment).valueOf() - (b as Moment).valueOf()
    case 'link':
      return linkKey(a as Link).localeCompare(linkKey(b as Link), undefined, { numeric: true })
    case 'array': {
      const [x, y] = [a as unknown[], b as unknown[]]
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const order = compare(x[i], y[i])
        if (order) return order
      }
      return x.length - y.length
    }
    default:
      return 0
  }
}

export const equals = (a: unknown, b: unknown) => compare(a, b) === 0

const UNITS: [RegExp, number, number][] = [
  [/^(y|yr|yrs|year|years)$/, 12, 0],
  [/^(mo|month|months)$/, 1, 0],
  [/^(w|wk|wks|week|weeks)$/, 0, 604_800_000],
  [/^(d|day|days)$/, 0, 86_400_000],
  [/^(h|hr|hrs|hour|hours)$/, 0, 3_600_000],
  [/^(m|min|mins|minute|minutes)$/, 0, 60_000],
  [/^(s|sec|secs|second|seconds)$/, 0, 1000],
]

/** `1 day`, `2h 30m`, `1 yr, 2 months` -> a duration; `null` if the text is not one. */
export function parseDuration(text: string): Dur | null {
  const parts = [...text.trim().matchAll(/(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g)]
  if (!parts.length || text.replace(/(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)|[\s,]/g, '')) return null
  let months = 0
  let ms = 0
  for (const [, amount, name] of parts) {
    const unit = UNITS.find(([pattern]) => pattern.test(name.toLowerCase()))
    if (!unit) return null
    months += Number(amount) * unit[1]
    ms += Number(amount) * unit[2]
  }
  return new Dur(months, ms)
}

const DATE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}(:\d{2})?)?$/

/** `2026-10-09`, `2026-10`, `2026-10-09T14:30` -> a date; `null` otherwise. */
export function parseDate(text: string): Moment | null {
  const value = text.trim()
  if (!DATE.test(value)) return null
  const date = moment(value.length === 7 ? `${value}-01` : value)
  return date.isValid() ? date : null
}

const LINK = /^(!?)\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]$/

export function parseLink(text: string): Link | null {
  const m = LINK.exec(text.trim())
  return m ? new Link(m[2].trim(), m[4]?.trim() || undefined, m[1] === '!', m[3]?.trim() || undefined) : null
}

/**
 * Reads the value of a field written in a note: a number, yes/no, a date, a
 * duration, a link, a comma-separated list of links, or the text itself.
 */
export function parseValue(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(parseValue)
  if (raw instanceof Date) return moment(raw)
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'object') return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, parseValue(value)]))
  if (typeof raw !== 'string') return raw
  const text = raw.trim()
  if (!text) return null
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  if (text === 'true' || text === 'false') return text === 'true'
  const links = text.split(/,\s*(?=!?\[\[)/).map(parseLink)
  if (links.every(Boolean)) return links.length === 1 ? links[0] : links
  return parseDate(text) ?? parseDuration(text) ?? text
}

/** Text form of a duration: `2 дня, 3 часа`. */
export function formatDuration(duration: Dur): string {
  const parts: string[] = []
  const take = (amount: number, forms: [string, string, string]) => {
    if (!amount) return
    const rule = new Intl.PluralRules('ru').select(amount)
    parts.push(`${amount} ${rule === 'one' ? forms[0] : rule === 'few' ? forms[1] : forms[2]}`)
  }
  take(Math.trunc(duration.months / 12), ['год', 'года', 'лет'])
  take(duration.months % 12, ['месяц', 'месяца', 'месяцев'])
  let rest = Math.abs(duration.ms)
  for (const [size, forms] of [
    [86_400_000, ['день', 'дня', 'дней']],
    [3_600_000, ['час', 'часа', 'часов']],
    [60_000, ['минута', 'минуты', 'минут']],
    [1000, ['секунда', 'секунды', 'секунд']],
  ] as [number, [string, string, string]][]) {
    take(Math.floor(rest / size), forms)
    rest %= size
  }
  return (duration.valueOf() < 0 ? '−' : '') + (parts.join(', ') || '0 секунд')
}

/** Plain text of a value, as used for joining, grouping titles and export. */
export function toText(value: unknown, dateFormat = 'D MMMM YYYY'): string {
  switch (typeOf(value)) {
    case 'null': return ''
    case 'date': {
      const date = value as Moment
      const hasTime = date.hour() || date.minute() || date.second()
      return date.format(hasTime ? `HH:mm, ${dateFormat}` : dateFormat)
    }
    case 'duration': return formatDuration(value as Dur)
    case 'link': return (value as Link).display ?? (value as Link).path.replace(/^.*\//, '').replace(/\.md$/, '')
    case 'array': return (value as unknown[]).map((item) => toText(item, dateFormat)).join(', ')
    case 'object': return Object.entries(value as object).map(([key, v]) => `${key}: ${toText(v, dateFormat)}`).join(', ')
    case 'function': return '<function>'
    default: return String(value)
  }
}
