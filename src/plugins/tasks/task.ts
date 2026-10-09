import { addDays, addMonths, daysBetween, fromIso, iso } from './dates'

export const DATE_FIELDS = {
  '📅': 'due',
  '⏳': 'scheduled',
  '🛫': 'start',
  '➕': 'created',
  '✅': 'done',
  '❌': 'cancelled',
} as const

export type DateField = (typeof DATE_FIELDS)[keyof typeof DATE_FIELDS]

/** 0 is the highest priority; 3 means none was set. */
export const PRIORITIES = [
  { emoji: '🔺', name: 'highest', label: 'Наивысший' },
  { emoji: '⏫', name: 'high', label: 'Высокий' },
  { emoji: '🔼', name: 'medium', label: 'Средний' },
  { emoji: '', name: 'none', label: 'Обычный' },
  { emoji: '🔽', name: 'low', label: 'Низкий' },
  { emoji: '⏬', name: 'lowest', label: 'Низший' },
] as const

export const NO_PRIORITY = 3

/** What a task line says, apart from where it is. Dates are `YYYY-MM-DD`. */
export interface TaskFields {
  /** The character between the brackets: ` ` to do, `x` done, `-` cancelled, `/` in progress. */
  status: string
  description: string
  priority: number
  due?: string
  scheduled?: string
  start?: string
  created?: string
  done?: string
  cancelled?: string
  /** `YYYY-MM-DD HH:mm`, or just `HH:mm` to use the task's date. */
  reminder?: string
  /** The reminder is written the way the Reminder plugin writes it, `(@2026-10-10 14:00)`, not with ⏰. */
  reminderAt?: boolean
  /** The rule after 🔁, e.g. `every week`. */
  recurrence?: string
  /** Fields of the Obsidian Tasks format that are not used here (🆔 ⛔ 🏁), kept as written. */
  extra?: string
}

export interface Task extends TaskFields {
  path: string
  /** Zero-based line in the file. */
  line: number
  /** The whole line as it is in the file. */
  raw: string
  tags: string[]
  /** The heading the task is under, if any. */
  heading?: string
}

const LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[(.)\]\s+(.*)$/
const SIGNS = '📅⏳🛫➕✅❌🔺⏫🔼🔽⏬🔁⏰🆔⛔🏁'
const DATE = new RegExp(`([${Object.keys(DATE_FIELDS).join('')}])\\uFE0F?\\s*(\\d{4}-\\d{2}-\\d{2})`, 'gu')
const PRIORITY = /[🔺⏫🔼🔽⏬]️?/u
const RECURRENCE = new RegExp(`🔁\\uFE0F?\\s*([^${SIGNS}#]+)`, 'u')
const REMINDER = /⏰️?\s*((?:\d{4}-\d{2}-\d{2}[ T])?\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2})/u
// The Reminder plugin's own way of writing a reminder: `(@2026-10-10 14:00)` or `(@2026-10-10)`.
const REMINDER_AT = /\(@(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?\)/u
const OTHER = /[🆔⛔🏁]️?\s*[\w,-]+/gu
const TAG = /(?<![\p{L}\p{N}_/#&;])#([\p{L}\p{N}_/-]+)/gu

export const isDone = (task: TaskFields) => task.status.toLowerCase() === 'x'
export const isCancelled = (task: TaskFields) => task.status === '-'
/** Still to be done: neither completed nor cancelled. */
export const isOpen = (task: TaskFields) => !isDone(task) && !isCancelled(task)

/** Reads a task from a list line in the Obsidian Tasks emoji format; `null` if the line is not a task. */
export function parseTaskLine(raw: string): (TaskFields & { tags: string[]; prefix: string }) | null {
  const m = LINE.exec(raw)
  if (!m) return null
  let text = m[3]
  const fields: TaskFields = { status: m[2], description: '', priority: NO_PRIORITY }
  for (const [, sign, date] of text.matchAll(DATE)) fields[DATE_FIELDS[sign as keyof typeof DATE_FIELDS]] = date
  const priority = PRIORITY.exec(text)?.[0].replace('️', '')
  if (priority) fields.priority = PRIORITIES.findIndex((p) => p.emoji === priority)
  fields.recurrence = RECURRENCE.exec(text)?.[1].trim() || undefined
  const at = REMINDER_AT.exec(text)
  fields.reminder = at ? `${at[1]}${at[2] ? ` ${at[2]}` : ''}` : REMINDER.exec(text)?.[1].replace('T', ' ')
  if (at) fields.reminderAt = true
  fields.extra = text.match(OTHER)?.join(' ')
  for (const pattern of [DATE, PRIORITY, RECURRENCE, REMINDER_AT, REMINDER, OTHER]) text = text.replace(pattern, ' ')
  fields.description = text.replace(/\s+/g, ' ').trim()
  return { ...fields, prefix: m[1], tags: [...fields.description.matchAll(TAG)].map((t) => t[1]) }
}

/** Writes a task as a list line; `prefix` is the indentation and list marker (`  - `). */
export function formatTaskLine(task: TaskFields, prefix = '- '): string {
  const parts = [`${prefix}[${task.status}]`, task.description]
  if (task.priority !== NO_PRIORITY) parts.push(PRIORITIES[task.priority].emoji)
  if (task.recurrence) parts.push(`🔁 ${task.recurrence}`)
  for (const [sign, field] of Object.entries(DATE_FIELDS)) if (task[field]) parts.push(`${sign} ${task[field]}`)
  if (task.reminder) parts.push(task.reminderAt && task.reminder.includes('-') ? `(@${task.reminder})` : `⏰ ${task.reminder}`)
  if (task.extra) parts.push(task.extra)
  return parts.join(' ')
}

/** When a task should alert: its ⏰ time, or its due date at the default time of day. */
export function reminderTime(task: TaskFields, defaultTime: string | null): Date | null {
  const day = task.due ?? task.scheduled
  let stamp: string | null = null
  if (task.reminder?.includes('-')) stamp = task.reminder.includes(':') ? task.reminder : `${task.reminder} ${defaultTime ?? '09:00'}`
  else if (task.reminder) stamp = `${day ?? iso(new Date())} ${task.reminder}`
  else if (task.due && defaultTime) stamp = `${task.due} ${defaultTime}`
  if (!stamp) return null
  const [date, time] = stamp.split(' ')
  const [hours, minutes] = time.split(':').map(Number)
  const result = fromIso(date)
  result.setHours(hours, minutes)
  return result
}

interface Rule {
  count: number
  unit: 'day' | 'week' | 'month' | 'year' | 'weekday'
  /** Count from the day of completion rather than from the planned date. */
  whenDone: boolean
}

const UNITS: [RegExp, Rule['unit']][] = [
  [/^(weekdays?|будни|будний день)$/, 'weekday'],
  [/^(days?|день|дня|дней)$/, 'day'],
  [/^(weeks?|неделю|недели|недель)$/, 'week'],
  [/^(months?|месяц|месяца|месяцев)$/, 'month'],
  [/^(years?|год|года|лет)$/, 'year'],
]

/** `every 2 weeks`, `every month when done`, `каждые 3 дня`, `каждый год после выполнения`. */
export function parseRecurrence(text: string): Rule | null {
  const m = /^(?:every|кажд[а-я]+)\s+(?:(\d+)\s+)?(.+?)(\s+(?:when done|после выполнения))?$/i.exec(text.trim())
  if (!m) return null
  const unit = UNITS.find(([pattern]) => pattern.test(m[2].toLowerCase()))?.[1]
  return unit ? { count: Number(m[1] ?? 1), unit, whenDone: !!m[3] } : null
}

function advance(date: string, rule: Rule): string {
  if (rule.unit === 'day') return addDays(date, rule.count)
  if (rule.unit === 'week') return addDays(date, 7 * rule.count)
  if (rule.unit === 'month') return addMonths(date, rule.count)
  if (rule.unit === 'year') return addMonths(date, 12 * rule.count)
  let next = addDays(date, 1)
  while ([0, 6].includes(fromIso(next).getDay())) next = addDays(next, 1)
  return next
}

/** The next occurrence of a repeating task that is being completed on `day`; `null` if it does not repeat. */
export function nextOccurrence(task: TaskFields, day: string): TaskFields | null {
  const rule = task.recurrence ? parseRecurrence(task.recurrence) : null
  if (!rule) return null
  const anchor = task.due ?? task.scheduled ?? task.start
  const next: TaskFields = { ...task, status: ' ', done: undefined, cancelled: undefined }
  if (!anchor) {
    next.due = advance(day, rule)
    return next
  }
  // All dates of the task move together, keeping their distance from each other.
  const shift = daysBetween(anchor, advance(rule.whenDone ? day : anchor, rule))
  for (const field of ['due', 'scheduled', 'start'] as const) if (task[field]) next[field] = addDays(task[field], shift)
  if (task.reminder?.includes('-')) {
    const [date, time] = task.reminder.split(' ')
    next.reminder = [addDays(date, shift), time].filter(Boolean).join(' ')
  }
  return next
}

/**
 * Ticks or unticks a task line. Completing stamps the date and, for a
 * repeating task, puts its next occurrence on the line above.
 */
export function toggleTaskLine(raw: string, day: string): string[] {
  const task = parseTaskLine(raw)
  if (!task) return [raw]
  const { prefix } = task
  if (isDone(task)) return [formatTaskLine({ ...task, status: ' ', done: undefined }, prefix)]
  const next = nextOccurrence(task, day)
  const done = formatTaskLine({ ...task, status: 'x', done: day, cancelled: undefined }, prefix)
  return next ? [formatTaskLine(next, prefix), done] : [done]
}
