import { moment, type Moment } from '../../api'

/**
 * What a date property means, and so what is worth saying about it beside its field:
 * `yearly` comes back every year (a birthday: the age now, and how soon the next one),
 * `deadline` is a date to be done by (how much is left, or how late it is), `plain` is
 * any other date (how long ago, or how soon), `none` says nothing. `auto` goes by the name.
 */
export type DateSense = 'auto' | 'yearly' | 'deadline' | 'plain' | 'none'

export const SENSES: { sense: DateSense; label: string }[] = [
  { sense: 'auto', label: 'По имени свойства' },
  { sense: 'yearly', label: 'Годовщина: возраст и сколько до следующей' },
  { sense: 'deadline', label: 'Срок: сколько осталось или просрочено' },
  { sense: 'plain', label: 'Дата: сколько прошло или осталось' },
  { sense: 'none', label: 'Без подсказки' },
]

/** Names of dates that come back every year. */
const YEARLY = /(birth|bday|born|anniversary|wedding|рожд|^д\.?\s?р\.?$|годовщин|свадьб|юбиле|именин|знакомств)/i
/** Names of dates to be done by. */
const DEADLINE = /(deadline|due|until|expire|срок|дедлайн|^до$|истека|оплатить|сдать)/i

/** The meaning a date property has: the one chosen for its name, or the one its name suggests. */
export function senseOf(key: string, chosen: DateSense | undefined): Exclude<DateSense, 'auto'> {
  if (chosen && chosen !== 'auto') return chosen
  return YEARLY.test(key) ? 'yearly' : DEADLINE.test(key) ? 'deadline' : 'plain'
}

/** A number with its word in the right form: 1 день, 2 дня, 5 дней. */
export function count(amount: number, forms: [string, string, string]): string {
  const rule = new Intl.PluralRules('ru').select(Math.abs(amount))
  return `${amount} ${rule === 'one' ? forms[0] : rule === 'few' ? forms[1] : forms[2]}`
}

const DAYS: [string, string, string] = ['день', 'дня', 'дней']
const YEARS: [string, string, string] = ['год', 'года', 'лет']
const MONTHS: [string, string, string] = ['месяц', 'месяца', 'месяцев']

const DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?$/

/** How long a stretch of days is, said the way it is easiest to grasp: days up to three months, then months, then years and months. */
function span(days: number, from: Moment, to: Moment): string {
  if (days < 100) return count(days, DAYS)
  const months = Math.abs(to.diff(from, 'months'))
  if (months < 12) return count(months, MONTHS)
  const years = Math.trunc(months / 12)
  return months % 12 ? `${count(years, YEARS)} и ${count(months % 12, MONTHS)}` : count(years, YEARS)
}

/** "через 3 дня", "3 дня назад", or a word for the nearest days. */
function relative(date: Moment, today: Moment): string {
  const days = date.diff(today, 'days')
  if (days === 0) return 'сегодня'
  if (days === 1) return 'завтра'
  if (days === 2) return 'послезавтра'
  if (days === -1) return 'вчера'
  if (days === -2) return 'позавчера'
  return days > 0 ? `через ${span(days, today, date)}` : `${span(-days, date, today)} назад`
}

export interface DateHint {
  text: string
  /** `today` — it is today; `soon` — within a week; `late` — a date to be done by has passed. */
  tone?: 'today' | 'soon' | 'late'
  /** The exact count of days, for the hint's tooltip. */
  title: string
}

/** What is worth saying about a date property's value today; nothing for what is not a date. */
export function dateHint(value: unknown, sense: Exclude<DateSense, 'auto'>, now: Moment = moment()): DateHint | null {
  if (sense === 'none' || typeof value !== 'string') return null
  if (sense === 'yearly') {
    const round = yearlyRound(value, now)
    if (round) return round.hint
  }
  const match = DATE.exec(value.trim())
  if (!match) return null
  const date = moment(match[1], 'YYYY-MM-DD')
  // A day that does not exist (2026-02-30) is no date.
  if (!date.isValid() || date.format('YYYY-MM-DD') !== match[1]) return null
  const today = now.clone().startOf('day')
  const days = date.diff(today, 'days')
  const exact = days === 0 ? 'сегодня' : days > 0 ? `через ${count(days, DAYS)}` : `${count(-days, DAYS)} назад`
  const title = `${date.format('dddd, D MMMM YYYY')} — ${exact}`

  // A time of day matters only for today and the days next to it.
  const at = match[2] ? moment(`${match[1]} ${match[2].slice(0, 5)}`, 'YYYY-MM-DD HH:mm') : null
  const hours = at?.isValid() ? at.diff(now, 'minutes') : null
  const soonTime = hours !== null && Math.abs(hours) < 24 * 60 ? (hours >= 0 ? `через ${clock(hours)}` : `${clock(-hours)} назад`) : null

  if (sense === 'deadline') {
    if (hours !== null && hours < 0 && days >= 0) return { text: `просрочено на ${clock(-hours)}`, tone: 'late', title }
    if (days < 0) return { text: `просрочено на ${span(-days, date, today)}`, tone: 'late', title }
    if (days === 0) return { text: soonTime ? `срок через ${clock(hours!)}` : 'срок сегодня', tone: 'today', title }
    return { text: `осталось ${span(days, today, date)}`, tone: days <= 3 ? 'soon' : undefined, title }
  }
  return { text: soonTime ?? relative(date, today), tone: days === 0 ? 'today' : undefined, title }
}

const MONTH_NAMES = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр']

/** A date that comes back every year, as written: month and day, and the year if it is known. */
interface YearlyDate {
  month: number
  day: number
  /** The year of birth (or of the first time); `undefined` when only the day is written, or a placeholder year stands in. */
  year?: number
}

/**
 * Reads a date that comes back every year: `1990-10-11`, `11 октября`, `10-11` or `--10-11`. A year before 1900
 * (`1000-10-11` is how an unknown year is often written, to keep the date a date) is no year.
 */
function yearlyDate(value: string): YearlyDate | null {
  const text = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text)
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day, year: year >= 1900 ? year : undefined } : null
  }
  const short = /^-{0,2}(\d{1,2})-(\d{1,2})$/.exec(text)
  if (short) return Number(short[1]) >= 1 && Number(short[1]) <= 12 && Number(short[2]) >= 1 && Number(short[2]) <= 31 ? { month: Number(short[1]), day: Number(short[2]) } : null
  const words = /^(\d{1,2})\s+([а-яё]+)\.?(?:\s+(\d{4}))?$/i.exec(text)
  if (words) {
    const month = MONTH_NAMES.findIndex((name) => words[2].toLowerCase().startsWith(name)) + 1
    const year = words[3] ? Number(words[3]) : undefined
    return month && Number(words[1]) >= 1 && Number(words[1]) <= 31 ? { month, day: Number(words[1]), year: year && year >= 1900 ? year : undefined } : null
  }
  return null
}

/** Where a date that comes back every year stands today: when it comes next, and how old it makes whoever it is of. */
function yearlyRound(value: string, now: Moment): { hint: DateHint; badge: { text: string; title: string; tone?: string } } | null {
  const parts = yearlyDate(value)
  if (!parts) return null
  const today = now.clone().startOf('day')
  // 29 February falls on the 28th in the years that have none.
  const on = (year: number) => {
    const first = moment(`${year}-${String(parts.month).padStart(2, '0')}-01`, 'YYYY-MM-DD')
    const day = first.clone().add(parts.day - 1, 'days')
    return day.month() === first.month() ? day : first.clone().endOf('month').startOf('day')
  }
  let next = on(today.year())
  if (next.isBefore(today)) next = on(today.year() + 1)
  const left = next.diff(today, 'days')
  const turning = parts.year === undefined ? undefined : next.year() - parts.year
  // A date still to come (a birth date in the future) has no age yet.
  if (turning !== undefined && turning < 0) return null
  const age = turning === undefined ? undefined : left === 0 ? turning : turning - 1
  const when = left === 0 ? 'сегодня' : left === 1 ? 'завтра' : left === 2 ? 'послезавтра' : `через ${count(left, DAYS)}`
  const day = next.format('D MMMM, dddd')
  const tone = left === 0 ? 'today' : left <= 7 ? 'soon' : undefined
  const badgeTone = left === 0 ? 'today' : left <= 14 ? 'soon' : undefined
  const knownAge = parts.year === undefined ? '' : `${count(age!, YEARS)}; `
  const hint: DateHint = {
    text: turning === undefined ? when : left === 0 ? `сегодня ${count(turning, YEARS)}` : `${count(age!, YEARS)} · ${when} исполнится ${count(turning, YEARS)}`,
    tone,
    title: `${knownAge}${left === 0 ? 'сегодня' : `${day} — ${when}`}${turning === undefined ? '' : left === 0 ? ` исполнилось ${count(turning, YEARS)}` : `, исполнится ${count(turning, YEARS)}`}`,
  }
  // Always with the days left: a birthday that is far off is quiet, one within two weeks stands out.
  const badge = {
    text: left === 0 ? `🎂 сегодня${turning === undefined ? '' : ` ${count(turning, YEARS)}`}` : `🎂 ${when}`,
    title: hint.title,
    tone: badgeTone,
  }
  return { hint, badge }
}

/**
 * The mark that links to a note with a birthday (or another date that comes back every year) get:
 * a cake, which stands out with the days left in the last two weeks before it, and on the day itself.
 */
export function yearlyBadge(frontmatter: Record<string, unknown> | null | undefined, chosen: (key: string) => DateSense | undefined, now: Moment = moment()): { text: string; title: string; tone?: string } | null {
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (typeof value !== 'string' || senseOf(key, chosen(key)) !== 'yearly') continue
    const round = yearlyRound(value, now)
    if (round) return { ...round.badge, title: `${key}: ${round.badge.title}` }
  }
  return null
}

/** Minutes as hours and minutes: "3 ч 20 мин", "45 мин". */
function clock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${Math.max(1, m)} мин`
}
