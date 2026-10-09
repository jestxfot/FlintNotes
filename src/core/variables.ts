import { moment, type Moment } from './moment'

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const UNITS: Record<string, string> = { y: 'year', Q: 'quarter', M: 'month', w: 'week', d: 'day', h: 'hour', m: 'minute', s: 'second' }
const VARIABLE = new RegExp(`\\{\\{\\s*(title|date|time|yesterday|tomorrow|${DAYS.join('|')})\\s*(?:([+-]\\s*\\d+)\\s*([yQMwdhms]))?\\s*(?::([^}]+))?\\}\\}`, 'gi')

/**
 * Replaces the `{{...}}` variables of Obsidian's own templates and of Periodic Notes:
 * `{{title}}`, `{{date}}`, `{{time}}`, `{{date:YYYY-MM}}`, `{{date-1d:YYYY-MM-DD}}`,
 * `{{yesterday}}`, `{{tomorrow}}`, `{{monday:YYYY-MM-DD}}` ... `{{sunday:...}}`.
 * `date` is the day the note is for (a daily note's own day), now by default.
 */
export function expandVariables(template: string, title: string, date: Moment = moment()): string {
  return template.replace(VARIABLE, (_, name: string, shift?: string, unit?: string, format?: string) => {
    const key = name.toLowerCase()
    if (key === 'title') return title
    let day = date.clone()
    if (key === 'yesterday') day.subtract(1, 'day')
    else if (key === 'tomorrow') day.add(1, 'day')
    // A weekday name is that day of the note's week.
    else if (DAYS.includes(key)) day = day.startOf('isoWeek').add((DAYS.indexOf(key) + 6) % 7, 'day')
    else if (key === 'time' && !format) format = 'HH:mm'
    // The clock comes from now even when the note is for another day.
    if (key === 'time') {
      const now = moment()
      day.set('hour', now.hour()).set('minute', now.minute()).set('second', now.second())
    }
    if (shift && unit) day.add(Number(shift.replace(/\s/g, '')), UNITS[unit])
    return day.format(format?.trim() || 'YYYY-MM-DD')
  })
}
