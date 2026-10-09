import { errorMessage, moment, plural, renderInline, type Moment } from '../../api'
import type { ListItem } from './pages'
import { PAIR, type Env, type Result } from './query'
import { Dur, Link, toText, typeOf } from './values'

export interface DrawEnv extends Env {
  /** moment.js format for dates in results. */
  dateFormat: string
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/** A value as it is shown in a table cell or a list row. */
export function renderValue(env: DrawEnv, value: unknown): Node {
  const { app, origin } = env
  switch (typeOf(value)) {
    case 'null':
      return el('span', 'dv-empty', '–')
    case 'link': {
      const link = value as Link
      const dest = !link.path || link.path === '#' ? origin : app.metadata.resolve(link.path, origin)
      if (link.embed && dest && IMAGE.test(dest)) {
        const image = el('img', 'dv-image')
        image.src = app.vault.url(dest)
        image.alt = toText(link)
        return image
      }
      const a = el('a', dest ? 'inline-link' : 'inline-link unresolved', toText(link))
      a.href = '#'
      a.title = dest ?? link.path
      a.onclick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (dest) app.workspace.openFile(dest)
        else app.notice(`Заметка «${link.path}» не найдена`)
      }
      return a
    }
    case 'array': {
      const items = value as unknown[]
      if (items.length === 1) return renderValue(env, items[0])
      const list = el('ul', 'dv-values')
      for (const item of items) list.appendChild(el('li')).append(renderValue(env, item))
      return list
    }
    case 'object': {
      const pair = value as { id: unknown; value: unknown; [PAIR]?: boolean }
      if (pair[PAIR]) {
        const row = el('span')
        row.append(renderValue(env, pair.id), ': ', renderValue(env, pair.value))
        return row
      }
      if (value instanceof Node) return value
      const list = el('ul', 'dv-values')
      for (const [key, item] of Object.entries(value as object)) {
        const row = list.appendChild(el('li'))
        row.append(el('b', '', `${key}: `), renderValue(env, item))
      }
      return list
    }
    case 'string': {
      const span = el('span')
      span.append(renderInline(app, value as string, origin))
      return span
    }
    case 'function':
      return document.createTextNode('')
    default:
      return document.createTextNode(toText(value, env.dateFormat))
  }
}

/** A short text that changes whenever the drawn result would. */
export function stamp(value: unknown): string {
  if (value instanceof Map) return stamp([...value])
  switch (typeOf(value)) {
    case 'date': return `d${(value as Moment).valueOf()}`
    case 'duration': return `p${(value as Dur).valueOf()}`
    case 'link': return (value as Link).toString()
    case 'array': return `[${(value as unknown[]).map(stamp).join('\u0001')}]`
    case 'object': {
      if (value instanceof Node) return 'node'
      const object = value as Record<string | symbol, unknown>
      // A task is told apart by where it is and what it says; its note's fields do not show.
      if (typeof object.line === 'number' && typeof object.path === 'string') return `${object.path}:${object.line}:${object.status}:${object.text}${stamp(object.children)}`
      return `{${Object.entries(object).map(([key, item]) => `${key}=${stamp(item)}`).join('\u0001')}${object[PAIR] ? 'pair' : ''}}`
    }
    default: return `${typeof value}${String(value)}`
  }
}

async function toggle(env: DrawEnv, item: ListItem, done: boolean): Promise<void> {
  const { vault } = env.app
  try {
    const lines = (await vault.read(item.path)).split('\n')
    const line = lines[item.line]
    const next = line?.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/, `$1${done ? 'x' : ' '}$3`)
    if (next === undefined || next === line) throw new Error('строка задачи изменилась')
    lines[item.line] = next
    await vault.write(item.path, lines.join('\n'))
  } catch (err) {
    env.app.notice(`Не удалось отметить задачу: ${errorMessage(err)}`)
  }
}

/** A list of tasks with working checkboxes; sub-items stay under their task. */
export function renderTasks(env: DrawEnv, tasks: ListItem[]): HTMLElement {
  const nested = new Set<ListItem>()
  const mark = (item: ListItem) => item.children.forEach((child) => (nested.add(child), mark(child)))
  tasks.forEach(mark)
  const draw = (items: ListItem[]) => {
    const list = el('ul', 'dv-tasks')
    for (const item of items) {
      const row = list.appendChild(el('li', item.checked ? 'dv-task done' : 'dv-task'))
      const line = row.appendChild(el('div', 'dv-task-line'))
      if (item.task) {
        const box = line.appendChild(el('input'))
        box.type = 'checkbox'
        box.checked = item.checked
        box.onchange = () => {
          box.disabled = true
          void toggle(env, item, box.checked)
        }
      } else {
        line.append(el('span', 'dv-bullet', '•'))
      }
      const text = line.appendChild(el('span', 'dv-task-text'))
      text.append(renderInline(env.app, item.text, item.path))
      text.title = item.path
      // A click on the text (not on a link in it) goes to the task in its note.
      text.onclick = (event) => {
        if (!(event.target as Element).closest('a')) env.app.workspace.openFile(item.path, { line: item.line })
      }
      if (item.children.length) row.append(draw(item.children))
    }
    return list
  }
  return draw(tasks.filter((task) => !nested.has(task)))
}

/** A month with a dot for every note of each day. */
function renderCalendar(env: DrawEnv, days: Map<string, Link[]>, target: HTMLElement, state: { month?: string }): void {
  const dates = [...days.keys()].sort()
  const today = moment().format('YYYY-MM')
  // The current month if it has anything, otherwise the latest one that does.
  state.month ??= dates.some((date) => date.startsWith(today)) || !dates.length ? today : dates[dates.length - 1].slice(0, 7)
  const first = moment(`${state.month}-01`)
  const box = target.appendChild(el('div', 'dv-calendar'))
  const head = box.appendChild(el('div', 'dv-calendar-head'))
  const step = (by: number, label: string, title: string) => {
    const button = head.appendChild(el('button', '', label))
    button.title = title
    button.onclick = () => {
      state.month = first.clone().add(by, 'month').format('YYYY-MM')
      target.replaceChildren()
      renderCalendar(env, days, target, state)
    }
  }
  step(-1, '‹', 'Предыдущий месяц')
  const name = first.format('MMMM YYYY')
  head.append(el('span', 'dv-calendar-title', name[0].toUpperCase() + name.slice(1)))
  step(1, '›', 'Следующий месяц')

  const grid = box.appendChild(el('div', 'dv-calendar-grid'))
  for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) grid.append(el('span', 'dv-calendar-weekday', day))
  for (let i = 1; i < first.isoWeekday(); i++) grid.append(el('span'))
  for (let date = first.clone(); date.format('YYYY-MM') === state.month; date = date.clone().add(1, 'day')) {
    const key = date.format('YYYY-MM-DD')
    const links = days.get(key) ?? []
    const cell = grid.appendChild(el('div', key === moment().format('YYYY-MM-DD') ? 'dv-calendar-day today' : 'dv-calendar-day'))
    cell.append(el('span', '', String(date.date())))
    const dots = cell.appendChild(el('div', 'dv-calendar-dots'))
    for (const link of links.slice(0, 6)) {
      const dot = renderValue(env, link) as HTMLElement
      dot.title = toText(link)
      dot.textContent = ''
      dot.className = 'dv-calendar-dot'
      dots.append(dot)
    }
    if (links.length) {
      cell.classList.add('has-notes')
      cell.title = links.map((link) => toText(link)).join('\n')
      cell.onclick = () => (dots.firstElementChild as HTMLElement).click()
    }
  }
}

/** Rows drawn at first; the rest come with "show more". */
export const PAGE = 200

export interface DrawState {
  shown: number
  month?: string
  redraw(): void
}

/** Draws the result of a query into `target`. */
export function renderResult(env: DrawEnv, result: Result, target: HTMLElement, state: DrawState): void {
  target.replaceChildren()
  const more = (total: number) => {
    if (total <= state.shown) return
    const button = target.appendChild(el('button', 'dv-more', `Показать ещё (осталось ${total - state.shown})`))
    button.onclick = () => {
      state.shown += PAGE * 3
      state.redraw()
    }
  }
  const nothing = () => target.append(el('div', 'dv-none', 'Ничего не найдено'))

  if (result.type === 'table') {
    const table = target.appendChild(el('table', 'dv-table'))
    const head = table.createTHead().insertRow()
    result.headers.forEach((header, i) => {
      const cell = head.appendChild(el('th', '', header))
      if (i === 0) cell.append(el('span', 'dv-count', String(result.rows.length)))
    })
    const body = table.createTBody()
    for (const row of result.rows.slice(0, state.shown)) {
      const tr = body.insertRow()
      for (const value of row) tr.insertCell().append(renderValue(env, value))
    }
    if (!result.rows.length) nothing()
    more(result.rows.length)
  } else if (result.type === 'list') {
    const list = target.appendChild(el('ul', 'dv-list'))
    for (const item of result.items.slice(0, state.shown)) list.appendChild(el('li')).append(renderValue(env, item))
    if (!result.items.length) nothing()
    more(result.items.length)
  } else if (result.type === 'task') {
    let left = state.shown
    let total = 0
    for (const group of result.groups) {
      total += group.tasks.length
      if (left <= 0) continue
      if (result.groups.length > 1 || group.key !== null) {
        const title = target.appendChild(el('h4', 'dv-group'))
        title.append(renderValue(env, group.key), el('span', 'dv-count', String(group.tasks.length)))
      }
      target.append(renderTasks(env, group.tasks.slice(0, left)))
      left -= group.tasks.length
    }
    if (!total) nothing()
    else target.append(el('div', 'dv-total', plural(total, ['задача', 'задачи', 'задач'])))
    more(total)
  } else {
    renderCalendar(env, result.days, target, state)
  }
}
