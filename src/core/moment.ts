/**
 * Dates with moment.js-style formatting, e.g. `moment().add(1, 'week').format('dddd, D MMMM YYYY')`.
 * Covers what templates and periodic notes use: format tokens, parsing by
 * format, arithmetic, start/end of a period, ISO weeks. Names are in Russian.
 */

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
const DAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export type Unit = 'year' | 'quarter' | 'month' | 'week' | 'isoWeek' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond'

const UNIT_ALIASES: Record<string, Unit> = {
  y: 'year', years: 'year', Q: 'quarter', quarters: 'quarter', M: 'month', months: 'month',
  w: 'week', weeks: 'week', isoWeeks: 'isoWeek', d: 'day', days: 'day', date: 'day', h: 'hour', hours: 'hour',
  m: 'minute', minutes: 'minute', s: 'second', seconds: 'second', ms: 'millisecond', milliseconds: 'millisecond',
}

const unit = (name: string): Unit => (Object.hasOwn(UNIT_ALIASES, name) ? UNIT_ALIASES[name] : (name as Unit))
const pad = (n: number, length = 2) => String(Math.abs(n)).padStart(length, '0')

const TOKEN = /\[([^\]]*)\]|YYYY|YY|GGGG|gggg|MMMM|MMM|MM|M|Do|DDDD|DD|D|dddd|ddd|dd|d|E|e|WW|W|ww|w|Q|HH|H|hh|h|mm|m|ss|s|SSS|A|a|ZZ|Z|X|x/g

export interface DurationParts {
  years?: number
  months?: number
  weeks?: number
  days?: number
  hours?: number
  minutes?: number
  seconds?: number
}

/** `P1Y2M3DT4H`, `P-1M`, `P2W`: an ISO 8601 duration. `null` if the text is not one. */
export function parseIsoDuration(text: string): DurationParts | null {
  const m = /^P(?:(-?\d+)Y)?(?:(-?\d+)M)?(?:(-?\d+)W)?(?:(-?\d+)D)?(?:T(?:(-?\d+)H)?(?:(-?\d+)M)?(?:(-?\d+)S)?)?$/.exec(text.trim())
  if (!m || text.trim() === 'P') return null
  const [, years, months, weeks, days, hours, minutes, seconds] = m.map((part) => (part === undefined ? 0 : Number(part)))
  return { years, months, weeks, days, hours, minutes, seconds }
}

export class Moment {
  private d: Date

  constructor(date: Date) {
    this.d = new Date(date.getTime())
  }

  isValid(): boolean {
    return !Number.isNaN(this.d.getTime())
  }

  clone(): Moment {
    return new Moment(this.d)
  }

  toDate(): Date {
    return new Date(this.d.getTime())
  }

  valueOf(): number {
    return this.d.getTime()
  }

  unix(): number {
    return Math.floor(this.d.getTime() / 1000)
  }

  toISOString(): string {
    return this.d.toISOString()
  }

  toString(): string {
    return this.format()
  }

  /** Accepted for compatibility with moment.js; names are always Russian here. */
  locale(_name?: string): this {
    return this
  }

  year(): number {
    return this.d.getFullYear()
  }
  /** 0 for January, as in moment.js. */
  month(): number {
    return this.d.getMonth()
  }
  date(): number {
    return this.d.getDate()
  }
  /** 0 for Sunday. */
  day(): number {
    return this.d.getDay()
  }
  /** 1 for Monday to 7 for Sunday. */
  isoWeekday(): number {
    return this.d.getDay() || 7
  }
  /** 0 for Monday to 6 for Sunday: the day's place in a week that starts on Monday. */
  weekday(): number {
    return (this.d.getDay() + 6) % 7
  }
  hour(): number {
    return this.d.getHours()
  }
  minute(): number {
    return this.d.getMinutes()
  }
  second(): number {
    return this.d.getSeconds()
  }
  quarter(): number {
    return Math.floor(this.d.getMonth() / 3) + 1
  }
  daysInMonth(): number {
    return new Date(this.year(), this.month() + 1, 0).getDate()
  }
  dayOfYear(): number {
    return Math.round((this.clone().startOf('day').valueOf() - new Date(this.year(), 0, 1).getTime()) / 86_400_000) + 1
  }

  /** The Thursday of this date's ISO week decides which year and week number it belongs to. */
  private isoThursday(): Date {
    const date = new Date(this.year(), this.month(), this.date())
    date.setDate(date.getDate() + 4 - this.isoWeekday())
    return date
  }
  isoWeekYear(): number {
    return this.isoThursday().getFullYear()
  }
  isoWeek(): number {
    const thursday = this.isoThursday()
    return Math.round((thursday.getTime() - new Date(thursday.getFullYear(), 0, 1).getTime()) / 86_400_000 / 7 - 0.4) + 1
  }
  week(): number {
    return this.isoWeek()
  }

  /** Sets one field: `set('date', 1)`, `set('month', 0)`. */
  set(what: string, value: number): this {
    const u = unit(what)
    if (u === 'year') this.d.setFullYear(value)
    else if (u === 'month') this.d.setMonth(value)
    else if (u === 'day') this.d.setDate(value)
    else if (u === 'hour') this.d.setHours(value)
    else if (u === 'minute') this.d.setMinutes(value)
    else if (u === 'second') this.d.setSeconds(value)
    else if (u === 'millisecond') this.d.setMilliseconds(value)
    return this
  }

  add(amount: number | DurationParts, what = 'day'): this {
    if (typeof amount === 'object') {
      for (const [key, value] of Object.entries(amount)) if (value) this.add(value, key)
      return this
    }
    const u = unit(what)
    if (u === 'year') this.addMonths(amount * 12)
    else if (u === 'quarter') this.addMonths(amount * 3)
    else if (u === 'month') this.addMonths(amount)
    else if (u === 'week' || u === 'isoWeek') this.d.setDate(this.d.getDate() + amount * 7)
    else if (u === 'day') this.d.setDate(this.d.getDate() + amount)
    else if (u === 'hour') this.d.setTime(this.d.getTime() + amount * 3_600_000)
    else if (u === 'minute') this.d.setTime(this.d.getTime() + amount * 60_000)
    else if (u === 'second') this.d.setTime(this.d.getTime() + amount * 1000)
    else this.d.setTime(this.d.getTime() + amount)
    return this
  }

  subtract(amount: number | DurationParts, what = 'day'): this {
    if (typeof amount === 'object') {
      return this.add(Object.fromEntries(Object.entries(amount).map(([key, value]) => [key, -(value ?? 0)])))
    }
    return this.add(-amount, what)
  }

  /** Adds months, staying in the target month: 31 January + 1 month is the last day of February. */
  private addMonths(months: number): void {
    const day = this.d.getDate()
    this.d.setDate(1)
    this.d.setMonth(this.d.getMonth() + months)
    this.d.setDate(Math.min(day, this.daysInMonth()))
  }

  startOf(what: string): this {
    const u = unit(what)
    if (u === 'year') this.d.setMonth(0, 1)
    else if (u === 'quarter') this.d.setMonth((this.quarter() - 1) * 3, 1)
    else if (u === 'month') this.d.setDate(1)
    else if (u === 'week' || u === 'isoWeek') this.d.setDate(this.d.getDate() - this.weekday())
    if (u === 'hour') this.d.setMinutes(0, 0, 0)
    else if (u === 'minute') this.d.setSeconds(0, 0)
    else if (u === 'second') this.d.setMilliseconds(0)
    else if (u !== 'millisecond') this.d.setHours(0, 0, 0, 0)
    return this
  }

  endOf(what: string): this {
    const u = unit(what)
    return this.startOf(u).add(1, u === 'isoWeek' ? 'week' : u).add(-1, 'millisecond')
  }

  /** The difference `this - other` in whole units (or fractional with `precise`). */
  diff(other: MomentInput, what = 'millisecond', precise = false): number {
    const that = moment(other)
    const u = unit(what)
    let result: number
    if (u === 'year' || u === 'quarter' || u === 'month') {
      const months = (this.year() - that.year()) * 12 + this.month() - that.month() + (this.date() - that.date()) / 31
      result = u === 'year' ? months / 12 : u === 'quarter' ? months / 3 : months
    } else {
      const sizes: Record<string, number> = { week: 604_800_000, isoWeek: 604_800_000, day: 86_400_000, hour: 3_600_000, minute: 60_000, second: 1000, millisecond: 1 }
      // Whole days are counted by the calendar, so a daylight-saving shift does not lose one.
      const span = u === 'day' || u === 'week' || u === 'isoWeek' ? this.valueOf() - that.valueOf() - (this.d.getTimezoneOffset() - that.toDate().getTimezoneOffset()) * 60_000 : this.valueOf() - that.valueOf()
      result = span / sizes[u]
    }
    return precise ? result : Math.trunc(result)
  }

  isBefore(other: MomentInput, what = 'millisecond'): boolean {
    return this.clone().startOf(what).valueOf() < moment(other).startOf(what).valueOf()
  }
  isAfter(other: MomentInput, what = 'millisecond'): boolean {
    return this.clone().startOf(what).valueOf() > moment(other).startOf(what).valueOf()
  }
  isSameOrBefore(other: MomentInput, what = 'millisecond'): boolean {
    return !this.isAfter(other, what)
  }

  isSameOrAfter(other: MomentInput, what = 'millisecond'): boolean {
    return !this.isBefore(other, what)
  }

  /**
   * How far the moment is from now, rounded the way Moment.js rounds it: a count and
   * a unit ("3 days", "a month"). `past` says on which side of now it lies.
   */
  relative(): { count: number; unit: 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year'; past: boolean } {
    const ms = this.valueOf() - Date.now()
    const past = ms <= 0
    const seconds = Math.abs(ms) / 1000
    const minutes = seconds / 60
    const hours = minutes / 60
    const days = hours / 24
    if (seconds < 45) return { count: 1, unit: 'second', past }
    if (seconds < 90) return { count: 1, unit: 'minute', past }
    if (minutes < 45) return { count: Math.round(minutes), unit: 'minute', past }
    if (minutes < 90) return { count: 1, unit: 'hour', past }
    if (hours < 22) return { count: Math.round(hours), unit: 'hour', past }
    if (hours < 36) return { count: 1, unit: 'day', past }
    if (days < 26) return { count: Math.round(days), unit: 'day', past }
    if (days < 45) return { count: 1, unit: 'month', past }
    if (days < 320) return { count: Math.round(days / 30.4), unit: 'month', past }
    if (days < 548) return { count: 1, unit: 'year', past }
    return { count: Math.round(days / 365), unit: 'year', past }
  }

  /** "через 3 дня", "2 месяца назад"; without the suffix just "3 дня". */
  fromNow(withoutSuffix = false): string {
    if (!this.isValid()) return ''
    const { count, unit, past } = this.relative()
    const forms: Record<string, [one: string, few: string, many: string, single: string]> = {
      second: ['секунду', 'секунды', 'секунд', 'несколько секунд'],
      minute: ['минуту', 'минуты', 'минут', 'минуту'],
      hour: ['час', 'часа', 'часов', 'час'],
      day: ['день', 'дня', 'дней', 'день'],
      month: ['месяц', 'месяца', 'месяцев', 'месяц'],
      year: ['год', 'года', 'лет', 'год'],
    }
    const [one, few, many, single] = forms[unit]
    const word = count % 10 === 1 && count % 100 !== 11 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many
    const text = count === 1 ? single : `${count} ${word}`
    return withoutSuffix ? text : past ? `${text} назад` : `через ${text}`
  }

  isSame(other: MomentInput, what = 'millisecond'): boolean {
    return this.clone().startOf(what).valueOf() === moment(other).startOf(what).valueOf()
  }

  /** Formats with moment.js tokens; text in `[square brackets]` is kept as is. */
  format(format = 'YYYY-MM-DDTHH:mm:ssZ'): string {
    if (!this.isValid()) return 'Invalid date'
    const d = this.d
    const offset = -d.getTimezoneOffset()
    const zone = (separator: string) => `${offset < 0 ? '-' : '+'}${pad(Math.trunc(offset / 60))}${separator}${pad(offset % 60)}`
    // Russian puts the month in the genitive next to a day number: "9 октября", but "октябрь 2026".
    const withDay = /D[oD]?(\[[^\]]*\]|\s)+MMMM/.test(format)
    return format.replace(TOKEN, (token, literal: string | undefined) => {
      if (literal !== undefined) return literal
      switch (token) {
        case 'YYYY': return pad(d.getFullYear(), 4)
        case 'YY': return pad(d.getFullYear() % 100)
        case 'GGGG': case 'gggg': return pad(this.isoWeekYear(), 4)
        case 'MMMM': return (withDay ? MONTHS_OF : MONTHS)[d.getMonth()]
        case 'MMM': return MONTHS_SHORT[d.getMonth()]
        case 'MM': return pad(d.getMonth() + 1)
        case 'M': return String(d.getMonth() + 1)
        case 'Do': return `${d.getDate()}-го`
        case 'DDDD': return pad(this.dayOfYear(), 3)
        case 'DD': return pad(d.getDate())
        case 'D': return String(d.getDate())
        case 'dddd': return DAYS[d.getDay()]
        case 'ddd': case 'dd': return DAYS_SHORT[d.getDay()]
        case 'd': return String(d.getDay())
        case 'E': return String(this.isoWeekday())
        case 'e': return String(this.weekday())
        case 'WW': case 'ww': return pad(this.isoWeek())
        case 'W': case 'w': return String(this.isoWeek())
        case 'Q': return String(this.quarter())
        case 'HH': return pad(d.getHours())
        case 'H': return String(d.getHours())
        case 'hh': return pad(d.getHours() % 12 || 12)
        case 'h': return String(d.getHours() % 12 || 12)
        case 'mm': return pad(d.getMinutes())
        case 'm': return String(d.getMinutes())
        case 'ss': return pad(d.getSeconds())
        case 's': return String(d.getSeconds())
        case 'SSS': return pad(d.getMilliseconds(), 3)
        case 'A': return d.getHours() < 12 ? 'AM' : 'PM'
        case 'a': return d.getHours() < 12 ? 'am' : 'pm'
        case 'Z': return zone(':')
        case 'ZZ': return zone('')
        case 'X': return String(this.unix())
        default: return String(d.getTime())
      }
    })
  }
}

export type MomentInput = Moment | Date | string | number | undefined | null

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const nameIndex = (lists: string[][], text: string) => {
  for (const list of lists) {
    const index = list.indexOf(text.toLowerCase())
    if (index >= 0) return index
  }
  return -1
}

/** Reads a date written in the given format, e.g. `('2026-W41', 'GGGG-[W]WW')`. */
function parseWithFormat(text: string, format: string): Date {
  const fields: string[] = []
  let pattern = ''
  let last = 0
  // Tokens become capturing groups; everything between them must match as written.
  for (const found of format.matchAll(TOKEN)) {
    pattern += escapeRegExp(format.slice(last, found.index))
    last = found.index + found[0].length
    const token = found[0]
    if (found[1] !== undefined) {
      pattern += escapeRegExp(found[1])
      continue
    }
    fields.push(token)
    if (token === 'YYYY' || token === 'GGGG' || token === 'gggg') pattern += '(\\d{4})'
    else if (['MMMM', 'MMM', 'dddd', 'ddd', 'dd'].includes(token)) pattern += '([\\p{L}.]+)'
    else if (token === 'Do') pattern += '(\\d{1,2})(?:-го)?'
    else if (token === 'A' || token === 'a') pattern += '([AaPp][Mm])'
    else pattern += token.length === 2 || token === 'SSS' || token === 'DDDD' ? '(\\d{1,3})' : '(-?\\d+)'
  }
  pattern += escapeRegExp(format.slice(last))
  const m = new RegExp(`^\\s*${pattern}\\s*$`, 'u').exec(text)
  if (!m) return new Date(NaN)
  const now = new Date()
  const part = { year: now.getFullYear(), month: 0, day: 1, hour: 0, minute: 0, second: 0, ms: 0, week: 0, weekYear: 0, weekday: 0, pm: null as boolean | null }
  fields.forEach((token, i) => {
    const raw = m[i + 1]
    const n = Number(raw)
    if (token === 'YYYY') part.year = n
    else if (token === 'YY') part.year = 2000 + n
    else if (token === 'GGGG' || token === 'gggg') part.weekYear = n
    else if (token === 'MM' || token === 'M') part.month = n - 1
    else if (token === 'MMMM' || token === 'MMM') part.month = Math.max(0, nameIndex([MONTHS, MONTHS_OF, MONTHS_SHORT], raw.replace('.', '')))
    else if (token === 'DD' || token === 'D' || token === 'Do') part.day = n
    else if (token === 'WW' || token === 'W' || token === 'ww' || token === 'w') part.week = n
    else if (token === 'E') part.weekday = n
    else if (token === 'HH' || token === 'H' || token === 'hh' || token === 'h') part.hour = n
    else if (token === 'mm' || token === 'm') part.minute = n
    else if (token === 'ss' || token === 's') part.second = n
    else if (token === 'SSS') part.ms = n
    else if (token === 'A' || token === 'a') part.pm = raw.toLowerCase() === 'pm'
    else if (token === 'X') Object.assign(part, { unix: n })
  })
  if (part.pm !== null) part.hour = (part.hour % 12) + (part.pm ? 12 : 0)
  if (part.week) {
    // Week 1 is the week containing 4 January; from its Monday, count weeks and days.
    const year = part.weekYear || part.year
    const first = new Moment(new Date(year, 0, 4)).startOf('isoWeek')
    return first.add(part.week - 1, 'week').add((part.weekday || 1) - 1, 'day').set('hour', part.hour).set('minute', part.minute).toDate()
  }
  return new Date(part.year, part.month, part.day, part.hour, part.minute, part.second, part.ms)
}

/** Creates a date: now, from a `Date`, a timestamp, an ISO string, or a string in the given format. */
export function moment(input?: MomentInput, format?: string): Moment {
  if (input === undefined || input === null) return new Moment(new Date())
  if (input instanceof Moment) return input.clone()
  if (input instanceof Date) return new Moment(input)
  if (typeof input === 'number') return new Moment(new Date(input))
  if (format) return new Moment(parseWithFormat(input, format))
  // A bare date is a day in local time, not midnight in UTC.
  const day = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(input)
  if (day) return new Moment(new Date(+day[1], +day[2] - 1, +day[3], +(day[4] ?? 0), +(day[5] ?? 0), +(day[6] ?? 0)))
  return new Moment(new Date(input))
}
