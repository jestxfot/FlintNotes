import { Moment, type App } from '../../api'
import { evaluate, type Scope } from './evaluate'
import type { ListItem, Page, Pages } from './pages'
import { Parser, QueryError, tokenize, unquote, type Node, type Token } from './parser'
import { compare, equals, Link, truthy } from './values'

interface Named {
  expr: Node
  name: string
}

type Step =
  | { type: 'where'; expr: Node }
  | { type: 'sort'; keys: { expr: Node; desc: boolean }[] }
  | { type: 'limit'; expr: Node }
  | ({ type: 'group' } & Named)
  | ({ type: 'flatten' } & Named)

export interface Query {
  type: 'table' | 'list' | 'task' | 'calendar'
  withoutId: boolean
  fields: Named[]
  source: Node | null
  steps: Step[]
}

export type Result =
  | { type: 'table'; headers: string[]; rows: unknown[][] }
  | { type: 'list'; items: unknown[] }
  | { type: 'task'; groups: { key: unknown; tasks: ListItem[] }[] }
  | { type: 'calendar'; days: Map<string, Link[]> }

const CLAUSES = new Set(['from', 'where', 'sort', 'flatten', 'limit', 'group'])
const OPEN = new Set(['(', '[', '{'])
const CLOSE = new Set([')', ']', '}'])

const isName = (token: Token | undefined, ...words: string[]) => token?.kind === 'name' && words.includes(token.text.toLowerCase())

/** Cuts tokens into pieces at `separator` tokens that are outside any brackets. */
function split(tokens: Token[], separator: (token: Token, index: number) => boolean): Token[][] {
  const parts: Token[][] = [[]]
  let depth = 0
  tokens.forEach((token, i) => {
    if (token.kind === 'op' && OPEN.has(token.text)) depth++
    if (token.kind === 'op' && CLOSE.has(token.text)) depth--
    if (depth === 0 && separator(token, i)) parts.push([])
    else parts[parts.length - 1].push(token)
  })
  return parts
}

/** Reads a query: `TABLE a, b AS "B" FROM "folder" WHERE ... SORT ... GROUP BY ...`. */
export function parseQuery(source: string): Query {
  const tokens = tokenize(source)
  const head = tokens[0]
  if (!isName(head, 'table', 'list', 'task', 'calendar')) throw new QueryError('Запрос начинается с TABLE, LIST, TASK или CALENDAR')
  const type = head.text.toLowerCase() as Query['type']

  // The query is a header followed by clauses; each clause starts with its keyword.
  const starts: number[] = []
  let depth = 0
  tokens.forEach((token, i) => {
    if (token.kind === 'op' && OPEN.has(token.text)) depth++
    if (token.kind === 'op' && CLOSE.has(token.text)) depth--
    if (i === 0 || depth !== 0 || token.kind !== 'name' || !CLAUSES.has(token.text.toLowerCase())) return
    // A field after a dot (`file.from`) or `GROUP` without `BY` is not a keyword.
    if (tokens[i - 1].kind === 'op' && tokens[i - 1].text === '.') return
    if (token.text.toLowerCase() === 'group' && !isName(tokens[i + 1], 'by')) return
    starts.push(i)
  })
  const expr = (part: Token[], what: string): Node => {
    if (!part.length) throw new QueryError(`После ${what} нужно выражение`)
    return new Parser(part, source).parse()
  }
  const text = (part: Token[]) => source.slice(part[0].from, part[part.length - 1].to)
  /** `expr AS name`; without a name the expression's own text is the name. */
  const named = (part: Token[], what: string): Named => {
    const [value, alias] = split(part, (token) => isName(token, 'as'))
    if (!alias) return { expr: expr(value, what), name: value.length ? text(value) : '' }
    const label = alias[0]
    if (alias.length !== 1 || (label.kind !== 'string' && label.kind !== 'name')) throw new QueryError('После AS нужно имя')
    return { expr: expr(value, what), name: label.kind === 'string' ? unquote(label.text) : label.text }
  }

  let header = tokens.slice(1, starts[0] ?? tokens.length)
  const withoutId = isName(header[0], 'without') && isName(header[1], 'id')
  if (withoutId) header = header.slice(2)
  const query: Query = { type, withoutId, fields: [], source: null, steps: [] }
  if (header.length) {
    if (type === 'task') throw new QueryError('У TASK нет полей')
    query.fields = split(header, (token) => token.kind === 'op' && token.text === ',').map((part) => named(part, 'запятой'))
    if (type !== 'table' && query.fields.length > 1) throw new QueryError(`У ${head.text.toUpperCase()} может быть только одно выражение`)
  }
  if (type === 'calendar' && !query.fields.length) throw new QueryError('CALENDAR нужно поле с датой: CALENDAR file.day')

  starts.forEach((start, n) => {
    const word = tokens[start].text.toLowerCase()
    const body = tokens.slice(start + (word === 'group' ? 2 : 1), starts[n + 1] ?? tokens.length)
    const label = tokens[start].text.toUpperCase()
    if (word === 'from') {
      if (n > 0) throw new QueryError('FROM идёт сразу после полей')
      query.source = expr(body, label)
    } else if (word === 'where') query.steps.push({ type: 'where', expr: expr(body, label) })
    else if (word === 'limit') query.steps.push({ type: 'limit', expr: expr(body, label) })
    else if (word === 'group') query.steps.push({ type: 'group', ...named(body, 'GROUP BY') })
    else if (word === 'flatten') query.steps.push({ type: 'flatten', ...named(body, label) })
    else {
      const keys = split(body, (token) => token.kind === 'op' && token.text === ',').map((part) => {
        const direction = part[part.length - 1]
        const hasDirection = isName(direction, 'asc', 'ascending', 'desc', 'descending')
        return { expr: expr(hasDirection ? part.slice(0, -1) : part, label), desc: hasDirection && direction.text.toLowerCase().startsWith('desc') }
      })
      query.steps.push({ type: 'sort', keys })
    }
  })
  return query
}

export interface Env {
  app: App
  pages: Pages
  /** The note the query is written in. */
  origin: string
}

const noteOf = (env: Env, link: Link): string | null => (!link.path || link.path === '#' ? env.origin : env.app.metadata.resolve(link.path, env.origin))

/** Paths of the notes a FROM source names: a folder, a tag, links to or from a note, and their combinations. */
export function matchSource(node: Node, env: Env): Set<string> {
  const { metadata } = env.app
  const all = metadata.notes()
  switch (node.type) {
    case 'literal': {
      if (node.value instanceof Link) {
        const target = noteOf(env, node.value)
        return new Set(target ? metadata.backlinks(target).keys() : [])
      }
      const value = String(node.value ?? '')
      if (value.startsWith('#')) {
        const tag = value.slice(1).toLowerCase()
        return new Set(all.filter((path) => metadata.get(path)!.tags.some((own) => own.toLowerCase() === tag || own.toLowerCase().startsWith(`${tag}/`))))
      }
      const folder = value.replace(/^\/+|\/+$/g, '')
      if (!folder) return new Set(all)
      const exact = all.filter((path) => path.startsWith(`${folder}/`) || path === folder || path === `${folder}.md`)
      // A folder moved deeper since the query was written is still found by its name.
      return new Set(exact.length ? exact : all.filter((path) => `/${path}`.includes(`/${folder}/`)))
    }
    case 'call': {
      const arg = node.args[0]
      if (node.callee.type === 'field' && node.callee.name.toLowerCase() === 'outgoing' && arg?.type === 'literal' && arg.value instanceof Link) {
        const from = noteOf(env, arg.value)
        return new Set(from ? metadata.resolvedLinks.get(from)?.keys() : [])
      }
      break
    }
    case 'unary': {
      const without = matchSource(node.arg, env)
      return new Set(all.filter((path) => !without.has(path)))
    }
    case 'binary': {
      if (node.op !== 'and' && node.op !== 'or') break
      const [left, right] = [matchSource(node.left, env), matchSource(node.right, env)]
      return node.op === 'or' ? new Set([...left, ...right]) : new Set([...left].filter((path) => right.has(path)))
    }
  }
  throw new QueryError('В FROM могут быть папка в кавычках, #тег, [[ссылка]], outgoing([[ссылка]]) и их сочетания через AND, OR и «-»')
}

/** The list item a task row was made from. */
const ITEM = Symbol('item')
type Row = Record<string | symbol, unknown>

export function scopeFor(env: Env, row: Record<string, unknown>): Scope {
  return {
    row,
    self: env.pages.get(env.origin),
    page: (link) => {
      const path = noteOf(env, link)
      return path ? env.pages.get(path) : undefined
    },
  }
}

/** Runs a query over the vault. */
export function runQuery(query: Query, env: Env): Result {
  const paths = query.source ? [...matchSource(query.source, env)] : env.app.metadata.notes()
  const pages = paths.map((path) => env.pages.get(path)).filter((page): page is Page => !!page)
  const value = (expr: Node, row: Row) => evaluate(expr, scopeFor(env, row as Record<string, unknown>))

  let rows: Row[] = pages
  if (query.type === 'task') {
    // A task is a row with its own fields on top of those of its note, so `WHERE !completed AND file.name = ...` works.
    rows = pages.flatMap((page) => (page.file.tasks as ListItem[]).map((task) => ({ ...page, ...task, [ITEM]: task })))
  } else {
    rows.sort((a, b) => compare((a as Page).file.path, (b as Page).file.path))
  }
  let grouped = false

  for (const step of query.steps) {
    if (step.type === 'where') {
      rows = rows.filter((row) => {
        try {
          return truthy(value(step.expr, row))
        } catch (err) {
          // A row the condition cannot be worked out for does not match, as in Dataview.
          if (err instanceof QueryError) return false
          throw err
        }
      })
    } else if (step.type === 'sort') {
      const keyed = rows.map((row) => ({ row, keys: step.keys.map((key) => value(key.expr, row)) }))
      keyed.sort((a, b) => {
        for (let i = 0; i < step.keys.length; i++) {
          const order = compare(a.keys[i], b.keys[i])
          if (order) return step.keys[i].desc ? -order : order
        }
        return 0
      })
      rows = keyed.map((entry) => entry.row)
    } else if (step.type === 'limit') {
      const limit = value(step.expr, {})
      if (typeof limit !== 'number') throw new QueryError('LIMIT нужно число')
      rows = rows.slice(0, Math.max(0, limit))
    } else if (step.type === 'flatten') {
      rows = rows.flatMap((row) => {
        const list = value(step.expr, row)
        return (Array.isArray(list) ? list : [list]).map((item) => ({ ...row, [step.name]: item }))
      })
    } else {
      const keyed = rows.map((row) => ({ row, key: value(step.expr, row) }))
      keyed.sort((a, b) => compare(a.key, b.key))
      const groups: Row[] = []
      for (const { row, key } of keyed) {
        const last = groups[groups.length - 1]
        if (last && equals(last.key, key)) (last.rows as Row[]).push(row)
        else groups.push({ key, rows: [row], [step.name]: key })
      }
      rows = groups
      grouped = true
    }
  }

  const id = (row: Row) => (grouped ? row.key : ((row as Page).file?.link ?? null))
  switch (query.type) {
    case 'table':
      return {
        type: 'table',
        headers: [...(query.withoutId ? [] : [grouped ? 'Группа' : 'Файл']), ...query.fields.map((field) => field.name)],
        rows: rows.map((row) => [...(query.withoutId ? [] : [id(row)]), ...query.fields.map((field) => value(field.expr, row))]),
      }
    case 'list': {
      const field = query.fields[0]
      return {
        type: 'list',
        // With a value, a row reads "note: value"; a pair of these is drawn that way.
        items: rows.map((row) => (!field ? id(row) : query.withoutId ? value(field.expr, row) : { id: id(row), value: value(field.expr, row), [PAIR]: true })),
      }
    }
    case 'task': {
      const items = (list: Row[]) => list.map((row) => row[ITEM] as ListItem).filter(Boolean)
      return { type: 'task', groups: grouped ? rows.map((row) => ({ key: row.key, tasks: items(row.rows as Row[]) })) : [{ key: null, tasks: items(rows) }] }
    }
    case 'calendar': {
      const days = new Map<string, Link[]>()
      for (const row of rows) {
        const date = value(query.fields[0].expr, row)
        const link = (row as Page).file?.link
        if (!(date instanceof Moment) || !(link instanceof Link)) continue
        const key = date.format('YYYY-MM-DD')
        days.set(key, [...(days.get(key) ?? []), link])
      }
      return { type: 'calendar', days }
    }
  }
}

/** Marks a list row that has both a note and a value. */
export const PAIR = Symbol('pair')
