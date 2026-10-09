import { errorMessage, moment, renderInline } from '../../api'
import { evaluate, FUNCTIONS } from './evaluate'
import type { ListItem, Page } from './pages'
import { Parser, parseExpression, tokenize } from './parser'
import { matchSource, parseQuery, runQuery, scopeFor } from './query'
import { PAGE, renderResult, renderTasks, renderValue, type DrawEnv } from './render'
import { compare, equals, Link, parseDate, parseDuration, parseValue, truthy } from './values'

type Key<T> = string | ((item: T, index: number) => unknown)

/**
 * The list type of Dataview scripts: an array with query-like methods, where a
 * field of the list is that field of every item (`pages.file.name`).
 */
export class DataArray<T = any> {
  constructor(public values: T[]) {}

  get length(): number {
    return this.values.length
  }

  private key(key: Key<T> | undefined): (item: T, index: number) => unknown {
    if (key === undefined) return (item) => item
    return typeof key === 'function' ? key : (item) => (item as Record<string, unknown>)?.[key]
  }

  where(predicate: (item: T, index: number) => unknown): DataArray<T> {
    return wrap(this.values.filter((item, i) => truthy(predicate(item, i))))
  }
  filter(predicate: (item: T, index: number) => unknown): DataArray<T> {
    return this.where(predicate)
  }
  map<U>(fn: (item: T, index: number) => U): DataArray<U> {
    return wrap(this.values.map(fn))
  }
  flatMap<U>(fn: (item: T, index: number) => U[] | DataArray<U>): DataArray<U> {
    return wrap(this.values.flatMap((item, i) => unwrap(fn(item, i)) as U[]))
  }
  mutate(fn: (item: T, index: number) => void): DataArray<T> {
    this.values.forEach(fn)
    return wrap(this.values)
  }
  limit(count: number): DataArray<T> {
    return wrap(this.values.slice(0, count))
  }
  slice(start?: number, end?: number): DataArray<T> {
    return wrap(this.values.slice(start, end))
  }
  concat(other: T[] | DataArray<T>): DataArray<T> {
    return wrap(this.values.concat(unwrap(other) as T[]))
  }
  indexOf(value: T): number {
    return this.values.findIndex((item) => equals(item, value))
  }
  includes(value: T): boolean {
    return this.indexOf(value) >= 0
  }
  find(predicate: (item: T, index: number) => unknown): T | undefined {
    return this.values.find((item, i) => truthy(predicate(item, i)))
  }
  findIndex(predicate: (item: T, index: number) => unknown): number {
    return this.values.findIndex((item, i) => truthy(predicate(item, i)))
  }
  join(separator = ', '): string {
    return this.values.join(separator)
  }
  sort(key?: Key<T>, direction: 'asc' | 'desc' = 'asc', order: (a: any, b: any) => number = compare): DataArray<T> {
    const of = this.key(key)
    const keyed = this.values.map((item, i) => ({ item, key: of(item, i) }))
    keyed.sort((a, b) => (direction === 'desc' ? -order(a.key, b.key) : order(a.key, b.key)))
    return wrap(keyed.map((entry) => entry.item))
  }
  sortInPlace(key?: Key<T>, direction: 'asc' | 'desc' = 'asc'): DataArray<T> {
    this.values.splice(0, this.values.length, ...this.sort(key, direction).values)
    return wrap(this.values)
  }
  groupBy(key: Key<T>): DataArray<{ key: unknown; rows: DataArray<T> }> {
    const of = this.key(key)
    const groups: { key: unknown; rows: DataArray<T> }[] = []
    for (const { item, key: value } of this.values.map((item, i) => ({ item, key: of(item, i) })).sort((a, b) => compare(a.key, b.key))) {
      const last = groups[groups.length - 1]
      if (last && equals(last.key, value)) last.rows.values.push(item)
      else groups.push({ key: value, rows: wrap([item]) })
    }
    return wrap(groups)
  }
  distinct(key?: Key<T>): DataArray<T> {
    const of = this.key(key)
    const seen: unknown[] = []
    return wrap(
      this.values.filter((item, i) => {
        const value = of(item, i)
        if (seen.some((other) => equals(other, value))) return false
        seen.push(value)
        return true
      }),
    )
  }
  every(predicate: (item: T, index: number) => unknown): boolean {
    return this.values.every((item, i) => truthy(predicate(item, i)))
  }
  some(predicate: (item: T, index: number) => unknown): boolean {
    return this.values.some((item, i) => truthy(predicate(item, i)))
  }
  none(predicate: (item: T, index: number) => unknown): boolean {
    return !this.some(predicate)
  }
  first(): T | undefined {
    return this.values[0]
  }
  last(): T | undefined {
    return this.values[this.values.length - 1]
  }
  /** The field `key` of every item, with lists among the results merged in. */
  to(key: string): DataArray<unknown> {
    return wrap(this.values.flatMap((item) => {
      const value = unwrap((item as Record<string, unknown>)?.[key])
      return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
    }))
  }
  into(key: string): DataArray<unknown> {
    return wrap<unknown>(this.values.map((item) => (item as Record<string, unknown>)?.[key]).filter((value) => value !== undefined && value !== null))
  }
  /** The items and everything reachable from them through the field `key` (a task and its subtasks). */
  expand(key: string): DataArray<T> {
    const out: T[] = []
    const visit = (items: T[]) => {
      for (const item of items) {
        out.push(item)
        const inner = unwrap((item as Record<string, unknown>)?.[key])
        if (Array.isArray(inner)) visit(inner as T[])
      }
    }
    visit(this.values)
    return wrap(out)
  }
  forEach(fn: (item: T, index: number) => void): void {
    this.values.forEach(fn)
  }
  sum(): unknown {
    return FUNCTIONS.sum(this.values)
  }
  avg(): unknown {
    return FUNCTIONS.average(this.values)
  }
  min(): unknown {
    return FUNCTIONS.min(this.values)
  }
  max(): unknown {
    return FUNCTIONS.max(this.values)
  }
  array(): T[] {
    return [...this.values]
  }
  [Symbol.iterator](): Iterator<T> {
    return this.values[Symbol.iterator]()
  }
}

export function wrap<T>(values: T[]): DataArray<T> {
  return new Proxy(new DataArray(values), {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop, receiver)
      if (/^\d+$/.test(prop)) return target.values[Number(prop)]
      return target.to(prop)
    },
  })
}

const unwrap = (value: unknown): unknown => (value instanceof DataArray ? value.values : value)

type AsyncFn = (...args: unknown[]) => Promise<unknown>
const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => AsyncFn

/** The `dv` object of a script: reads the vault and draws into `container`. */
export function makeDv(env: DrawEnv, container: HTMLElement) {
  const { app, pages, origin } = env
  const resolve = (path: string | Link) => {
    const text = path instanceof Link ? path.path : path
    return app.metadata.resolve(text, origin) ?? (app.vault.get(text)?.kind === 'file' ? text : null)
  }
  const add = (tag: string, content: unknown, options: { cls?: string; attr?: Record<string, string>; container?: HTMLElement } = {}) => {
    const node = (options.container ?? container).appendChild(document.createElement(tag))
    if (options.cls) node.className = options.cls
    for (const [name, value] of Object.entries(options.attr ?? {})) node.setAttribute(name, value)
    const value = unwrap(content)
    if (typeof value === 'string') node.append(renderInline(app, value, origin))
    else if (value !== undefined) node.append(renderValue(env, value))
    return node
  }
  const sourcePaths = (source?: string) => {
    if (!source?.trim()) return app.metadata.notes()
    return [...matchSource(new Parser(tokenize(source), source).parse(), env)]
  }
  const draw = (source: string, target: HTMLElement) => {
    const state = { shown: PAGE, redraw: () => renderResult(env, runQuery(parseQuery(source), env), target, state) }
    state.redraw()
  }

  const dv = {
    container,
    current: () => pages.get(origin),
    pages: (source?: string) => wrap(sourcePaths(source).map((path) => pages.get(path)).filter((page): page is Page => !!page)),
    pagePaths: (source?: string) => wrap(sourcePaths(source)),
    page: (path: string | Link) => {
      const found = resolve(path)
      return found ? pages.get(found) : undefined
    },
    el: add,
    header: (level: number, text: unknown, options?: object) => add(`h${Math.min(6, Math.max(1, level))}`, text, options),
    paragraph: (text: unknown, options?: object) => add('p', text, options),
    span: (text: unknown, options?: object) => add('span', text, options),
    list: (items: unknown) => {
      const list = container.appendChild(document.createElement('ul'))
      list.className = 'dv-list'
      for (const item of (unwrap(items) as unknown[]) ?? []) list.appendChild(document.createElement('li')).append(renderValue(env, unwrap(item)))
      return list
    },
    taskList: (tasks: unknown, groupByFile = true) => {
      const items = ((unwrap(tasks) as ListItem[]) ?? []).filter(Boolean)
      const state = { shown: Infinity, redraw: () => {} }
      const target = container.appendChild(document.createElement('div'))
      if (!groupByFile) target.append(renderTasks(env, items))
      else renderResult(env, { type: 'task', groups: wrap(items).groupBy((task) => task.link).values.map((group) => ({ key: group.key, tasks: group.rows.values })) }, target, state)
      return target
    },
    table: (headers: string[], rows: unknown) => {
      const target = container.appendChild(document.createElement('div'))
      const body = ((unwrap(rows) as unknown[]) ?? []).map((row) => (unwrap(row) as unknown[]).map(unwrap))
      const state = { shown: PAGE, redraw: () => renderResult(env, { type: 'table', headers, rows: body }, target, state) }
      state.redraw()
      return target
    },
    execute: (source: string) => draw(source, container.appendChild(document.createElement('div'))),
    query: async (source: string) => {
      try {
        return { successful: true, value: runQuery(parseQuery(source), env) }
      } catch (err) {
        return { successful: false, error: errorMessage(err) }
      }
    },
    evaluate: (expression: string, row: Record<string, unknown> = pages.get(origin) ?? {}) => {
      try {
        return { successful: true, value: evaluate(parseExpression(expression), scopeFor(env, row)) }
      } catch (err) {
        return { successful: false, error: errorMessage(err) }
      }
    },
    tryEvaluate: (expression: string, row: Record<string, unknown> = pages.get(origin) ?? {}) => evaluate(parseExpression(expression), scopeFor(env, row)),
    /** Runs another script of the vault (`folder/view.js` or `name.js`) with `input`. */
    view: async (path: string, input?: unknown) => {
      const file = [`${path}.js`, `${path}/view.js`].find((candidate) => app.vault.get(candidate))
      if (!file) throw new Error(`Скрипт «${path}» не найден`)
      await new AsyncFunction('dv', 'input', 'app', 'moment', await app.vault.read(file))(dv, input, app, moment)
    },
    io: {
      load: async (path: string | Link) => {
        const found = resolve(path)
        return found ? app.vault.read(found) : undefined
      },
      normalize: (path: string) => resolve(path) ?? path,
    },
    date: (text: unknown) => (typeof text === 'string' ? (FUNCTIONS.date(text) ?? parseDate(text)) : FUNCTIONS.date(text)),
    duration: (text: string) => parseDuration(text),
    parse: parseValue,
    fileLink: (path: string, embed = false, display?: string) => new Link(path, display, embed),
    sectionLink: (path: string, section: string, embed = false, display?: string) => new Link(path, display, embed, section),
    blockLink: (path: string, block: string, embed = false, display?: string) => new Link(path, display, embed, `^${block}`),
    compare,
    equal: equals,
    array: (value: unknown) => (value instanceof DataArray ? value : wrap(Array.isArray(value) ? value : [value])),
    isArray: (value: unknown) => value instanceof DataArray || Array.isArray(value),
    func: FUNCTIONS,
    moment,
  }
  return dv
}

/** Runs a ```dataviewjs block. */
export async function runScript(source: string, env: DrawEnv, container: HTMLElement): Promise<void> {
  const dv = makeDv(env, container)
  await new AsyncFunction('dv', 'app', 'moment', source).call(dv, dv, env.app, moment)
}

/** Works out an inline `$= expression`. */
export async function runInlineScript(source: string, env: DrawEnv, container: HTMLElement): Promise<unknown> {
  const dv = makeDv(env, container)
  return unwrap(await new AsyncFunction('dv', 'app', 'moment', `return (${source}\n)`).call(dv, dv, env.app, moment))
}
