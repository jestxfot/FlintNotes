/** An error in an expression's syntax or in its evaluation; the message is shown to the user. */
export class ExprError extends Error {}

export type Node =
  | { type: 'literal'; value: unknown }
  | { type: 'ident'; name: string }
  | { type: 'member'; object: Node; property: string }
  | { type: 'index'; object: Node; index: Node }
  | { type: 'call'; callee: Node; args: Node[] }
  | { type: 'unary'; op: '!' | '-'; arg: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'list'; items: Node[] }

interface Token {
  kind: 'number' | 'string' | 'name' | 'op'
  text: string
}

// Names may use any letters, so properties can be called `цена` or `срок`.
const TOKEN =
  /\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([\p{L}_$][\p{L}\p{N}_$]*)|(==|!=|>=|<=|&&|\|\||[-+*/%!<>()[\],.]))/uy

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < source.length) {
    const at = TOKEN.lastIndex
    const m = TOKEN.exec(source)
    if (!m) {
      if (!source.slice(at).trim()) break
      throw new ExprError(`Непонятный символ «${source.slice(at).trim()[0]}»`)
    }
    if (m[1]) tokens.push({ kind: 'number', text: m[1] })
    else if (m[2]) tokens.push({ kind: 'string', text: m[2] })
    else if (m[3]) tokens.push({ kind: 'name', text: m[3] })
    else tokens.push({ kind: 'op', text: m[4] })
  }
  return tokens
}

const unquote = (text: string) =>
  text.slice(1, -1).replace(/\\(.)/g, (_, char) => (char === 'n' ? '\n' : char === 't' ? '\t' : char))

// Binding strength of binary operators; a higher number binds tighter.
const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}

const KEYWORDS: Record<string, unknown> = { true: true, false: false, null: null }

class Parser {
  private pos = 0

  constructor(private tokens: Token[]) {}

  parse(): Node {
    const node = this.expression(0)
    if (this.pos < this.tokens.length) throw new ExprError(`Лишнее «${this.tokens[this.pos].text}»`)
    return node
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private isOp(text: string): boolean {
    const token = this.peek()
    return token?.kind === 'op' && token.text === text
  }

  private expect(text: string): void {
    if (!this.isOp(text)) throw new ExprError(`Ожидалось «${text}»`)
    this.pos++
  }

  /** Precedence climbing: parses operators that bind at least as tightly as `min`. */
  private expression(min: number): Node {
    let left = this.unary()
    for (;;) {
      const token = this.peek()
      const precedence = token?.kind === 'op' ? PRECEDENCE[token.text] : undefined
      if (precedence === undefined || precedence < min) return left
      this.pos++
      left = { type: 'binary', op: token!.text, left, right: this.expression(precedence + 1) }
    }
  }

  private unary(): Node {
    for (const op of ['!', '-'] as const) {
      if (this.isOp(op)) {
        this.pos++
        return { type: 'unary', op, arg: this.unary() }
      }
    }
    return this.postfix(this.primary())
  }

  private postfix(node: Node): Node {
    for (;;) {
      if (this.isOp('.')) {
        this.pos++
        const name = this.peek()
        if (name?.kind !== 'name') throw new ExprError('После точки нужно имя')
        this.pos++
        node = { type: 'member', object: node, property: name.text }
      } else if (this.isOp('[')) {
        this.pos++
        node = { type: 'index', object: node, index: this.expression(0) }
        this.expect(']')
      } else if (this.isOp('(')) {
        this.pos++
        node = { type: 'call', callee: node, args: this.list(')') }
      } else {
        return node
      }
    }
  }

  /** Comma-separated expressions up to and including the closing bracket. */
  private list(close: string): Node[] {
    const items: Node[] = []
    if (!this.isOp(close)) {
      do items.push(this.expression(0))
      while (this.isOp(',') && ++this.pos)
    }
    this.expect(close)
    return items
  }

  private primary(): Node {
    const token = this.peek()
    if (!token) throw new ExprError('Выражение оборвано')
    this.pos++
    if (token.kind === 'number') return { type: 'literal', value: Number(token.text) }
    if (token.kind === 'string') return { type: 'literal', value: unquote(token.text) }
    if (token.kind === 'name') {
      return Object.hasOwn(KEYWORDS, token.text)
        ? { type: 'literal', value: KEYWORDS[token.text] }
        : { type: 'ident', name: token.text }
    }
    if (token.text === '(') {
      const node = this.expression(0)
      this.expect(')')
      return node
    }
    if (token.text === '[') return { type: 'list', items: this.list(']') }
    throw new ExprError(`Неожиданное «${token.text}»`)
  }
}

const cache = new Map<string, Node>()

/** Parses an expression into a syntax tree. Trees are cached by source text. */
export function parse(source: string): Node {
  let node = cache.get(source)
  if (!node) cache.set(source, (node = new Parser(tokenize(source)).parse()))
  return node
}
