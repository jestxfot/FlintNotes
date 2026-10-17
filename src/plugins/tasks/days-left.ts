import { plural } from '../../api'
import { daysBetween, today } from './dates'

/** How long is left until a day (or how late it is): what a task or a reminder says beside its text. */
export interface DaysLeft {
  label: string
  /** `overdue` once the day has passed, `soon` today and tomorrow, `` otherwise. */
  tone: 'overdue' | 'soon' | ''
  title: string
}

/** The caption for a task or a reminder falling on `target` (`YYYY-MM-DD`), counted from `from` (today unless said). */
export function daysLeft(target: string, what = 'Срок', from = today()): DaysLeft {
  const days = daysBetween(from, target)
  const word: [string, string, string] = ['день', 'дня', 'дней']
  return {
    label: days === 0 ? 'сегодня' : days === 1 ? 'завтра' : days > 0 ? `осталось ${plural(days, word)}` : `просрочено на ${plural(-days, word)}`,
    tone: days < 0 ? 'overdue' : days <= 1 ? 'soon' : '',
    title: `${what}: ${target}`,
  }
}

/** The caption as a chip, the same everywhere a task or a reminder is drawn. */
export function daysChip(target: string, what?: string, from?: string): HTMLElement {
  const left = daysLeft(target, what, from)
  const chip = document.createElement('span')
  chip.className = `task-chip days${left.tone ? ` ${left.tone}` : ''}`
  chip.textContent = left.label
  chip.title = left.title
  return chip
}
