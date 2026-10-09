import { moment, type Moment } from '../../api'
import { Dur, Link, parseDate, parseDuration, parseLink } from './values'

/** A mistake in a query or expression; the message is shown in place of the result. */
export class QueryError extends Error {}

export type Node =
  | { type: 'literal'; value: unknown }
  | { type: 'date'; make: () => Moment }
  | { type: 'field'; name: string }
  | { type: 'index'; object: Node; key: Node }
  | { type: 'call'; callee: Node; args: Node[] }
  | { type: 'unary'; op: '!' | '-'; arg: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'lambda'; params: string[]; body: Node }
  | { type: 'list'; items: Node[] }
  | { type: 'object'; entries: [string, Node][] }

export interface Token {
  kind: 'number' | 'string' | 'link' | 'tag' | 'name' | 'op'
  text: string
  from: number
  to: number
}

// Names may contain dashes (`side-dish`), as in Dataview; subtraction needs spaces around the minus.
const TOKEN =
  /\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*")|(!?\[\[[^\]\n]+\]\])|(#[\p{L}\p{N}_/-]+)|([\p{L}_][\p{L}\p{N}_-]*)|(=>|>=|<=|!=|[-+*/%!<>=&|()[\]{},.:]))/uy

export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < source.length) {
    const at = TOKEN.lastIndex
    const m = TOKEN.exec(source)
    if (!m) {
      if (!source.slice(at).trim()) break
      throw new QueryError(`Непонятный символ «${source.slice(at).trim()[0]}»`)
    }
    const kinds: Token['kind'][] = ['number', 'string', 'link', 'tag', 'name', 'op']
    const group = m.slice(1).findIndex((part) => part !== undefined)
    tokens.push({ kind: kinds[group], text: m[group + 1], from: TOKEN.lastIndex - m[group + 1].length, to: TOKEN.lastIndex })
  }
  return tokens
}

/** Text of a quoted string. Only `\\"` and `\\\\` are escapes, so a pattern like "\\d+" needs no doubling. */
export const unquote = (quoted: string) => quoted.slice(1, -1).replace(/\\(["\\])/g, '$1')

/** Dates that have a name: `date(today)`, `date(eom)`. They are worked out when the query runs. */
const NAMED_DATES: Record<string, () => Moment> = {
  now: () => moment(),
  today: () => moment().startOf('day'),
  tomorrow: () => moment().startOf('day').add(1, 'day'),
  yesterday: () => moment().startOf('day').subtract(1, 'day'),
  sow: () => moment().startOf('isoWeek'),
  eow: () => moment().endOf('isoWeek'),
  som: () => moment().startOf('month'),
  eom: () => moment().endOf('month'),
  soy: () => moment().startOf('year'),
  eoy: () => moment().endOf('year'),
}

const PRECEDENCE: Record<string, number> = { or: 1, '|': 1, and: 2, '&': 2, '=': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '%': 5 }
const KEYWORDS: Record<string, unknown> = { true: true, false: false, null: null }

/** Parses Dataview expressions from a run of tokens. */
export class Parser {
  private pos = 0

  constructor(
    private tokens: Token[],
    private source: string,
  ) {}

  get done(): boolean {
    return this.pos >= this.tokens.length
  }

  /** The whole run as one expression. */
  parse(): Node {
    const node = this.expression(0)
    if (!this.done) throw new QueryError(`Лишнее «${this.tokens[this.pos].text}»`)
    return node
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  private isOp(text: string, offset = 0): boolean {
    const token = this.peek(offset)
    return token?.kind === 'op' && token.text === text
  }

  private expect(text: string): void {
    if (!this.isOp(text)) throw new QueryError(`Ожидалось «${text}»`)
    this.pos++
  }

  private operator(): string | undefined {
    const token = this.peek()
    if (token?.kind === 'op' && Object.hasOwn(PRECEDENCE, token.text)) return token.text
    if (token?.kind === 'name' && /^(and|or)$/i.test(token.text)) return token.text.toLowerCase()
  }

  expression(min: number): Node {
    let left = this.unary()
    for (;;) {
      const op = this.operator()
      if (!op || PRECEDENCE[op] < min) return left
      this.pos++
      const right = this.expression(PRECEDENCE[op] + 1)
      left = { type: 'binary', op: op === '&' ? 'and' : op === '|' ? 'or' : op, left, right }
    }
  }

  private unary(): Node {
    if (this.isOp('!')) {
      this.pos++
      return { type: 'unary', op: '!', arg: this.unary() }
    }
    if (this.isOp('-')) {
      this.pos++
      return { type: 'unary', op: '-', arg: this.unary() }
    }
    return this.postfix(this.primary())
  }

  private postfix(node: Node): Node {
    for (;;) {
      if (this.isOp('.')) {
        this.pos++
        const name = this.peek()
        if (name?.kind !== 'name' && name?.kind !== 'number') throw new QueryError('После точки нужно имя поля')
        this.pos++
        node = { type: 'index', object: node, key: { type: 'literal', value: name.kind === 'number' ? Number(name.text) : name.text } }
      } else if (this.isOp('[')) {
        this.pos++
        node = { type: 'index', object: node, key: this.expression(0) }
        this.expect(']')
      } else if (this.isOp('(')) {
        node = this.call(node)
      } else {
        return node
      }
    }
  }

  private call(callee: Node): Node {
    const open = this.peek()!
    this.pos++
    // `date(today)`, `date(2026-10-09)` and `dur(1 day)` take plain text, not an expression.
    if (callee.type === 'field' && /^(date|dur)$/i.test(callee.name)) {
      const close = this.closing()
      const raw = this.source.slice(open.to, this.tokens[close].from).trim()
      const named = callee.name.toLowerCase() === 'date' ? NAMED_DATES[raw.toLowerCase()] : undefined
      const literal = callee.name.toLowerCase() === 'date' ? parseDate(raw) : parseDuration(raw)
      if (named || literal) {
        this.pos = close + 1
        return named ? { type: 'date', make: named } : { type: 'literal', value: literal }
      }
    }
    return { type: 'call', callee, args: this.list(')') }
  }

  /** Index of the bracket that closes the one just opened. */
  private closing(): number {
    let depth = 1
    for (let i = this.pos; i < this.tokens.length; i++) {
      const token = this.tokens[i]
      if (token.kind !== 'op') continue
      if (token.text === '(') depth++
      else if (token.text === ')' && --depth === 0) return i
    }
    throw new QueryError('Не закрыта скобка')
  }

  private list(close: string): Node[] {
    const items: Node[] = []
    if (!this.isOp(close)) {
      do items.push(this.expression(0))
      while (this.isOp(',') && ++this.pos)
    }
    this.expect(close)
    return items
  }

  /** `(x) => ...` or `(x, y) => ...` starting at the current bracket, if that is what follows. */
  private lambda(): Node | null {
    let i = 1
    const params: string[] = []
    while (this.peek(i)?.kind === 'name') {
      params.push(this.peek(i)!.text)
      i++
      if (this.isOp(',', i)) i++
      else break
    }
    if (!this.isOp(')', i) || !this.isOp('=>', i + 1)) return null
    this.pos += i + 2
    return { type: 'lambda', params, body: this.expression(0) }
  }

  private primary(): Node {
    const token = this.peek()
    if (!token) throw new QueryError('Выражение оборвано')
    if (token.kind === 'op' && token.text === '(') {
      const lambda = this.lambda()
      if (lambda) return lambda
      this.pos++
      const node = this.expression(0)
      this.expect(')')
      return node
    }
    this.pos++
    if (token.kind === 'number') return { type: 'literal', value: Number(token.text) }
    if (token.kind === 'string') return { type: 'literal', value: unquote(token.text) }
    if (token.kind === 'link') return { type: 'literal', value: parseLink(token.text) ?? new Link(token.text) }
    if (token.kind === 'tag') return { type: 'literal', value: token.text }
    if (token.kind === 'name') {
      const lower = token.text.toLowerCase()
      return Object.hasOwn(KEYWORDS, lower) ? { type: 'literal', value: KEYWORDS[lower] } : { type: 'field', name: token.text }
    }
    if (token.text === '[') return { type: 'list', items: this.list(']') }
    if (token.text === '{') {
      const entries: [string, Node][] = []
      while (!this.isOp('}')) {
        const key = this.peek()
        if (key?.kind !== 'name' && key?.kind !== 'string') throw new QueryError('В объекте нужен ключ')
        this.pos++
        this.expect(':')
        entries.push([key.kind === 'string' ? unquote(key.text) : key.text, this.expression(0)])
        if (this.isOp(',')) this.pos++
      }
      this.pos++
      return { type: 'object', entries }
    }
    throw new QueryError(`Неожиданное «${token.text}»`)
  }
}

/** Parses one expression from text, e.g. the inside of an inline `= ...`. */
export function parseExpression(source: string): Node {
  return new Parser(tokenize(source), source).parse()
}

