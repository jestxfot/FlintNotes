import { renderInline, type App } from '../../api'
import { iso } from './dates'
import { daysChip } from './days-left'
import type { Due, Reminders } from './reminders'
import type { TaskStore } from './store'
import type { Task } from './task'

type Show = 'all' | 'overdue' | 'today' | 'later'

/**
 * The page of reminders: everything that has a moment to remind at, in groups
 * (overdue, today, tomorrow, then day by day), with how many there are of
 * each. A reminder can be done, put off or closed here; alerts as a whole can
 * be held back for a while. The same thing serves as a widget of a sidebar and
 * as a tab with the page to itself.
 */
export function mountReminders(app: App, store: TaskStore, reminders: Reminders, onEdit: (task: Task) => void, target: HTMLElement): () => void {
  const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = '') => {
    const node = parent.appendChild(document.createElement(tag))
    if (className) node.className = className
    if (text) node.textContent = text
    return node
  }
  const root = el(target, 'div', 'reminders-panel')
  let show: Show = 'all'
  let closedToo = false

  const dayOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const clock = (date: Date) => date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })

  const draw = () => {
    const now = new Date()
    const today = dayOf(now)
    const tomorrow = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
    const all = reminders.upcoming().filter((due) => closedToo || !due.closed)
    const overdue = all.filter((due) => due.at < now)
    const todays = all.filter((due) => due.at >= now && dayOf(due.at) === today)
    const later = all.filter((due) => due.at >= now && dayOf(due.at) !== today)
    root.replaceChildren()

    // ---- the head: how many of each, and whether alerts are on
    const head = el(root, 'div', 'reminders-head')
    const chip = (id: Show, name: string, count: number, cls = '') => {
      const button = el(head, 'button', `reminders-chip ${cls}${show === id ? ' on' : ''}`)
      button.append(name)
      if (count) el(button, 'span', 'reminders-badge', String(count))
      button.onclick = () => {
        show = id
        draw()
      }
    }
    chip('all', 'Все', all.length)
    chip('overdue', 'Просрочено', overdue.length, overdue.length ? 'late' : '')
    chip('today', 'Сегодня', todays.length)
    chip('later', 'Позже', later.length)
    el(head, 'span', 'reminders-grow')
    const muted = reminders.muted()
    const bell = el(head, 'button', muted ? 'reminders-tool on' : 'reminders-tool')
    bell.title = muted ? 'Уведомления приостановлены — щёлкните, чтобы изменить' : 'Приостановить уведомления'
    bell.append(app.icons.draw(muted ? 'bell-off' : 'bell'))
    bell.onclick = (event) =>
      app.menus.show(event, 'reminders-mute', null, [
        ...(muted ? [{ icon: 'bell', title: 'Включить уведомления', onClick: () => (reminders.mute(0), draw()) }] : []),
        { icon: 'bell-off', title: 'Не беспокоить 30 минут', onClick: () => (reminders.mute(30), draw()) },
        { icon: 'bell-off', title: 'Не беспокоить 1 час', onClick: () => (reminders.mute(60), draw()) },
        { icon: 'bell-off', title: 'Не беспокоить 3 часа', onClick: () => (reminders.mute(180), draw()) },
        { icon: 'moon', title: 'Не беспокоить до завтра, 09:00', onClick: () => (reminders.mute(Math.ceil((new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9).getTime() - Date.now()) / 60_000)), draw()) },
        { section: 'edit', icon: closedToo ? 'eye-off' : 'eye', title: closedToo ? 'Скрыть закрытые напоминания' : 'Показать закрытые напоминания', onClick: () => ((closedToo = !closedToo), draw()) },
        { section: 'edit', icon: 'settings', title: 'Настройки напоминаний…', onClick: () => app.commands.run('core:settings') },
      ])

    // ---- the groups
    const groups = new Map<string, { late: boolean; items: Due[] }>()
    const put = (name: string, due: Due, late = false) => {
      const group = groups.get(name) ?? groups.set(name, { late, items: [] }).get(name)!
      group.items.push(due)
    }
    for (const due of show === 'overdue' ? overdue : show === 'today' ? todays : show === 'later' ? later : all) {
      const day = dayOf(due.at)
      if (due.at < now) put('Просрочено', due, true)
      else if (day === today) put('Сегодня', due)
      else if (day === tomorrow) put('Завтра', due)
      else put(due.at.toLocaleDateString('ru', { day: 'numeric', month: 'long', weekday: 'short' }), due)
    }
    if (!groups.size) el(root, 'p', 'reminders-none', show === 'all' ? 'Напоминаний нет. Допишите к задаче ⏰ 14:00 или (@2026-10-10 14:00), либо начните строку плана дня со времени: «- [ ] 17:00 - 17:10 …».' : 'Здесь пусто')

    // Each group is a part of its own: a list in a sidebar, a card where the page is wide.
    const board = el(root, 'div', 'reminders-groups')
    for (const [name, { late, items }] of groups) {
      const part = el(board, 'section', late ? 'reminders-group overdue' : 'reminders-group')
      const title = el(part, 'h4', late ? 'overdue' : '')
      title.append(name)
      el(title, 'span', 'reminders-badge', String(items.length))
      for (const due of items) {
        const { task, at } = due
        const row = el(part, 'div', `reminder-row${due.closed ? ' closed' : ''}`)
        row.title = task.path
        const until = reminders.snoozedUntil(due)
        // The day over the time, in a narrow column: the text has the width.
        const time = el(row, 'span', 'reminder-time')
        if (late) el(time, 'span', 'reminder-day', at.toLocaleDateString('ru', { day: 'numeric', month: 'short' }))
        el(time, 'span', '', clock(at))
        const text = el(row, 'span', 'reminder-text')
        // A line of the day plan says its hours itself; the time before it is enough.
        text.append(renderInline(app, task.description.replace(/^\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})?\s+(?=\S)/, ''), task.path))
        el(text, 'span', 'reminder-source', task.path.replace(/^.*\//, '').replace(/\.md$/, ''))
        // How long is left (to the task's own day, or to the reminder's if the line has no day of its own), and until when it waits.
        const meta = el(row, 'span', 'reminder-meta')
        if (!due.closed) meta.append(daysChip(task.due ?? task.scheduled ?? iso(at), task.due || task.scheduled ? undefined : 'Напоминание'))
        if (until) el(meta, 'span', 'reminder-snoozed', `отложено до ${clock(new Date(until))}`)
        const tools = el(row, 'span', 'reminder-tools')
        const tool = (icon: string, label: string, action: (event: MouseEvent) => void) => {
          const button = el(tools, 'button')
          button.title = label
          button.setAttribute('aria-label', label)
          button.append(app.icons.draw(icon))
          button.onclick = (event) => {
            event.stopPropagation()
            action(event)
          }
        }
        tool('file-text', 'Открыть в заметке', () => app.workspace.openFile(task.path, { line: task.line }))
        if (!task.plain) tool('check', 'Выполнено', () => (reminders.dismiss(due), void store.toggle(task)))
        tool('alarm-clock', 'Отложить', (event) =>
          app.menus.show(
            event,
            'reminders-later',
            due,
            reminders.choices().map((option) => ({ icon: 'alarm-clock', title: `${option.label} — ${option.at.toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, onClick: () => reminders.postpone(due, option.at) })),
          ),
        )
        if (due.closed) tool('rotate-ccw', 'Вернуть', () => (reminders.restore(due), draw()))
        else tool('x', 'Закрыть: больше не напоминать', () => (reminders.dismiss(due), draw()))
        row.onclick = (event) => {
          if ((event.target as Element).closest('a, button')) return
          // A task opens in its window; a plain line that only reminds has nothing to edit but its note.
          if (task.plain) app.workspace.openFile(task.path, { line: task.line })
          else onEdit(task)
        }
        row.oncontextmenu = (event) => app.menus.show(event, 'task', task, task.plain ? [] : [{ icon: 'pencil', title: 'Изменить задачу…', onClick: () => onEdit(task) }])
      }
    }
  }

  draw()
  const off = store.on('change', draw)
  // Reminders move from "today" to "overdue" as time passes.
  const timer = setInterval(draw, 30_000)
  return () => {
    off()
    clearInterval(timer)
    root.remove()
  }
}
