// When a reminder is due: the one reading of the notes that the page (its alert) and the server (a message to the phone while
// the page is closed) share, so both mean the same by "due". Pure: no page, no vault, no clock but the one it is given.

import { basename } from '../../core/path'
import { fromIso } from './dates'
import { isOpen, parsePlainReminder, parseTaskLine, reminderTime, type Task } from './task'

const MINUTE = 60_000

export interface Due {
  key: string
  task: Task
  at: Date
  /** It comes from a day's plan (`17:00 - 17:10 ...` in a daily note), not from a reminder written on the task. */
  planned?: boolean
  /** The user has closed it: it will not alert again, and lists show it only on request. */
  closed?: boolean
}

/** The settings of the tasks plugin that decide what reminds and when (`tasks` in `.flint/settings.json`). */
export interface ReminderSettings {
  remindDue: boolean
  defaultTime: string
  planner: boolean
  plannerOverdueDays: number
  remindPlain: boolean
  maxAgeDays: number
  leadMinutes: number
  muteUntil: number
  quietFrom: string
  quietTo: string
  acknowledged: Record<string, number>
  snoozed: Record<string, number>
}

export const REMINDER_DEFAULTS: ReminderSettings = {
  remindDue: true,
  defaultTime: '09:00',
  planner: true,
  plannerOverdueDays: 1,
  remindPlain: true,
  maxAgeDays: 7,
  leadMinutes: 0,
  muteUntil: 0,
  quietFrom: '',
  quietTo: '',
  acknowledged: {},
  snoozed: {},
}

/** The settings as stored (anything may be missing or of the wrong kind) filled in with the defaults. */
export function reminderSettings(stored: unknown): ReminderSettings {
  const given = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const result = { ...REMINDER_DEFAULTS }
  for (const key of Object.keys(REMINDER_DEFAULTS) as (keyof ReminderSettings)[]) {
    const value = given[key]
    const kind = typeof REMINDER_DEFAULTS[key]
    if (typeof value === kind && value !== null) (result as Record<string, unknown>)[key] = value
  }
  return result
}

/**
 * Finds the tasks of one note. Lines inside code blocks are not tasks. Ordinary
 * lines that carry a reminder are collected into `plain`, when a list is given.
 */
export function parseTasks(path: string, text: string, headings: { text: string; line: number }[], plain?: Task[]): Task[] {
  const tasks: Task[] = []
  let fence: string | null = null
  let heading = 0
  text.split(/\r?\n/).forEach((raw, line) => {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw)
    if (fence) {
      if (fenceMatch && fenceMatch[1].startsWith(fence) && !fenceMatch[2].trim()) fence = null
      return
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      return
    }
    const parsed = parseTaskLine(raw)
    while (heading < headings.length && headings[heading].line < line) heading++
    if (!parsed) {
      const reminder = plain && raw.includes('(@') ? parsePlainReminder(raw) : null
      if (reminder) plain!.push({ ...reminder, plain: true, tags: [], path, line, raw, heading: headings[heading - 1]?.text })
      return
    }
    const { prefix: _, ...fields } = parsed
    tasks.push({ ...fields, path, line, raw, heading: headings[heading - 1]?.text })
  })
  return tasks
}

const PLANNED = /^(\d{1,2}):(\d{2})(?:\s*[-–—]\s*\d{1,2}:\d{2})?(?=\s|$)/
/**
 * The moment a line of a day's plan is for, in the form the Day Planner plugin has:
 * a task of a daily note that begins with a time, `- [ ] 17:00 - 17:10 Vitamin D`.
 * The day is the note's (its name is a date), or the task's own date.
 */
export function plannedTime(task: Task): Date | null {
  const time = PLANNED.exec(task.description)
  if (!time) return null
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(basename(task.path))?.[1] ?? task.scheduled ?? task.due
  if (!day) return null
  const at = fromIso(day)
  at.setHours(Number(time[1]), Number(time[2]), 0, 0)
  return Number.isNaN(at.getTime()) ? null : at
}

/** Every open task (of those that may remind) that has a moment to remind at, soonest first, with whether it was closed. */
export function timedReminders(tasks: Task[], settings: ReminderSettings, now: number): Due[] {
  const fallback = settings.remindDue && /^\d{1,2}:\d{2}$/.test(settings.defaultTime) ? settings.defaultTime : null
  // A line of a past day's plan that was never ticked is not a debt for ever.
  const plannerFrom = now - Math.max(0, settings.plannerOverdueDays) * 24 * 60 * MINUTE
  const result: Due[] = []
  for (const task of tasks) {
    if (!isOpen(task)) continue
    const planned = settings.planner && !task.reminder ? plannedTime(task) : null
    if (planned && planned.getTime() < plannerFrom) continue
    const at = planned ?? reminderTime(task, fallback)
    if (!at) continue
    const key = `${task.path}|${task.description}|${at.getTime()}`
    result.push({ key, task, at, planned: !!planned, closed: !!settings.acknowledged[key] })
  }
  return result.sort((a, b) => a.at.getTime() - b.at.getTime())
}

/** When the alert of a reminder comes: that much before its moment ("remind N minutes before"), or when it was postponed to. */
export function alertTime(due: Due, settings: ReminderSettings): number {
  const snoozed = settings.snoozed[due.key] ?? 0
  return Math.max(due.at.getTime() - Math.max(0, settings.leadMinutes) * MINUTE, snoozed)
}

/** Reminders whose time has come and that were neither handled nor postponed. */
export function dueReminders(timed: Due[], settings: ReminderSettings, now: number): Due[] {
  const oldest = now - settings.maxAgeDays * 24 * 60 * MINUTE
  return timed.filter((due) => !due.closed && alertTime(due, settings) <= now && due.at.getTime() >= oldest)
}

/** Whether alerts are held back at `date`: "do not disturb" was asked for, or it is the quiet time of day. */
export function isQuiet(settings: ReminderSettings, date: Date): boolean {
  if (settings.muteUntil > date.getTime()) return true
  const { quietFrom: from, quietTo: to } = settings
  if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to) || from === to) return false
  const minutes = (text: string) => Number(text.split(':')[0]) * 60 + Number(text.split(':')[1])
  const now = date.getHours() * 60 + date.getMinutes()
  // The quiet time may run over midnight: 23:00 to 07:00.
  return minutes(from) < minutes(to) ? now >= minutes(from) && now < minutes(to) : now >= minutes(from) || now < minutes(to)
}
