import { ExprError, parse, type Node } from './parser'
import {
  addDuration,
  compare,
  Duration,
  equal,
  FileRef,
  formatDate,
  isEmpty,
  isoDate,
  Link,
  parseDate,
  parseDuration,
  toText,
  truthy,
  typeOf,
} from './values'

export type Fn = (...args: unknown[]) => unknown

/** Where an expression's names come from. */
export interface Scope {
  /** Value of a name; `undefined` if this scope does not know it. */
  get(name: string): unknown
  /** Functions available in addition to the built-in ones. */
  functions?: Record<string, Fn>
}

// Tables are looked up by names taken from expressions, so inherited members
// such as `constructor` must never be found.
const own = <T>(table: Record<string, T> | undefined, key: string): T | undefined =>
  table && Object.hasOwn(table, key) ? table[key] : undefined

const num = (value: unknown, what = 'Аргумент'): number => {
  if (typeof value !== 'number') throw new ExprError(`${what}: нужно число`)
  return value
}
const str = (value: unknown): string => (typeof value === 'string' ? value : toText(value))
const numbers = (list: unknown[]) => list.flat(Infinity).filter((v): v is number => typeof v === 'number')
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)
const toRegExp = (pattern: unknown) => (pattern instanceof RegExp ? pattern : null)

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  return typeof value === 'string' ? parseDate(value) : null
}

function toDuration(value: unknown): Duration | null {
  if (value instanceof Duration) return value
  return typeof value === 'string' ? parseDuration(value) : null
}

const relative = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' })

function relativeDate(date: Date): string {
  const seconds = (date.getTime() - Date.now()) / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return relative.format(Math.round(seconds), 'second')
}

const GLOBALS: Record<string, Fn> = {
  date: (value) => toDate(value),
  duration: (value) => toDuration(value),
  now: () => new Date(),
  today: () => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  },
  number: (value) => {
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'boolean') return Number(value)
    const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
    return Number.isNaN(n) ? null : n
  },
  max: (...values) => (numbers(values).length ? Math.max(...numbers(values)) : null),
  min: (...values) => (numbers(values).length ? Math.min(...numbers(values)) : null),
  list: (value) => (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]),
  link: (target, display) =>
    new Link(target instanceof FileRef ? target.path : str(target), display === undefined ? undefined : str(display)),
  random: () => Math.random(),
  escapeHTML: (value) =>
    str(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!),
}

type Method = (self: any, ...args: any[]) => unknown

const ANY: Record<string, Method> = {
  isTruthy: (self) => truthy(self),
  isEmpty: (self) => isEmpty(self),
  isType: (self, type) => typeOf(self) === type,
  toString: (self: unknown) => toText(self),
}

const METHODS: Record<string, Record<string, Method>> = {
  string: {
    contains: (s: string, value) => s.toLowerCase().includes(str(value).toLowerCase()),
    containsAll: (s: string, ...values) => values.every((v) => s.toLowerCase().includes(str(v).toLowerCase())),
    containsAny: (s: string, ...values) => values.some((v) => s.toLowerCase().includes(str(v).toLowerCase())),
    startsWith: (s: string, value) => s.startsWith(str(value)),
    endsWith: (s: string, value) => s.endsWith(str(value)),
    lower: (s: string) => s.toLowerCase(),
    upper: (s: string) => s.toUpperCase(),
    title: (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_, space, letter) => space + letter.toUpperCase()),
    trim: (s: string) => s.trim(),
    reverse: (s: string) => [...s].reverse().join(''),
    repeat: (s: string, count) => s.repeat(Math.max(0, num(count))),
    slice: (s: string, start, end) => s.slice(num(start), end ?? undefined),
    split: (s: string, separator, limit) => s.split(toRegExp(separator) ?? str(separator), limit ?? undefined),
    replace: (s: string, pattern, replacement) => s.replaceAll(toRegExp(pattern) ?? str(pattern), str(replacement)),
  },
  number: {
    abs: (n: number) => Math.abs(n),
    ceil: (n: number) => Math.ceil(n),
    floor: (n: number) => Math.floor(n),
    round: (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits,
    toFixed: (n: number, digits = 0) => n.toFixed(num(digits)),
  },
  date: {
    date: (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    time: (d: Date) => formatDate(d, 'HH:mm:ss'),
    format: (d: Date, format) => formatDate(d, str(format)),
    relative: (d: Date) => relativeDate(d),
  },
  list: {
    contains: (list: unknown[], value) => list.some((item) => equal(item, value)),
    containsAll: (list: unknown[], ...values) => values.every((v) => list.some((item) => equal(item, v))),
    containsAny: (list: unknown[], ...values) => values.some((v) => list.some((item) => equal(item, v))),
    flat: (list: unknown[]) => list.flat(),
    join: (list: unknown[], separator = ', ') => list.map(toText).join(str(separator)),
    reverse: (list: unknown[]) => [...list].reverse(),
    slice: (list: unknown[], start, end) => list.slice(num(start), end ?? undefined),
    sort: (list: unknown[]) => [...list].sort(compare),
    unique: (list: unknown[]) => list.filter((item, i) => list.findIndex((other) => equal(other, item)) === i),
    sum: (list: unknown[]) => sum(numbers(list)),
    mean: (list: unknown[]) => (numbers(list).length ? sum(numbers(list)) / numbers(list).length : null),
    min: (list: unknown[]) => [...list].filter((v) => !isEmpty(v)).sort(compare)[0] ?? null,
    max: (list: unknown[]) => [...list].filter((v) => !isEmpty(v)).sort(compare).at(-1) ?? null,
    median: (list: unknown[]) => {
      const sorted = numbers(list).sort((a, b) => a - b)
      const mid = sorted.length >> 1
      return sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : null
    },
  },
  link: {
    asFile: () => null,
    linksTo: (link: Link, file) => file instanceof FileRef && file.info.resolve(link.target) === file.path,
  },
  file: {
    asLink: (file: FileRef, display) => new Link(file.path, display === undefined ? undefined : str(display)),
    hasTag: (file: FileRef, ...tags) => {
      const own = file.info.tags().map((tag) => tag.toLowerCase())
      // A tag also matches its nested tags: `book` finds `book/fiction`.
      return tags.some((tag) => {
        const wanted = str(tag).replace(/^#/, '').toLowerCase()
        return own.some((t) => t === wanted || t.startsWith(`${wanted}/`))
      })
    },
    hasProperty: (file: FileRef, name) => str(name) in file.info.properties(),
    inFolder: (file: FileRef, folder) => {
      const wanted = str(folder).replace(/^\/|\/$/g, '').toLowerCase()
      const own = file.folder.toLowerCase()
      return !wanted || own === wanted || own.startsWith(`${wanted}/`)
    },
    hasLink: (file: FileRef, other) => {
      const target = other instanceof FileRef ? other.path : other instanceof Link ? other.target : str(other)
      const wanted = file.info.resolve(target) ?? target
      if (file.info.linksTo) return file.info.linksTo(wanted)
      return file.info.links().some((link) => (file.info.resolve(link.target) ?? link.target) === wanted)
    },
  },
  object: {
    keys: (object: object) => Object.keys(object),
    values: (object: object) => Object.values(object),
  },
}

const FIELDS: Record<string, Record<string, (self: any) => unknown>> = {
  string: { length: (s: string) => s.length },
  list: { length: (list: unknown[]) => list.length },
  date: {
    year: (d: Date) => d.getFullYear(),
    month: (d: Date) => d.getMonth() + 1,
    day: (d: Date) => d.getDate(),
    hour: (d: Date) => d.getHours(),
    minute: (d: Date) => d.getMinutes(),
    second: (d: Date) => d.getSeconds(),
    millisecond: (d: Date) => d.getMilliseconds(),
  },
  file: {
    file: (file: FileRef) => file,
    name: (file: FileRef) => file.name,
    basename: (file: FileRef) => file.basename,
    path: (file: FileRef) => file.path,
    folder: (file: FileRef) => file.folder,
    ext: (file: FileRef) => file.ext,
    size: (file: FileRef) => file.info.size,
    ctime: (file: FileRef) => new Date(file.info.ctime),
    mtime: (file: FileRef) => new Date(file.info.mtime),
    tags: (file: FileRef) => file.info.tags(),
    links: (file: FileRef) => file.info.links(),
    backlinks: (file: FileRef) => file.info.backlinks(),
    embeds: (file: FileRef) => [],
    properties: (file: FileRef) => file.info.properties(),
  },
  link: {
    path: (link: Link) => link.target,
    display: (link: Link) => link.display ?? null,
  },
}

function field(object: unknown, name: string): unknown {
  const type = typeOf(object)
  const known = own(FIELDS[type], name)
  if (known) return known(object)
  if (type === 'object') return own(object as Record<string, unknown>, name) ?? null
  // A file's own properties read like fields: `this.status`.
  if (type === 'file') return own((object as FileRef).info.properties(), name) ?? null
  return null
}

function binary(op: string, a: unknown, b: unknown): unknown {
  switch (op) {
    case '==':
      return equal(a, b)
    case '!=':
      return !equal(a, b)
    case '<':
    case '>':
    case '<=':
    case '>=': {
      if (isEmpty(a) || isEmpty(b) || typeOf(a) !== typeOf(b)) return false
      const order = compare(a, b)
      return op === '<' ? order < 0 : op === '>' ? order > 0 : op === '<=' ? order <= 0 : order >= 0
    }
    case '+': {
      if (typeof a === 'number' && typeof b === 'number') return a + b
      const duration = toDuration(b)
      if (a instanceof Date && duration) return addDuration(a, duration)
      if (a instanceof Duration && b instanceof Duration) return new Duration(a.months + b.months, a.ms + b.ms)
      if (isEmpty(a) && typeof b === 'number') return b
      if (typeof a === 'number' && isEmpty(b)) return a
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]
      return toText(a) + toText(b)
    }
    case '-': {
      if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
      const duration = toDuration(b)
      if (a instanceof Date && duration) return addDuration(a, duration, -1)
      break
    }
  }
  // Arithmetic on a missing value gives a missing value instead of an error.
  if (isEmpty(a) || isEmpty(b)) return null
  if (typeof a !== 'number' || typeof b !== 'number') throw new ExprError(`Операция «${op}» работает только с числами`)
  if (op === '-') return a - b
  if (op === '*') return a * b
  if (op === '/') return b === 0 ? null : a / b
  if (op === '%') return b === 0 ? null : a % b
  throw new ExprError(`Неизвестная операция «${op}»`)
}

/** Runs `fn` with extra names (`value`, `index`, `acc`) visible to the expression. */
const withLocals = (scope: Scope, locals: Record<string, unknown>): Scope => ({
  functions: scope.functions,
  get: (name) => (Object.hasOwn(locals, name) ? locals[name] : scope.get(name)),
})

// These take an expression, not a value: it is evaluated once per list item.
const LAZY_LIST: Record<string, (list: unknown[], body: Node, scope: Scope, rest: Node[]) => unknown> = {
  filter: (list, body, scope) => list.filter((value, index) => truthy(run(body, withLocals(scope, { value, index })))),
  map: (list, body, scope) => list.map((value, index) => run(body, withLocals(scope, { value, index }))),
  reduce: (list, body, scope, rest) =>
    list.reduce(
      (acc, value, index) => run(body, withLocals(scope, { acc, value, index })),
      rest[0] ? run(rest[0], scope) : null,
    ),
}

function call(node: Extract<Node, { type: 'call' }>, scope: Scope): unknown {
  const { callee, args } = node
  if (callee.type === 'ident') {
    // Only the chosen branch of `if` is evaluated, so the other one may be invalid for this row.
    if (callee.name === 'if') {
      const branch = truthy(run(args[0], scope)) ? args[1] : args[2]
      return branch ? run(branch, scope) : null
    }
    const fn = own(scope.functions, callee.name) ?? own(GLOBALS, callee.name)
    if (!fn) throw new ExprError(`Нет функции «${callee.name}»`)
    return fn(...args.map((arg) => run(arg, scope)))
  }
  if (callee.type !== 'member') throw new ExprError('Это нельзя вызвать')
  const self = run(callee.object, scope)
  const type = typeOf(self)
  const name = callee.property
  const lazy = type === 'list' ? own(LAZY_LIST, name) : undefined
  if (lazy && args[0]) return lazy(self as unknown[], args[0], scope, args.slice(1))
  const method = own(METHODS[type], name) ?? own(ANY, name)
  // A method of a missing value gives a missing value: most rows lack most properties.
  if (!method) {
    if (type === 'null') return null
    throw new ExprError(`У значения типа ${type} нет метода «${name}»`)
  }
  return method(self, ...args.map((arg) => run(arg, scope)))
}

function run(node: Node, scope: Scope): unknown {
  switch (node.type) {
    case 'literal':
      return node.value
    case 'ident':
      return scope.get(node.name) ?? null
    case 'list':
      return node.items.map((item) => run(item, scope))
    case 'member':
      return field(run(node.object, scope), node.property)
    case 'index': {
      const object = run(node.object, scope)
      const index = run(node.index, scope)
      if (Array.isArray(object)) return object.at(num(index, 'Индекс')) ?? null
      return field(object, str(index))
    }
    case 'unary': {
      const value = run(node.arg, scope)
      if (node.op === '!') return !truthy(value)
      return isEmpty(value) ? null : -num(value, 'Минус')
    }
    case 'binary': {
      if (node.op === '&&') return truthy(run(node.left, scope)) && truthy(run(node.right, scope))
      if (node.op === '||') return truthy(run(node.left, scope)) || truthy(run(node.right, scope))
      return binary(node.op, run(node.left, scope), run(node.right, scope))
    }
    case 'call':
      return call(node, scope)
  }
}

/** Evaluates an expression (source text or parsed tree) against a scope. */
export function evaluate(expression: string | Node, scope: Scope): unknown {
  return run(typeof expression === 'string' ? parse(expression) : expression, scope)
}

export { isoDate }
