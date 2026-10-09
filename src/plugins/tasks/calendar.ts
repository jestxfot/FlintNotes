import { renderInline, type App } from '../../api'
import { addMonths, fromIso, iso, today } from './dates'
import type { TaskStore } from './store'
import { formatTaskLine, isDone, isOpen, parseTaskLine, PRIORITIES, NO_PRIORITY, type Task } from './task'

export type CalendarField = 'due' | 'scheduled' | 'start' | 'done' | 'happens'

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
/** Tasks listed in a day before the rest is folded into "+N". */
const PER_DAY = 4

/** The date a task stands on, and the field it comes from: "happens" is the first of due, scheduled and start. */
export function dateOf(task: Task, field: CalendarField): { date: string; field: Exclude<CalendarField, 'happens'> } | null {
  const fields = field === 'happens' ? (['due', 'scheduled', 'start'] as const) : [field]
  for (const name of fields) if (task[name]) return { date: task[name]!, field: name }
  return null
}

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = parent.appendChild(document.createElement(tag))
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

export interface CalendarState {
  /** The month on screen, `YYYY-MM`. */
  month?: string
  /** Days whose folded tasks were opened. */
  open: Set<string>
  redraw(): void
}

/**
 * Draws tasks as a month: each task sits on its date, can be ticked, opened
 * for editing with a click, and moved to another day by dragging.
 */
export function drawCalendar(app: App, store: TaskStore, target: HTMLElement, tasks: Task[], field: CalendarField, state: CalendarState, onEdit: (task: Task) => void): void {
  const month = (state.month ??= today().slice(0, 7))
  const days = new Map<string, Task[]>()
  const undated: Task[] = []
  for (const task of tasks) {
    const at = dateOf(task, field)
    if (!at) undated.push(task)
    else days.set(at.date, [...(days.get(at.date) ?? []), task])
  }

  const box = el(target, 'div', 'tasks-calendar')
  const head = el(box, 'div', 'tasks-calendar-head')
  const go = (label: string, title: string, to: string) => {
    const button = el(head, 'button', '', label)
    button.title = title
    button.onclick = () => {
      state.month = to
      state.redraw()
    }
  }
  go('‹', 'Предыдущий месяц', addMonths(`${month}-01`, -1).slice(0, 7))
  el(head, 'span', 'tasks-calendar-title', `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`)
  go('Сегодня', 'К текущему месяцу', today().slice(0, 7))
  go('›', 'Следующий месяц', addMonths(`${month}-01`, 1).slice(0, 7))

  const chip = (parent: HTMLElement, task: Task) => {
    const row = el(parent, 'div', isOpen(task) ? 'tasks-calendar-task' : 'tasks-calendar-task done')
    row.draggable = true
    row.title = `${task.description}\n${task.path}`
    row.ondragstart = (event) => {
      dragged = task
      event.dataTransfer?.setData('text/plain', task.description)
      event.stopPropagation()
    }
    const check = el(row, 'input')
    check.type = 'checkbox'
    check.checked = isDone(task)
    check.onchange = () => {
      check.disabled = true
      void store.toggle(task)
    }
    const text = el(row, 'span', 'tasks-calendar-text')
    if (task.priority !== NO_PRIORITY) text.append(`${PRIORITIES[task.priority].emoji} `)
    text.append(renderInline(app, task.description, task.path))
    text.onclick = (event) => {
      if (!(event.target as Element).closest('a')) onEdit(task)
    }
  }

  let dragged: Task | null = null
  const move = (task: Task, date: string) => {
    const from = dateOf(task, field)
    // A task without a date gets the date the calendar is built on (the due date by default).
    const name = from?.field ?? (field === 'happens' ? 'due' : field)
    if (from?.date === date) return
    void store.edit(task, (raw) => {
      const parsed = parseTaskLine(raw)
      return parsed ? [formatTaskLine({ ...parsed, [name]: date }, parsed.prefix)] : [raw]
    })
  }

  const grid = el(box, 'div', 'tasks-calendar-grid')
  for (const name of WEEKDAYS) el(grid, 'div', 'tasks-calendar-weekday', name)
  const first = fromIso(`${month}-01`)
  // The grid starts on the Monday of the month's first week and always shows whole weeks.
  const cursor = new Date(first)
  cursor.setDate(1 - ((first.getDay() + 6) % 7))
  const now = today()
  do {
    for (let i = 0; i < 7; i++, cursor.setDate(cursor.getDate() + 1)) {
      const date = iso(cursor)
      const cell = el(grid, 'div', 'tasks-calendar-day')
      cell.dataset.date = date
      cell.classList.toggle('other', date.slice(0, 7) !== month)
      cell.classList.toggle('today', date === now)
      cell.classList.toggle('weekend', i > 4)
      el(cell, 'div', 'tasks-calendar-date', String(cursor.getDate()))
      const list = days.get(date) ?? []
      const all = state.open.has(date) || list.length <= PER_DAY
      for (const task of all ? list : list.slice(0, PER_DAY - 1)) chip(cell, task)
      if (!all) {
        const more = el(cell, 'button', 'tasks-calendar-more', `+${list.length - PER_DAY + 1}`)
        more.title = 'Показать все задачи дня'
        more.onclick = () => {
          state.open.add(date)
          state.redraw()
        }
      }
      cell.ondragover = (event) => {
        if (!dragged) return
        event.preventDefault()
        cell.classList.add('over')
      }
      cell.ondragleave = () => cell.classList.remove('over')
      cell.ondrop = (event) => {
        event.preventDefault()
        cell.classList.remove('over')
        if (dragged) move(dragged, date)
        dragged = null
      }
    }
  } while (iso(cursor).slice(0, 7) === month)

  if (undated.length) {
    const rest = el(box, 'details', 'tasks-calendar-undated')
    el(rest, 'summary', '', `Без даты: ${undated.length}`)
    rest.open = state.open.has('')
    rest.ontoggle = () => (rest.open ? state.open.add('') : state.open.delete(''))
    for (const task of undated.slice(0, 200)) chip(rest, task)
  }
}
