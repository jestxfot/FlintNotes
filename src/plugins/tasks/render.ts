import { path as paths, plural, renderInline, type App, type CodeBlockProcessor } from '../../api'
import { drawCalendar, type CalendarState } from './calendar'
import { shortDate, today } from './dates'
import { parseQuery, runQuery } from './query'
import type { TaskStore } from './store'
import { isDone, isOpen, NO_PRIORITY, PRIORITIES, type Task } from './task'

function chip(className: string, text: string, title: string): HTMLElement {
  const el = document.createElement('span')
  el.className = `task-chip ${className}`
  el.textContent = text
  el.title = title
  return el
}

/** One task of a list: checkbox, text, dates and where it lives. */
export function taskRow(app: App, store: TaskStore, task: Task, hide: Set<string>, onEdit: (task: Task) => void) {
  const row = document.createElement('li')
  row.className = 'task-row'
  row.classList.toggle('done', !isOpen(task))

  const box = row.appendChild(document.createElement('input'))
  box.type = 'checkbox'
  box.checked = isDone(task)
  box.onchange = () => {
    box.disabled = true
    void store.toggle(task)
  }

  const text = row.appendChild(document.createElement('span'))
  text.className = 'task-text'
  text.append(renderInline(app, task.description, task.path))

  const shown = (part: string) => !hide.has(part)
  if (task.priority !== NO_PRIORITY && shown('priority')) {
    const priority = PRIORITIES[task.priority]
    row.append(chip(`priority-${priority.name}`, priority.emoji, `Приоритет: ${priority.label.toLowerCase()}`))
  }
  if (task.start && shown('start date')) row.append(chip('', `🛫 ${shortDate(task.start)}`, 'Начало'))
  if (task.scheduled && shown('scheduled date')) row.append(chip('', `⏳ ${shortDate(task.scheduled)}`, 'Запланировано'))
  if (task.due && shown('due date')) {
    const overdue = isOpen(task) && task.due < today()
    row.append(chip(overdue ? 'overdue' : '', `📅 ${shortDate(task.due)}`, overdue ? 'Срок прошёл' : 'Срок'))
  }
  if (task.reminder && shown('reminder')) row.append(chip('', `⏰ ${task.reminder}`, 'Напоминание'))
  if (task.recurrence && shown('recurrence rule')) row.append(chip('', '🔁', `Повтор: ${task.recurrence}`))
  if (task.done && shown('done date')) row.append(chip('', `✅ ${shortDate(task.done)}`, 'Выполнено'))

  if (shown('edit button')) {
    const edit = row.appendChild(document.createElement('button'))
    edit.className = 'task-edit'
    edit.textContent = '✎'
    edit.title = 'Изменить задачу'
    edit.onclick = () => onEdit(task)
  }
  if (shown('backlink')) {
    const source = row.appendChild(document.createElement('a'))
    source.className = 'task-source'
    source.href = '#'
    source.textContent = paths.stripExt(paths.basename(task.path)) + (task.heading ? ` › ${task.heading}` : '')
    source.title = task.path
    source.onclick = (event) => {
      event.preventDefault()
      app.workspace.openFile(task.path, { line: task.line })
    }
  }
  return row
}

/** Rows drawn at first; a list of thousands of tasks would freeze the page if drawn whole. */
const PAGE = 100

/** Draws a ```tasks block: the tasks of the whole vault that match the block's query. */
export const tasksProcessor =
  (store: TaskStore, onEdit: (task: Task) => void): CodeBlockProcessor =>
  (source, el, { app }) => {
    el.classList.add('tasks-block')
    let current = source
    let shown = PAGE
    let drawn = ''
    let stale = false
    const calendar: CalendarState = {
      open: new Set(),
      redraw: () => {
        drawn = ''
        draw()
      },
    }

    const draw = () => {
      // Nothing is worked out for a list that is not on screen; it catches up when it is.
      if (!el.isConnected || el.offsetParent === null) {
        stale = true
        return
      }
      stale = false
      const query = parseQuery(app, current)
      const { groups, total } = runQuery(store.all(), query)
      // Most changes in the vault leave a given list as it was; then the page is not touched.
      const signature = JSON.stringify([shown, query.calendar, calendar.month, today(), query.errors, groups.map((group) => [group.name, group.tasks.map((task) => `${task.path}:${task.line}:${task.raw}`)])])
      if (signature === drawn) return
      drawn = signature

      el.replaceChildren()
      for (const message of query.errors) {
        const error = el.appendChild(document.createElement('div'))
        error.className = 'tasks-error'
        error.textContent = message
      }
      if (query.calendar) {
        // A calendar shows everything that matched: its pages are the months.
        drawCalendar(app, store, el, groups.flatMap((group) => group.tasks), query.calendar, calendar, onEdit)
        return
      }
      let left = shown
      for (const group of groups) {
        if (left <= 0) break
        if (group.name) {
          const title = el.appendChild(document.createElement('h4'))
          title.textContent = group.name
          const count = title.appendChild(document.createElement('span'))
          count.textContent = String(group.tasks.length)
        }
        const list = el.appendChild(document.createElement('ul'))
        for (const task of group.tasks.slice(0, left)) list.append(taskRow(app, store, task, query.hide, onEdit))
        left -= group.tasks.length
      }
      if (total > shown) {
        const more = el.appendChild(document.createElement('button'))
        more.className = 'tasks-more'
        more.textContent = `Показать ещё (осталось ${total - shown})`
        more.onclick = () => {
          shown += PAGE * 3
          draw()
        }
      }
      if (!query.hide.has('task count')) {
        const footer = el.appendChild(document.createElement('div'))
        footer.className = 'tasks-count'
        footer.textContent = total ? plural(total, ['задача', 'задачи', 'задач']) : 'Задач не найдено'
      }
    }

    // The element is not in the page yet while the block is being created.
    requestAnimationFrame(draw)
    const off = store.on('change', draw)
    const visible = new IntersectionObserver((entries) => {
      if (stale && entries.some((entry) => entry.isIntersecting)) draw()
    })
    visible.observe(el)
    return {
      update(next) {
        current = next
        shown = PAGE
        draw()
      },
      destroy() {
        off()
        visible.disconnect()
      },
    }
  }
