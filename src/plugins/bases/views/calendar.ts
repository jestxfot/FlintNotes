import { expr, moment } from '../../../api'
import { h } from '../dom'
import type { Row } from '../engine'
import type { ViewContext, ViewRenderer } from './shared'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
/** The month each calendar is turned to, kept while the app runs: by the base's note and the view's name. */
const months = new Map<string, string>()

/** The day a row stands on: its date property, as a date or as text that begins with one. */
function dayOf(ctx: ViewContext, row: Row, property: string): string | null {
  const value = ctx.engine.value(row, property)
  if (value instanceof Date) return moment(value).format('YYYY-MM-DD')
  const text = expr.isEmpty(value) ? '' : expr.toText(value)
  return /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0] ?? null
}

/**
 * A month with the notes on their days. The date comes from the property named
 * in the view's `date` (set in the view's settings); without one, from the
 * first shown property that holds dates, and failing that from the day in a
 * note's own name.
 */
export const calendar: ViewRenderer = (ctx) => {
  const { view, result, columns, engine } = ctx
  const rows = result.rows
  const chosen = typeof view.date === 'string' && view.date ? view.date : columns.find((property) => rows.some((row) => dayOf(ctx, row, property)))
  const byDay = new Map<string, Row[]>()
  let undated = 0
  for (const row of rows) {
    const day = (chosen && dayOf(ctx, row, chosen)) ?? /\d{4}-\d{2}-\d{2}/.exec(row.file.basename)?.[0] ?? null
    if (!day) undated++
    else byDay.set(day, [...(byDay.get(day) ?? []), row])
  }
  const key = `${ctx.sourcePath}\n${view.name ?? ''}`
  const days = [...byDay.keys()].sort()
  const today = moment().format('YYYY-MM')
  // The current month if it has notes; otherwise the latest month that does.
  const month = months.get(key) ?? (days.some((day) => day.startsWith(today)) || !days.length ? today : days[days.length - 1].slice(0, 7))
  const first = moment(`${month}-01`)

  const box = h('div', { class: 'base-calendar' })
  const turn = (to: string) => {
    months.set(key, to)
    box.replaceWith(calendar(ctx))
  }
  const name = first.format('MMMM YYYY')
  box.append(
    h(
      'div',
      { class: 'base-calendar-head' },
      h('button', { title: 'Предыдущий месяц', onclick: () => turn(first.clone().subtract(1, 'month').format('YYYY-MM')) }, '‹'),
      h('b', {}, name[0].toUpperCase() + name.slice(1)),
      h('button', { onclick: () => turn(today) }, 'Сегодня'),
      h('button', { title: 'Следующий месяц', onclick: () => turn(first.clone().add(1, 'month').format('YYYY-MM')) }, '›'),
      h('span', { class: 'base-calendar-by' }, chosen ? `по «${engine.label(chosen)}»` : 'по дате в названии', undated ? ` · без даты: ${undated}` : ''),
    ),
  )
  const grid = box.appendChild(h('div', { class: 'base-calendar-grid' }, ...WEEKDAYS.map((day) => h('div', { class: 'base-calendar-weekday' }, day))))
  const start = first.clone().subtract(first.isoWeekday() - 1, 'day')
  for (let date = start; date.format('YYYY-MM') <= month || date.isoWeekday() !== 1; date = date.clone().add(1, 'day')) {
    const day = date.format('YYYY-MM-DD')
    const classes = ['base-calendar-day', date.format('YYYY-MM') !== month ? 'other' : '', day === moment().format('YYYY-MM-DD') ? 'today' : ''].filter(Boolean).join(' ')
    grid.append(
      h(
        'div',
        { class: classes },
        h('div', { class: 'base-calendar-date' }, String(date.date())),
        ...(byDay.get(day) ?? []).map((row) =>
          h('a', { class: 'base-calendar-note', href: '#', title: row.path, onclick: (e: MouseEvent) => (e.preventDefault(), ctx.app.workspace.openFile(row.path)) }, row.file.basename),
        ),
      ),
    )
    if (grid.childElementCount > 7 * 7) break
  }
  return box
}
