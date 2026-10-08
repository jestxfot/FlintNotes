import { path as paths, plural, renderInline, type App, type CodeBlockProcessor } from '../../api'
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

/** Draws a ```tasks block: the tasks of the whole vault that match the block's query. */
export const tasksProcessor =
  (store: TaskStore, onEdit: (task: Task) => void): CodeBlockProcessor =>
  (source, el, { app }) => {
    el.classList.add('tasks-block')
    let current = source

    const draw = () => {
      const query = parseQuery(app, current)
      const { groups, total } = runQuery(store.all(), query)
      el.replaceChildren()
      for (const message of query.errors) {
        const error = el.appendChild(document.createElement('div'))
        error.className = 'tasks-error'
        error.textContent = message
      }
      for (const group of groups) {
        if (group.name) {
          const title = el.appendChild(document.createElement('h4'))
          title.textContent = group.name
          const count = title.appendChild(document.createElement('span'))
          count.textContent = String(group.tasks.length)
        }
        const list = el.appendChild(document.createElement('ul'))
        for (const task of group.tasks) list.append(taskRow(app, store, task, query.hide, onEdit))
      }
      if (!query.hide.has('task count')) {
        const footer = el.appendChild(document.createElement('div'))
        footer.className = 'tasks-count'
        footer.textContent = total ? plural(total, ['задача', 'задачи', 'задач']) : 'Задач не найдено'
      }
    }

    draw()
    const off = store.on('change', draw)
    return {
      update(next) {
        current = next
        draw()
      },
      destroy: off,
    }
  }
