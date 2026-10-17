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
  const match = DATE.exec(value.trim())
  if (!match) return null
  const date = moment(match[1], 'YYYY-MM-DD')
  // A day that does not exist (2026-02-30) is no date.
  if (!date.isValid() || date.format('YYYY-MM-DD') !== match[1]) return null
  const today = now.clone().startOf('day')
  const days = date.diff(today, 'days')
  const exact = days === 0 ? 'сегодня' : days > 0 ? `через ${count(days, DAYS)}` : `${count(-days, DAYS)} назад`
  const title = `${date.format('dddd, D MMMM YYYY')} — ${exact}`

  if (sense === 'yearly' && days < 0) {
    const { age, turning, next, left } = comingRound(date, today)
    if (left === 0) return { text: `сегодня ${count(turning, YEARS)}`, tone: 'today', title: `${title}; сегодня ровно ${count(turning, YEARS)}` }
    const when = left === 1 ? 'завтра' : left === 2 ? 'послезавтра' : `через ${count(left, DAYS)}`
    return {
      text: `${count(age, YEARS)} · ${when} исполнится ${count(turning, YEARS)}`,
      tone: left <= 7 ? 'soon' : undefined,
      title: `${title}; следующая ${next.format('D MMMM YYYY, dddd')}: ${count(turning, YEARS)}`,
    }
  }

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

/**
 * A date that comes back every year, seen from `today`: how many years have passed, when it comes
 * round next (this year's, or next year's if this year's has passed; 29 February falls on the 28th),
 * how many years it will be then, and in how many days.
 */
function comingRound(date: Moment, today: Moment): { age: number; turning: number; next: Moment; left: number } {
  const age = today.diff(date, 'years')
  let turning = age
  let next = date.clone().add(turning, 'years')
  if (next.isBefore(today)) next = date.clone().add(++turning, 'years')
  return { age, turning, next, left: next.diff(today, 'days') }
}

/**
 * The mark that links to a note with a birthday (or another date that comes back every year) get:
 * a cake, which stands out with the days left in the last two weeks before it, and on the day itself.
 */
export function yearlyBadge(frontmatter: Record<string, unknown> | null | undefined, chosen: (key: string) => DateSense | undefined, now: Moment = moment()): { text: string; title: string; tone?: string } | null {
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (typeof value !== 'string' || senseOf(key, chosen(key)) !== 'yearly') continue
    const match = DATE.exec(value.trim())
    const date = match ? moment(match[1], 'YYYY-MM-DD') : null
    if (!match || !date?.isValid() || date.format('YYYY-MM-DD') !== match[1]) continue
    const today = now.clone().startOf('day')
    if (!date.isBefore(today)) continue
    const { age, turning, next, left } = comingRound(date, today)
    const title = `${key}: ${date.format('D MMMM YYYY')} — ${count(age, YEARS)}; ${left === 0 ? `сегодня ${count(turning, YEARS)}` : `${next.format('D MMMM, dddd')}, через ${count(left, DAYS)}, исполнится ${count(turning, YEARS)}`}`
    if (left === 0) return { text: `🎂 сегодня ${count(turning, YEARS)}`, title, tone: 'today' }
    if (left <= 14) return { text: `🎂 ${left === 1 ? 'завтра' : left === 2 ? 'послезавтра' : `через ${count(left, DAYS)}`}`, title, tone: 'soon' }
    return { text: '🎂', title }
  }
  return null
}

/** Minutes as hours and minutes: "3 ч 20 мин", "45 мин". */
function clock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${Math.max(1, m)} мин`
}
