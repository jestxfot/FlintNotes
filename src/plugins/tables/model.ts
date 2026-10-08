export type Align = 'left' | 'center' | 'right' | null
export type ColumnType = 'text' | 'number' | 'checkbox' | 'date' | 'select'

export interface Column {
  name: string
  align: Align
  type: ColumnType
  /** Choices of a `select` column. */
  options: string[]
}

/**
 * A table as data. Cells hold the text exactly as written between the pipes
 * (with `\|` unescaped): Markdown, `<br>` for a line break, and in extended
 * tables `=formula`, `<` (merged with the cell to the left) and `^` (merged
 * with the cell above).
 */
export interface TableModel {
  columns: Column[]
  rows: string[][]
}

export const COLUMN_TYPES: { type: ColumnType; label: string }[] = [
  { type: 'text', label: 'Текст' },
  { type: 'number', label: 'Число' },
  { type: 'checkbox', label: 'Флажок' },
  { type: 'date', label: 'Дата' },
  { type: 'select', label: 'Список' },
]

/** Splits a table line into cells; `\|` is a literal pipe. */
function splitRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      cell += '|'
      i++
    } else if (text[i] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += text[i]
  }
  cells.push(cell.trim())
  return cells
}

const TYPE_SUFFIX = /^(.*?)\s*\{(text|number|checkbox|date|select)(?::\s*(.*?))?\}$/

/**
 * Reads a pipe table. In an extended table a header may end with a type:
 * `Цена {number}`, `Статус {select: новый, в работе, готово}`.
 */
export function parseTable(source: string, extended: boolean): TableModel | null {
  const lines = source.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return null
  const header = splitRow(lines[0])
  const delimiter = splitRow(lines[1])
  if (!delimiter.every((cell) => /^:?-+:?$/.test(cell))) return null
  const columns = header.map((raw, i): Column => {
    const mark = delimiter[i] ?? '---'
    const align = mark.startsWith(':') && mark.endsWith(':') ? 'center' : mark.endsWith(':') ? 'right' : mark.startsWith(':') ? 'left' : null
    const typed = extended ? TYPE_SUFFIX.exec(raw) : null
    if (!typed) return { name: raw, align, type: 'text', options: [] }
    const options = (typed[3] ?? '').split(',').map((option) => option.trim()).filter(Boolean)
    return { name: typed[1], align, type: typed[2] as ColumnType, options }
  })
  const rows = lines.slice(2).map((line) => {
    const cells = splitRow(line)
    // Every row has exactly as many cells as there are columns.
    return columns.map((_, i) => cells[i] ?? '')
  })
  return { columns, rows }
}

const escape = (cell: string) => cell.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')

/** Writes the table as aligned pipe-table text. */
export function serializeTable(model: TableModel, extended: boolean): string {
  const headers = model.columns.map((column) => {
    if (!extended || column.type === 'text') return escape(column.name)
    const options = column.type === 'select' && column.options.length ? `: ${column.options.join(', ')}` : ''
    return `${escape(column.name)} {${column.type}${options}}`
  })
  const body = model.rows.map((row) => row.map(escape))
  const widths = headers.map((header, i) => Math.max(3, header.length, ...body.map((row) => row[i].length)))
  const line = (cells: string[]) => `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |`
  const delimiter = model.columns.map(({ align }, i) => {
    const dashes = '-'.repeat(widths[i] - (align === 'center' ? 2 : align ? 1 : 0))
    return align === 'center' ? `:${dashes}:` : align === 'right' ? `${dashes}:` : align === 'left' ? `:${dashes}` : dashes
  })
  return [line(headers), line(delimiter), ...body.map(line)].join('\n')
}

export const emptyTable = (): TableModel => ({
  columns: ['Столбец 1', 'Столбец 2'].map((name) => ({ name, align: null, type: 'text', options: [] })),
  rows: [
    ['', ''],
    ['', ''],
  ],
})

/** `A`, `B`, ... `Z`, `AA`: the letter of a column, as in a spreadsheet. */
export function columnLetter(index: number): string {
  let letter = ''
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) letter = String.fromCharCode(65 + (n % 26)) + letter
  return letter
}

export interface Span {
  /** This cell is covered by a merged cell and is not drawn. */
  hidden: boolean
  colSpan: number
  rowSpan: number
}

/**
 * Works out merged cells: `<` joins a cell to its left neighbour, `^` to the
 * one above. The cell they lead to grows to cover them.
 */
export function computeSpans(model: TableModel): Span[][] {
  const spans = model.rows.map((row) => row.map((): Span => ({ hidden: false, colSpan: 1, rowSpan: 1 })))
  // Where each cell's content really lives: itself, or the cell it is merged into.
  const origin = model.rows.map((row, r) => row.map((_, c) => ({ r, c })))
  model.rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      const from = cell === '<' && c > 0 ? origin[r][c - 1] : cell === '^' && r > 0 ? origin[r - 1][c] : null
      if (!from) return
      origin[r][c] = from
      spans[r][c].hidden = true
      const target = spans[from.r][from.c]
      target.colSpan = Math.max(target.colSpan, c - from.c + 1)
      target.rowSpan = Math.max(target.rowSpan, r - from.r + 1)
    }),
  )
  return spans
}
