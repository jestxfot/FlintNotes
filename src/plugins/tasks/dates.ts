/** Dates of tasks are plain `YYYY-MM-DD` strings: they compare and sort as text. */

const pad = (n: number) => String(n).padStart(2, '0')

export const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const fromIso = (text: string) => {
  const [y, m, d] = text.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const today = () => iso(new Date())

export function addDays(date: string, days: number): string {
  const d = fromIso(date)
  d.setDate(d.getDate() + days)
  return iso(d)
}

/** Adds months, staying in the target month: 31 January + 1 month is the last day of February. */
export function addMonths(date: string, months: number): string {
  const d = fromIso(date)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return iso(d)
}

export const daysBetween = (from: string, to: string) =>
  Math.round((fromIso(to).getTime() - fromIso(from).getTime()) / 86_400_000)

const WORDS: Record<string, number> = { today: 0, tomorrow: 1, yesterday: -1, сегодня: 0, завтра: 1, вчера: -1 }
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7 }

/**
 * A date or period written in words: `today`, `2026-10-16`, `in 3 days`,
 * `2 weeks ago`, `next week`, `this month`. Returns its first and last day.
 */
export function parseDateSpec(text: string, base = today()): [from: string, to: string] | null {
  const spec = text.trim().toLowerCase()
  if (Object.hasOwn(WORDS, spec)) {
    const day = addDays(base, WORDS[spec])
    return [day, day]
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(spec)) return [spec, spec]

  const offset = /^(?:in (\d+) (day|week|month)s?|(\d+) (day|week|month)s? ago)$/.exec(spec)
  if (offset) {
    const count = Number(offset[1] ?? offset[3]) * (offset[1] ? 1 : -1)
    const unit = offset[2] ?? offset[4]
    const day = unit === 'month' ? addMonths(base, count) : addDays(base, count * UNIT_DAYS[unit])
    return [day, day]
  }

  const period = /^(this|next|last) (week|month|year)$/.exec(spec)
  if (period) {
    const shift = period[1] === 'next' ? 1 : period[1] === 'last' ? -1 : 0
    const d = fromIso(base)
    if (period[2] === 'week') {
      // Weeks run Monday to Sunday.
      const monday = addDays(base, -((d.getDay() + 6) % 7) + shift * 7)
      return [monday, addDays(monday, 6)]
    }
    if (period[2] === 'month') {
      const first = new Date(d.getFullYear(), d.getMonth() + shift, 1)
      return [iso(first), iso(new Date(first.getFullYear(), first.getMonth() + 1, 0))]
    }
    const year = d.getFullYear() + shift
    return [`${year}-01-01`, `${year}-12-31`]
  }
  return null
}

/** `2026-10-16` -> `16 окт`, with the year when it is not the current one. */
export function shortDate(date: string): string {
  const d = fromIso(date)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })
}
