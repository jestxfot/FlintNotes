import { expr, fileRef, moment, path as paths, type App, type Moment } from '../../api'
import { parseDateSpec, shortDate, today } from './dates'
import { isCancelled, isDone, isOpen, PRIORITIES, type DateField, type Task } from './task'

type Filter = (task: Task) => boolean

interface Sorter {
  value: (task: Task) => unknown
  reverse: boolean
}

interface Grouper {
  /** Group names of a task; a task with several tags appears in several groups. */
  names: (task: Task) => string[]
  /** Orders the groups; defaults to their names. */
  order?: (name: string) => unknown
  reverse: boolean
}

export interface Query {
  filters: Filter[]
  sorts: Sorter[]
  groups: Grouper[]
  limit?: number
  /** Parts of the list to leave out: `backlink`, `task count`, `due date`, ... */
  hide: Set<string>
  /** Lines that could not be understood, with the reason. */
  errors: string[]
  /** `view calendar`: the tasks are laid out on a month by this date instead of being listed. */
  calendar?: 'due' | 'scheduled' | 'start' | 'done' | 'happens'
}

export interface ResultGroup {
  name: string
  tasks: Task[]
}

/** When a task "happens": the earliest of its start, scheduled and due dates, as in Obsidian Tasks. */
export const happens = (task: Task): string | undefined => [task.start, task.scheduled, task.due].filter(Boolean).sort()[0]

/** Reads the date a query word names: one of the task's dates, or `happens`. */
const dateReader = (word: string) => (word === 'happens' ? happens : (task: Task) => task[DATE_WORDS[word]])

const DATE_WORDS: Record<string, DateField> = {
  due: 'due',
  scheduled: 'scheduled',
  starts: 'start',
  start: 'start',
  created: 'created',
  done: 'done',
  cancelled: 'cancelled',
}

const priorityByName = (name: string) => PRIORITIES.findIndex((p) => p.name === name)

/** What a task looks like to an expression in `where`, `sort by` and `group by`. */
function scope(app: App, task: Task): expr.Scope {
  const date = (value?: string) => (value ? expr.parseDate(value) : null)
  const values: Record<string, () => unknown> = {
    description: () => task.description,
    status: () => task.status,
    done: () => isDone(task),
    cancelled: () => isCancelled(task),
    open: () => isOpen(task),
    due: () => date(task.due),
    scheduled: () => date(task.scheduled),
    start: () => date(task.start),
    created: () => date(task.created),
    completed: () => date(task.done),
    reminder: () => task.reminder ?? null,
    priority: () => PRIORITIES[task.priority].name,
    priorityNumber: () => task.priority,
    recurring: () => !!task.recurrence,
    recurrence: () => task.recurrence ?? null,
    tags: () => task.tags,
    path: () => task.path,
    folder: () => paths.dirname(task.path),
    filename: () => paths.stripExt(paths.basename(task.path)),
    heading: () => task.heading ?? null,
    file: () => fileRef(app, task.path),
  }
  return { get: (name) => (Object.hasOwn(values, name) ? values[name]() : undefined) }
}

/**
 * A task's date as Obsidian Tasks exposes it to `filter by function`: `task.due.moment`.
 * A class, as there: every task of the vault has several, and the ways are shared by all.
 */
class TaskDate {
  private parsed: Moment | null | undefined

  constructor(private value?: string) {}

  // Read by few queries, so it is only worked out when one asks.
  get moment(): Moment | null {
    if (this.parsed === undefined) this.parsed = this.value ? moment(this.value) : null
    return this.parsed
  }

  /** The date written by a format of Moment.js; `fallback` for a task without this date. */
  format(format: string, fallback = ''): string {
    return this.value ? moment(this.value).format(format) : fallback
  }

  /**
   * How far the date is from now, in words, for grouping: groups of the past come first,
   * the oldest first, then those of the future, the nearest first, as in Obsidian Tasks.
   */
  get fromNow() {
    const date = this.moment
    if (!date || !date.isValid()) return { name: '', sortOrder: 0, groupText: '' }
    const { count, unit, past } = date.relative()
    const start = past ? moment().subtract(count, unit) : moment().add(count, unit)
    const sortOrder = Number((past ? '1' : '3') + start.format('YYYYMMDDHHmm'))
    const name = date.fromNow()
    return { name, sortOrder, groupText: `%%${sortOrder}%% ${name}` }
  }

  formatAsDate(fallback = ''): string {
    return this.value ?? fallback
  }

  formatAsDateAndTime(fallback = ''): string {
    return this.value ?? fallback
  }

  toISOString(): string {
    return this.value ? moment(this.value).toISOString() : ''
  }

  get category() {
    const today = moment().startOf('day')
    const date = this.moment
    if (!date) return { name: 'Undated', sortOrder: 4, groupText: '%%4%% Undated' }
    const diff = date.diff(today, 'days')
    const name = diff < 0 ? 'Overdue' : diff === 0 ? 'Today' : 'Future'
    const sortOrder = diff < 0 ? 1 : diff === 0 ? 2 : 3
    return { name, sortOrder, groupText: `%%${sortOrder}%% ${name}` }
  }
}

const STATUS_TYPES: Record<string, string> = { ' ': 'TODO', x: 'DONE', X: 'DONE', '-': 'CANCELLED', '/': 'IN_PROGRESS' }

/**
 * The `task` object that `filter by function`, `group by function` and
 * `sort by function` see, shaped like the one in Obsidian Tasks so queries
 * written there work here: `task.file.path`, `task.due.moment`, `task.tags`, ...
 */
const scriptTasks = new WeakMap<Task, ReturnType<typeof buildScriptTask>>()

function scriptTask(app: App, task: Task) {
  let built = scriptTasks.get(task)
  if (!built) scriptTasks.set(task, (built = buildScriptTask(app, task)))
  return built
}

function buildScriptTask(app: App, task: Task) {
  const folder = paths.dirname(task.path)
  const meta = app.metadata.get(task.path)
  const type = STATUS_TYPES[task.status] ?? 'TODO'
  return {
    description: task.description,
    descriptionWithoutTags: task.description.replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, '').trim(),
    status: { symbol: task.status, type, name: type, isCompleted: () => type === 'DONE' },
    isDone: type === 'DONE' || type === 'CANCELLED',
    priorityName: PRIORITIES[task.priority].name.replace(/^./, (c) => c.toUpperCase()),
    priorityNumber: task.priority,
    tags: task.tags.map((tag) => `#${tag}`),
    due: new TaskDate(task.due),
    scheduled: new TaskDate(task.scheduled),
    start: new TaskDate(task.start),
    created: new TaskDate(task.created),
    done: new TaskDate(task.done),
    cancelled: new TaskDate(task.cancelled),
    happens: new TaskDate(task.due ?? task.scheduled ?? task.start),
    isRecurring: !!task.recurrence,
    recurrenceRule: task.recurrence ?? '',
    heading: task.heading ?? null,
    hasHeading: !!task.heading,
    originalMarkdown: task.raw,
    lineNumber: task.line,
    file: {
      path: task.path,
      // Obsidian Tasks writes folders with a slash at the end, and queries rely on it.
      folder: folder ? `${folder}/` : '/',
      root: folder ? `${folder.split('/')[0]}/` : '/',
      filename: paths.basename(task.path),
      filenameWithoutExtension: paths.stripExt(paths.basename(task.path)),
      tags: (meta?.tags ?? []).map((tag) => `#${tag}`),
      frontmatter: meta?.frontmatter ?? {},
      hasProperty: (name: string) => !!meta?.frontmatter && name in meta.frontmatter,
      property: (name: string) => meta?.frontmatter?.[name] ?? null,
    },
  }
}

/** Compiles the JavaScript after `... by function`: an expression, or statements with `return`. */
function compileFunction(app: App, source: string): (task: Task) => unknown {
  const body = /\breturn\b/.test(source) ? source : `return (${source}\n)`
  const fn = new Function('task', body) as (task: unknown) => unknown
  return (task) => fn(scriptTask(app, task))
}

/** The comment marks `%%…%%` order groups without showing: "%%1%% Сегодня" sorts first, reads "Сегодня". */
const visible = (name: string) => name.replace(/%%.*?%%/g, '').trim()

const TEXT_FIELDS: Record<string, (task: Task) => string> = {
  path: (task) => task.path,
  filename: (task) => paths.basename(task.path),
  folder: (task) => paths.dirname(task.path),
  description: (task) => task.description,
  heading: (task) => task.heading ?? '',
}

/** One condition without AND/OR, e.g. `due before next week` or `priority is above medium`. */
function atom(app: App, text: string): Filter {
  const line = text.trim()
  const lower = line.toLowerCase()
  let m: RegExpExecArray | null

  if (lower === 'done') return isDone
  if (lower === 'not done') return isOpen
  if (lower === 'is recurring') return (task) => !!task.recurrence
  if (lower === 'is not recurring') return (task) => !task.recurrence
  if (lower === 'has tags') return (task) => task.tags.length > 0
  if (lower === 'no tags') return (task) => task.tags.length === 0
  if (lower === 'has reminder') return (task) => !!task.reminder
  if (lower === 'no reminder') return (task) => !task.reminder

  if ((m = /^(has|no) (due|scheduled|start|created|done|cancelled|happens) date$/.exec(lower))) {
    const date = dateReader(m[2])
    const wanted = m[1] === 'has'
    return (task) => !!date(task) === wanted
  }

  if ((m = /^(due|scheduled|starts|start|created|done|cancelled|happens) (on or before|on or after|before|after|on)? ?(.+)$/.exec(lower))) {
    const range = parseDateSpec(m[3])
    if (range) {
      const date = dateReader(m[1])
      const [from, to] = range
      const tests: Record<string, (date: string) => boolean> = {
        before: (date) => date < from,
        after: (date) => date > to,
        'on or before': (date) => date <= to,
        'on or after': (date) => date >= from,
      }
      const test = tests[m[2] ?? ''] ?? ((date: string) => date >= from && date <= to)
      return (task) => {
        const value = date(task)
        return !!value && test(value)
      }
    }
  }

  if ((m = /^priority is (above |below |not )?(lowest|low|none|medium|high|highest)$/.exec(lower))) {
    const level = priorityByName(m[2])
    // A smaller number is a higher priority.
    if (m[1] === 'above ') return (task) => task.priority < level
    if (m[1] === 'below ') return (task) => task.priority > level
    if (m[1] === 'not ') return (task) => task.priority !== level
    return (task) => task.priority === level
  }

  if ((m = /^(path|filename|folder|description|heading) (includes|does not include) (.+)$/i.exec(line))) {
    const read = TEXT_FIELDS[m[1].toLowerCase()]
    const wanted = m[3].toLowerCase()
    const positive = m[2].toLowerCase() === 'includes'
    return (task) => read(task).toLowerCase().includes(wanted) === positive
  }

  if ((m = /^tags? (includes?|do not include|does not include) (.+)$/i.exec(line))) {
    const wanted = m[2].replace(/^#/, '').toLowerCase()
    const positive = m[1].toLowerCase().startsWith('include')
    return (task) => task.tags.some((tag) => tag.toLowerCase().includes(wanted)) === positive
  }

  throw new Error(`не понимаю условие «${line}»`)
}

/** Position of the first ` AND ` / ` OR ` outside brackets, or -1. */
function findOperator(text: string, operator: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (depth === 0 && text.startsWith(operator, i)) return i
  }
  return -1
}

/** A condition with `AND`, `OR`, `NOT` and brackets around the parts, as in Obsidian Tasks. */
function condition(app: App, source: string): Filter {
  const text = source.trim()
  for (const [operator, combine] of [
    [' OR ', (a: Filter, b: Filter) => (task: Task) => a(task) || b(task)],
    [' AND ', (a: Filter, b: Filter) => (task: Task) => a(task) && b(task)],
  ] as const) {
    const at = findOperator(text, operator)
    if (at >= 0) return combine(condition(app, text.slice(0, at)), condition(app, text.slice(at + operator.length)))
  }
  if (text.startsWith('NOT ')) {
    const inner = condition(app, text.slice(4))
    return (task) => !inner(task)
  }
  if (text.startsWith('(') && text.endsWith(')')) return condition(app, text.slice(1, -1))
  return atom(app, text)
}

const dateSort = (field: DateField) => (task: Task) => task[field] ?? null

const SORT_KEYS: Record<string, (task: Task) => unknown> = {
  due: dateSort('due'),
  scheduled: dateSort('scheduled'),
  start: dateSort('start'),
  created: dateSort('created'),
  done: dateSort('done'),
  happens: (task) => happens(task) ?? null,
  priority: (task) => task.priority,
  path: (task) => task.path,
  filename: (task) => paths.basename(task.path),
  description: (task) => task.description.toLowerCase(),
  status: (task) => (isOpen(task) ? 0 : isDone(task) ? 1 : 2),
  heading: (task) => task.heading ?? null,
}

const dateGroup = (field: DateField, none: string): Grouper => ({
  names: (task) => [task[field] ?? none],
  reverse: false,
})

const GROUP_KEYS: Record<string, () => Grouper> = {
  due: () => dateGroup('due', 'Без срока'),
  scheduled: () => dateGroup('scheduled', 'Не запланировано'),
  start: () => dateGroup('start', 'Без даты начала'),
  done: () => dateGroup('done', 'Не выполнено'),
  created: () => dateGroup('created', 'Без даты создания'),
  happens: () => ({ names: (task) => [happens(task) ?? 'Без даты'], reverse: false }),
  priority: () => ({
    names: (task) => [PRIORITIES[task.priority].label],
    order: (name) => PRIORITIES.findIndex((p) => p.label === name),
    reverse: false,
  }),
  status: () => ({
    names: (task) => [isDone(task) ? 'Выполнено' : isCancelled(task) ? 'Отменено' : 'Не выполнено'],
    order: (name) => ['Не выполнено', 'Выполнено', 'Отменено'].indexOf(name),
    reverse: false,
  }),
  path: () => ({ names: (task) => [task.path], reverse: false }),
  filename: () => ({ names: (task) => [paths.stripExt(paths.basename(task.path))], reverse: false }),
  folder: () => ({ names: (task) => [paths.dirname(task.path) || '/'], reverse: false }),
  heading: () => ({ names: (task) => [task.heading ?? 'Без заголовка'], reverse: false }),
  tags: () => ({ names: (task) => (task.tags.length ? task.tags.map((tag) => `#${tag}`) : ['Без тегов']), reverse: false }),
  // How soon the task is due: the usual sections of a to-do list.
  when: () => {
    const names = ['Просрочено', 'Сегодня', 'Завтра', 'Дальше', 'Без срока']
    return {
      names: (task) => {
        if (!task.due) return [names[4]]
        const day = today()
        const tomorrow = moment(day).add(1, 'day').format('YYYY-MM-DD')
        return [task.due < day ? names[0] : task.due === day ? names[1] : task.due === tomorrow ? names[2] : names[3]]
      },
      order: (name) => names.indexOf(name),
      reverse: false,
    }
  },
  recurring: () => ({ names: (task) => [task.recurrence ? 'Повторяющиеся' : 'Разовые'], reverse: false }),
}

/**
 * Reads a ```tasks block: one instruction per line.
 *
 * - conditions, all of which must hold: `not done`, `due before next week`,
 *   `priority is above medium`, `path includes Work`, `tag includes #home`,
 *   `(due today) OR (no due date)`, `where due < today() + "7d" && tags.contains("x")`
 * - `sort by due`, `sort by priority reverse`, `sort by expr description.length`
 * - `group by due`, `group by tags`, `group by expr due.format("YYYY-MM")`
 * - `limit 10`, `hide backlink`, `hide task count`
 * - `view calendar`, `view calendar by scheduled`: a month instead of a list.
 *   Written as a comment, `# view calendar`, it is skipped by Obsidian Tasks,
 *   so the same block is a list there and a calendar here.
 */
export function parseQuery(app: App, source: string): Query {
  const query: Query = { filters: [], sorts: [], groups: [], hide: new Set(), errors: [] }
  const byExpr = (text: string, task: Task) => expr.evaluate(text, scope(app, task))

  // A backslash at the end of a line continues the instruction on the next one.
  for (const raw of source.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/)) {
    const line = raw.trim()
    let m: RegExpExecArray | null = /^(?:#\s*)?view:?\s+(calendar|list)(?:\s+by\s+(\S+))?$/i.exec(line)
    if (m) {
      const field = (m[2] ?? 'happens').toLowerCase().replace(/^starts$/, 'start')
      if (!['due', 'scheduled', 'start', 'done', 'happens'].includes(field)) query.errors.push(`«${line}»: календарь строится по due, scheduled, start, done или happens`)
      else query.calendar = m[1].toLowerCase() === 'calendar' ? (field as Query['calendar']) : undefined
      continue
    }
    if (!line || line.startsWith('#')) continue
    const lower = line.toLowerCase()
    try {
      if ((m = /^limit(?: to)? (\d+)(?: tasks?)?$/.exec(lower))) query.limit = Number(m[1])
      else if ((m = /^(hide|show) (.+)$/.exec(lower))) {
        if (m[1] === 'hide') query.hide.add(m[2])
        else query.hide.delete(m[2])
      } else if (/^(short|full) mode$|^explain$/.test(lower)) continue
      else if ((m = /^filter by function (.+)$/is.exec(line))) {
        const test = compileFunction(app, m[1])
        query.filters.push((task) => !!test(task))
      } else if ((m = /^sort by function (reverse )?(.+)$/is.exec(line))) {
        query.sorts.push({ value: compileFunction(app, m[2]), reverse: !!m[1] })
      } else if ((m = /^group by function (reverse )?(.+)$/is.exec(line))) {
        const name = compileFunction(app, m[2])
        // A function may put a task into several groups by returning a list; "" means no group at this level.
        query.groups.push({ names: (task) => [name(task)].flat().map((value) => String(value ?? '')), reverse: !!m[1] })
      } else if ((m = /^where (.+)$/i.exec(line))) {
        const source = m[1]
        expr.parse(source)
        query.filters.push((task) => expr.truthy(byExpr(source, task)))
      } else if ((m = /^sort by (expr )?(.+?)( reverse)?$/i.exec(line))) {
        const key = m[2]
        if (m[1]) expr.parse(key)
        else if (!Object.hasOwn(SORT_KEYS, key.toLowerCase())) throw new Error(`не умею сортировать по «${key}»`)
        query.sorts.push({ value: m[1] ? (task) => byExpr(key, task) : SORT_KEYS[key.toLowerCase()], reverse: !!m[3] })
      } else if ((m = /^group by (expr )?(.+?)( reverse)?$/i.exec(line))) {
        const key = m[2]
        let grouper: Grouper
        if (m[1]) {
          expr.parse(key)
          grouper = { names: (task) => [expr.toText(byExpr(key, task)) || 'Пусто'], reverse: false }
        } else {
          if (!Object.hasOwn(GROUP_KEYS, key.toLowerCase())) throw new Error(`не умею группировать по «${key}»`)
          grouper = GROUP_KEYS[key.toLowerCase()]()
        }
        query.groups.push({ ...grouper, reverse: !!m[3] })
      } else query.filters.push(condition(app, line))
    } catch (err) {
      query.errors.push(`«${line}»: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return query
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareValues(a: unknown, b: unknown): number {
  // Tasks without a value (no due date) go last, whichever way the sort runs.
  if (expr.isEmpty(a) || expr.isEmpty(b)) return Number(expr.isEmpty(a)) - Number(expr.isEmpty(b))
  if (typeof a === 'string' && typeof b === 'string') return collator.compare(a, b)
  return expr.compare(a, b)
}

// With no `sort by`: unfinished first, then by date, importance and place.
const DEFAULT_SORTS: Sorter[] = ['status', 'due', 'priority', 'path'].map((key) => ({
  value: SORT_KEYS[key],
  reverse: false,
}))

/** Applies a query to tasks. Expression errors are added to `query.errors`. */
export function runQuery(tasks: Task[], query: Query): { groups: ResultGroup[]; total: number } {
  const failed = new Set<string>()
  const guard = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn()
    } catch (err) {
      failed.add(err instanceof Error ? err.message : String(err))
      return fallback
    }
  }

  let found = tasks.filter((task) => query.filters.every((filter) => guard(() => filter(task), false)))
  const sorts = [...query.sorts, ...DEFAULT_SORTS, { value: (task: Task) => task.line, reverse: false }]
  found.sort((a, b) => {
    for (const { value, reverse } of sorts) {
      const [x, y] = [guard(() => value(a), null), guard(() => value(b), null)]
      const order = compareValues(x, y)
      if (order) return reverse && !expr.isEmpty(x) && !expr.isEmpty(y) ? -order : order
    }
    return 0
  })
  if (query.limit !== undefined) found = found.slice(0, query.limit)
  for (const message of failed) query.errors.push(message)

  if (!query.groups.length) return { groups: [{ name: '', tasks: found }], total: found.length }

  // Several `group by` lines nest: the group name is "outer › inner".
  const groups = new Map<string, { tasks: Task[]; keys: unknown[] }>()
  for (const task of found) {
    let combos: { name: string; keys: unknown[] }[] = [{ name: '', keys: [] }]
    for (const grouper of query.groups) {
      const names = guard(() => grouper.names(task), ['Ошибка'])
      combos = combos.flatMap((combo) =>
        names.map((name) => ({
          name: combo.name && name ? `${combo.name} › ${name}` : combo.name || name,
          keys: [...combo.keys, grouper.order ? grouper.order(name) : name],
        })),
      )
    }
    for (const { name, keys } of combos) {
      const group = groups.get(name) ?? { tasks: [], keys }
      groups.set(name, group)
      group.tasks.push(task)
    }
  }
  const ordered = [...groups.entries()].sort(([, a], [, b]) => {
    for (let i = 0; i < query.groups.length; i++) {
      const order = compareValues(a.keys[i], b.keys[i])
      if (order) return query.groups[i].reverse ? -order : order
    }
    return 0
  })
  return { groups: ordered.map(([name, group]) => ({ name: groupTitle(name), tasks: group.tasks })), total: found.length }
}

/** Group names that are dates read better as `16 окт (сегодня)`. */
function groupTitle(name: string): string {
  return name
    .split(' › ')
    .map(visible)
    .filter(Boolean)
    .map((part) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return part
      const note = part === today() ? ' · сегодня' : part < today() ? ' · просрочено' : ''
      return shortDate(part) + note
    })
    .join(' › ')
}
