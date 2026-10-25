/**
 * The app lives in Moscow time (UTC+3, no daylight saving since 2014), whatever zone the computer is set to.
 * Importing this file makes `Date` and `Intl.DateTimeFormat` behave as in a browser running in Moscow:
 * `getHours()`, `setDate()`, `new Date(2026, 9, 31, 14)`, `new Date('2026-10-31T14:00')`, `toLocaleString()`
 * and `getTimezoneOffset()` all work with Moscow wall-clock time. The moment in time itself (`Date.now()`,
 * `getTime()`, `toISOString()`, strings with `Z` or an offset) is the real one.
 *
 * One fixed offset, not the zone's history: dates before 2014 round-trip exactly (a wall-clock time set
 * and read back is the same), which matters more here than what the clocks showed in 2010.
 */

export const APP_TIME_ZONE = 'Europe/Moscow'
const OFFSET_MINUTES = 180
const OFFSET = OFFSET_MINUTES * 60_000
/** `Etc/GMT-3` is UTC+3 all year in every browser, unlike `Europe/Moscow`, which had summer time before 2014. */
const INTL_ZONE = 'Etc/GMT-3'

const Native = Date
const nativeParse = Native.parse
const proto = Native.prototype
// Kept before `install` replaces it: what the computer's own zone says about a moment.
const nativeOffset = proto.getTimezoneOffset

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number, length = 2) => String(n).padStart(length, '0')

/** A Date whose UTC fields are the Moscow wall-clock fields of `time`. */
const wall = (time: number) => new Native(time + OFFSET)

/** `YYYY`, `YYYY-MM` and `YYYY-MM-DD` are UTC by the standard; every other form without a zone is local time. */
const DATE_ONLY = /^[+-]?\d{4,6}(-\d{2}(-\d{2})?)?$/
/** A zone at the end: `Z`, `+03:00`, `-0500`, `GMT`, `UTC`, `GMT+0300 (Moscow Standard Time)`. */
const HAS_ZONE = /(?:\d|\s)(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC|UT)(?:\s*\([^)]*\))?\s*$|\b(?:GMT|UTC)[+-]\d{2}:?\d{2}\b/i

function parse(text: string): number {
  const time = nativeParse(text)
  const trimmed = text.trim()
  if (Number.isNaN(time) || DATE_ONLY.test(trimmed) || HAS_ZONE.test(trimmed)) return time
  // The engine read it in the computer's zone, `time = wall + offset west of UTC`; read the same wall clock in Moscow instead.
  return time - nativeOffset.call(new Native(time)) * 60_000 - OFFSET
}

/** Local fields (year, month, …) as the engine takes them, turned into a point in time in Moscow. */
function fromFields(args: number[]): number {
  const [year, month = 0, day = 1, hours = 0, minutes = 0, seconds = 0, ms = 0] = args.map(Number)
  const y = Number.isNaN(year) ? NaN : year >= 0 && year <= 99 ? 1900 + Math.trunc(year) : year
  return Native.UTC(y, month, day, hours, minutes, seconds, ms) - OFFSET
}

function toPrimitive(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || value instanceof Native) return value
  const custom = (value as { [Symbol.toPrimitive]?: (hint: string) => unknown })[Symbol.toPrimitive]
  return custom ? custom.call(value, 'default') : (value as { valueOf(): unknown }).valueOf()
}

function MoscowDate(this: unknown, ...args: unknown[]): unknown {
  if (!new.target) return new Native().toString()
  let time: number
  if (args.length === 0) time = Native.now()
  else if (args.length === 1) {
    const value = toPrimitive(args[0])
    time = value instanceof Native ? value.getTime() : typeof value === 'string' ? parse(value) : Number(value)
  } else time = fromFields(args as number[])
  return Reflect.construct(Native, [time], new.target)
}

/** Replaces `name` on the prototype with `make(original)`, keeping the native name and length. */
function patch<K extends keyof Date>(name: K, make: (original: Date[K] & ((...args: never[]) => unknown)) => (this: Date, ...args: never[]) => unknown) {
  const original = proto[name] as Date[K] & ((...args: never[]) => unknown)
  const replacement = make(original)
  Object.defineProperty(replacement, 'name', { value: name })
  Object.defineProperty(proto, name, { value: replacement, writable: true, configurable: true })
}

function install() {
  Object.defineProperty(MoscowDate, 'prototype', { value: proto, writable: false })
  Object.setPrototypeOf(MoscowDate, Native)
  Object.defineProperty(MoscowDate, 'name', { value: 'Date' })
  Object.defineProperty(MoscowDate, 'length', { value: 7 })
  ;(MoscowDate as unknown as DateConstructor).parse = parse
  Object.defineProperty(proto, 'constructor', { value: MoscowDate, writable: true, configurable: true })
  globalThis.Date = MoscowDate as unknown as DateConstructor

  // Getters: the UTC field of the same moment shifted into Moscow.
  const getters = {
    getFullYear: 'getUTCFullYear', getMonth: 'getUTCMonth', getDate: 'getUTCDate', getDay: 'getUTCDay',
    getHours: 'getUTCHours', getMinutes: 'getUTCMinutes', getSeconds: 'getUTCSeconds',
  } as const
  for (const [name, utc] of Object.entries(getters) as [keyof typeof getters, (typeof getters)[keyof typeof getters]][]) {
    patch(name, () => function (this: Date) { return wall(this.getTime())[utc]() })
  }
  patch('getTimezoneOffset', () => function (this: Date) { return Number.isNaN(this.getTime()) ? NaN : -OFFSET_MINUTES })

  // Setters: change the field on the shifted copy, move the result back.
  const setters = {
    setFullYear: 'setUTCFullYear', setMonth: 'setUTCMonth', setDate: 'setUTCDate',
    setHours: 'setUTCHours', setMinutes: 'setUTCMinutes', setSeconds: 'setUTCSeconds',
  } as const
  for (const [name, utc] of Object.entries(setters) as [keyof typeof setters, (typeof setters)[keyof typeof setters]][]) {
    patch(name, () => function (this: Date, ...args: number[]) {
      const time = this.getTime()
      // Setting the year of an invalid date starts from the epoch, as the standard says; the other fields stay invalid.
      const copy = Number.isNaN(time) && name === 'setFullYear' ? new Native(0) : wall(time)
      ;(copy[utc] as (...values: number[]) => number)(...args)
      return this.setTime(copy.getTime() - OFFSET)
    })
  }

  // Strings.
  const zoneName = '(Москва, стандартное время)'
  const parts = (date: Date) => {
    const w = wall(date.getTime())
    return {
      day: `${DAYS[w.getUTCDay()]} ${MONTHS[w.getUTCMonth()]} ${pad(w.getUTCDate())} ${pad(w.getUTCFullYear(), 4)}`,
      time: `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}:${pad(w.getUTCSeconds())} GMT+0300 ${zoneName}`,
    }
  }
  const valid = (date: Date) => !Number.isNaN(date.getTime())
  patch('toString', () => function (this: Date) { return valid(this) ? `${parts(this).day} ${parts(this).time}` : 'Invalid Date' })
  patch('toDateString', () => function (this: Date) { return valid(this) ? parts(this).day : 'Invalid Date' })
  patch('toTimeString', () => function (this: Date) { return valid(this) ? parts(this).time : 'Invalid Date' })
  for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const) {
    patch(name, (original) => function (this: Date, locales?: never, options?: Intl.DateTimeFormatOptions) {
      return (original as (l?: unknown, o?: unknown) => string).call(this, locales, { ...options, timeZone: options?.timeZone ?? INTL_ZONE })
    })
  }

  // `Intl.DateTimeFormat` without a `timeZone` formats in Moscow time too.
  const NativeFormat = Intl.DateTimeFormat
  const withZone = (args: unknown[]) => {
    const options = args[1] as Intl.DateTimeFormatOptions | undefined
    return [args[0], { ...options, timeZone: options?.timeZone ?? INTL_ZONE }]
  }
  Intl.DateTimeFormat = new Proxy(NativeFormat, {
    apply: (target, _this, args) => target(...(withZone(args) as [])),
    construct: (target, args) => new target(...(withZone(args) as [])),
  })
}

/** True where `Date` can be replaced; false in an environment that has frozen it (nothing to do there). */
export const timeZoneInstalled = (() => {
  try {
    install()
    return true
  } catch {
    return false
  }
})()
