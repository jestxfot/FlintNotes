import { expr, renderInline, type App } from '../../api'
import { computeTable, type CellValue } from './formulas'
import { showMenu, type MenuItem } from './menu'
import {
  COLUMN_TYPES,
  columnLetter,
  computeSpans,
  emptyTable,
  parseTable,
  serializeTable,
  type Align,
  type ColumnType,
  type TableModel,
} from './model'

export interface TableHost {
  app: App
  /** The note containing the table. */
  path: string
  /** Formulas, column types and merged cells are available (a ```table block). */
  extended: boolean
  setSource(source: string): void
}

/** Row index of the header in cell coordinates. */
const HEADER = -1

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/**
 * An editable table drawn from pipe-table text. Every change is made to the
 * model, written back as text through the host, and the table is redrawn.
 */
export class TableWidget {
  private model: TableModel
  private written: string
  private broken = false
  /** The model has a change (a row added while tabbing) that is not in the text yet. */
  private dirty = false
  /** Ends the edit in progress, optionally continuing in another cell. */
  private finishEdit: ((save: boolean, move?: { r: number; c: number }) => void) | null = null

  constructor(
    private root: HTMLElement,
    private host: TableHost,
    source: string,
  ) {
    this.written = source
    this.model = this.read(source)
    root.classList.add('ft')
    // Leaving a cell redraws the table. A click on another cell would then land
    // on an element that no longer exists, and typing would go to the note
    // instead. So that click is taken over here: the edit is finished and the
    // clicked cell is opened once the table has been redrawn.
    root.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target as Element
        if (!this.finishEdit || event.button !== 0 || target.closest('.ft-editor')) return
        event.preventDefault()
        const cell = target.closest<HTMLElement>('[data-r][data-c]')
        const link = target.closest('a, input')
        this.finishEdit(true, cell && !link ? { r: Number(cell.dataset.r), c: Number(cell.dataset.c) } : undefined)
      },
      true,
    )
    this.render()
  }

  /** The note's text changed; redraw unless it is what this widget just wrote. */
  update(source: string): void {
    if (source === this.written) return
    this.written = source
    this.model = this.read(source)
    this.render()
  }

  private read(source: string): TableModel {
    const model = source.trim() ? parseTable(source, this.host.extended) : emptyTable()
    this.broken = !model
    return model ?? emptyTable()
  }

  private save(): void {
    this.dirty = false
    this.written = serializeTable(this.model, this.host.extended)
    this.host.setSource(this.written)
    this.render()
  }

  // ---- drawing ----

  private render(): void {
    const { model, host } = this
    if (this.broken) {
      this.root.replaceChildren(el('div', 'ft-error', 'Не получается прочитать таблицу. Нужны строка заголовков и строка-разделитель: | --- | --- |'))
      return
    }
    const values = host.extended ? computeTable(model) : null
    const spans = host.extended ? computeSpans(model) : null
    const table = el('table')

    const head = table.appendChild(el('thead')).appendChild(el('tr'))
    if (host.extended) head.append(el('th', 'ft-ref'))
    model.columns.forEach((column, c) => {
      const th = head.appendChild(el('th'))
      th.dataset.r = String(HEADER)
      th.dataset.c = String(c)
      if (column.align) th.style.textAlign = column.align
      if (host.extended) th.append(el('span', 'ft-letter', columnLetter(c)))
      th.append(renderInline(host.app, column.name, host.path))
      if (host.extended && column.type !== 'text') {
        th.append(el('span', 'ft-type', COLUMN_TYPES.find((t) => t.type === column.type)!.label.toLowerCase()))
      }
      th.onclick = (event) => !(event.target as Element).closest('a') && this.edit(HEADER, c)
      th.oncontextmenu = (event) => this.menu(event, HEADER, c)
    })

    const body = table.appendChild(el('tbody'))
    model.rows.forEach((row, r) => {
      const tr = body.appendChild(el('tr'))
      if (host.extended) tr.append(el('th', 'ft-ref', String(r + 1)))
      row.forEach((text, c) => {
        const span = spans?.[r][c]
        if (span?.hidden) return
        const td = tr.appendChild(el('td'))
        td.dataset.r = String(r)
        td.dataset.c = String(c)
        if (span) {
          td.colSpan = span.colSpan
          td.rowSpan = span.rowSpan
        }
        const column = model.columns[c]
        const align = column.align ?? (column.type === 'number' ? 'right' : null)
        if (align) td.style.textAlign = align
        this.fill(td, r, c, values?.(r, c))
        td.oncontextmenu = (event) => this.menu(event, r, c)
      })
    })

    const addRow = el('button', 'ft-add ft-add-row', '+')
    addRow.title = 'Добавить строку'
    addRow.onclick = () => this.insertRow(model.rows.length)
    const addColumn = el('button', 'ft-add ft-add-col', '+')
    addColumn.title = 'Добавить столбец'
    addColumn.onclick = () => this.insertColumn(model.columns.length)

    const scroll = el('div', 'ft-scroll')
    scroll.append(table, addColumn)
    this.root.replaceChildren(scroll, addRow)
  }

  /** Draws a body cell's content, as its column type shows it. */
  private fill(td: HTMLElement, r: number, c: number, computed: CellValue | undefined): void {
    const { model, host } = this
    const text = model.rows[r][c]
    const column = model.columns[c]
    const formula = host.extended && text.startsWith('=')

    if (host.extended && column.type === 'checkbox' && !formula) {
      const box = td.appendChild(el('input'))
      box.type = 'checkbox'
      box.checked = computed?.value === true
      box.onchange = () => this.setCell(r, c, box.checked ? 'x' : '')
      return
    }
    if (formula) {
      td.classList.add('ft-formula')
      td.title = text
      if (computed?.error) {
        td.classList.add('ft-bad')
        td.textContent = '#ОШИБКА'
        td.title = `${text}\n${computed.error}`
      } else if (computed?.value === true || computed?.value === false) td.textContent = computed.value ? '✓' : '—'
      else td.textContent = expr.toText(computed?.value)
    } else td.append(renderInline(host.app, text, host.path))
    td.onclick = (event) => !(event.target as Element).closest('a') && this.edit(r, c)
  }

  // ---- editing ----

  private cellEl(r: number, c: number): HTMLElement | null {
    return this.root.querySelector(`[data-r="${r}"][data-c="${c}"]`)
  }

  private text(r: number, c: number): string {
    return r === HEADER ? this.model.columns[c].name : this.model.rows[r][c]
  }

  private setCell(r: number, c: number, text: string): boolean {
    if (this.text(r, c) === text) return false
    if (r === HEADER) this.model.columns[c].name = text
    else this.model.rows[r][c] = text
    this.save()
    return true
  }

  /** Turns a cell into an input. Enter and Tab save and move on, Escape cancels. */
  private edit(r: number, c: number): void {
    const cell = this.cellEl(r, c)
    const column = this.model.columns[c]
    const current = this.text(r, c)
    // A checkbox cell is changed by ticking it, not by typing.
    const ticked = this.host.extended && r !== HEADER && column.type === 'checkbox' && !current.startsWith('=')
    if (!cell || ticked || cell.querySelector('.ft-editor')) return
    const typed = this.host.extended && r !== HEADER && !current.startsWith('=')
    let input: HTMLTextAreaElement | HTMLSelectElement | HTMLInputElement

    if (typed && column.type === 'select') {
      input = el('select', 'ft-editor')
      for (const option of ['', ...new Set([...column.options, current].filter(Boolean))]) {
        input.append(new Option(option || '—', option, false, option === current))
      }
    } else if (typed && column.type === 'date' && (!current || expr.parseDate(current))) {
      input = el('input', 'ft-editor')
      input.type = 'date'
      input.value = current.slice(0, 10)
    } else {
      const area = (input = el('textarea', 'ft-editor'))
      area.rows = 1
      area.value = current.replace(/<br\s*\/?>/gi, '\n')
      const fit = () => {
        area.style.height = 'auto'
        area.style.height = `${area.scrollHeight}px`
      }
      area.oninput = fit
      queueMicrotask(fit)
    }

    let done = false
    const finish = (save: boolean, move?: { r: number; c: number }) => {
      if (done) return
      done = true
      this.finishEdit = null
      const next = input.value.trim().replace(/\r?\n/g, '<br>')
      // Either way the table is redrawn, which also removes the input.
      if (save && this.setCell(r, c, next)) return void (move && this.edit(move.r, move.c))
      if (this.dirty) this.save()
      else this.render()
      if (move) this.edit(move.r, move.c)
    }
    input.onblur = () => finish(true)
    input.onchange = () => input instanceof HTMLSelectElement && finish(true)
    input.onkeydown = (event) => {
      // Keys typed in a cell must not reach the note's editor around the table.
      event.stopPropagation()
      if (event.key === 'Escape') finish(false)
      else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        finish(true, r !== HEADER && r + 1 < this.model.rows.length ? { r: r + 1, c } : undefined)
      } else if (event.key === 'Tab') {
        event.preventDefault()
        finish(true, this.neighbour(r, c, event.shiftKey ? -1 : 1))
      }
    }
    this.finishEdit = finish
    cell.replaceChildren(input)
    input.focus()
    if (input instanceof HTMLTextAreaElement) input.setSelectionRange(input.value.length, input.value.length)
  }

  /** The next (or previous) cell in reading order. Tab past the last cell adds a row. */
  private neighbour(r: number, c: number, step: 1 | -1): { r: number; c: number } | undefined {
    const columns = this.model.columns.length
    let index = (r + 1) * columns + c + step
    const spans = this.host.extended ? computeSpans(this.model) : null
    // Cells swallowed by a merged cell are skipped.
    while (index >= columns && spans?.[Math.floor(index / columns) - 1]?.[index % columns]?.hidden) index += step
    if (index < 0) return undefined
    const row = Math.floor(index / columns) - 1
    if (row >= this.model.rows.length) {
      // Written to the text together with the cell that is being left.
      this.model.rows.push(this.model.columns.map(() => ''))
      this.dirty = true
    }
    return { r: row, c: index % columns }
  }

  // ---- structure ----

  private insertRow(at: number): void {
    this.model.rows.splice(at, 0, this.model.columns.map(() => ''))
    this.save()
    this.edit(at, 0)
  }

  private insertColumn(at: number): void {
    this.model.columns.splice(at, 0, { name: `Столбец ${this.model.columns.length + 1}`, align: null, type: 'text', options: [] })
    for (const row of this.model.rows) row.splice(at, 0, '')
    this.save()
    this.edit(HEADER, at)
  }

  private change(mutate: () => void): void {
    mutate()
    this.save()
  }

  private moveColumn(from: number, to: number): void {
    const move = <T>(list: T[]) => list.splice(to, 0, list.splice(from, 1)[0])
    this.change(() => {
      move(this.model.columns)
      this.model.rows.forEach(move)
    })
  }

  private sort(c: number, direction: 1 | -1): void {
    const values = this.host.extended ? computeTable(this.model) : null
    const key = (r: number) => values?.(r, c).value ?? this.model.rows[r][c]
    const order = this.model.rows
      .map((row, r) => ({ row, value: key(r) }))
      .sort((a, b) => {
        // Empty cells stay at the bottom either way.
        if (expr.isEmpty(a.value) || expr.isEmpty(b.value)) return Number(expr.isEmpty(a.value)) - Number(expr.isEmpty(b.value))
        return direction * expr.compare(a.value, b.value)
      })
    this.change(() => (this.model.rows = order.map(({ row }) => row)))
  }

  private setType(c: number, type: ColumnType): void {
    const column = this.model.columns[c]
    let options = column.options
    if (type === 'select') {
      // Suggest the values already in the column as the list of choices.
      const used = [...new Set(this.model.rows.map((row) => row[c]).filter((cell) => cell && !cell.startsWith('=')))]
      const answer = prompt('Варианты через запятую', (options.length ? options : used).join(', '))
      if (answer === null) return
      options = answer.split(',').map((option) => option.trim()).filter(Boolean)
    }
    this.change(() => Object.assign(column, { type, options }))
  }

  /** Merges a cell into its neighbour; what was in it moves to the cell that remains. */
  private merge(r: number, c: number, mark: '<' | '^'): void {
    const [tr, tc] = mark === '<' ? [r, c - 1] : [r - 1, c]
    this.change(() => {
      const text = this.model.rows[r][c]
      if (text && text !== '<' && text !== '^') this.model.rows[tr][tc] = [this.model.rows[tr][tc], text].filter(Boolean).join(' ')
      this.model.rows[r][c] = mark
    })
  }

  private unmerge(r: number, c: number): void {
    const span = computeSpans(this.model)[r][c]
    this.change(() => {
      for (let i = r; i < r + span.rowSpan; i++) {
        for (let j = c; j < c + span.colSpan; j++) if (i !== r || j !== c) this.model.rows[i][j] = ''
      }
    })
  }

  private menu(event: MouseEvent, r: number, c: number): void {
    const { model, host } = this
    const column = model.columns[c]
    const align = (value: Align, label: string, separator = false): MenuItem => ({
      label,
      separator,
      checked: column.align === value,
      action: () => this.change(() => (column.align = column.align === value ? null : value)),
    })
    const items: MenuItem[] = []
    if (r !== HEADER) {
      items.push(
        { label: 'Вставить строку выше', action: () => this.insertRow(r) },
        { label: 'Вставить строку ниже', action: () => this.insertRow(r + 1) },
      )
      if (r > 0) items.push({ label: 'Поднять строку', action: () => this.change(() => model.rows.splice(r - 1, 0, model.rows.splice(r, 1)[0])) })
      if (r < model.rows.length - 1) {
        items.push({ label: 'Опустить строку', action: () => this.change(() => model.rows.splice(r + 1, 0, model.rows.splice(r, 1)[0])) })
      }
      items.push({ label: 'Удалить строку', action: () => this.change(() => model.rows.splice(r, 1)) })
    }
    items.push(
      { label: 'Вставить столбец слева', action: () => this.insertColumn(c), separator: r !== HEADER },
      { label: 'Вставить столбец справа', action: () => this.insertColumn(c + 1) },
    )
    if (c > 0) items.push({ label: 'Сдвинуть столбец влево', action: () => this.moveColumn(c, c - 1) })
    if (c < model.columns.length - 1) items.push({ label: 'Сдвинуть столбец вправо', action: () => this.moveColumn(c, c + 1) })
    if (model.columns.length > 1) {
      items.push({
        label: 'Удалить столбец',
        action: () =>
          this.change(() => {
            model.columns.splice(c, 1)
            model.rows.forEach((row) => row.splice(c, 1))
          }),
      })
    }
    items.push(
      { label: 'Сортировать по возрастанию', action: () => this.sort(c, 1), separator: true },
      { label: 'Сортировать по убыванию', action: () => this.sort(c, -1) },
      align('left', 'По левому краю', true),
      align('center', 'По центру'),
      align('right', 'По правому краю'),
    )

    if (host.extended) {
      COLUMN_TYPES.forEach(({ type, label }, i) =>
        items.push({ label: `Тип: ${label.toLowerCase()}`, checked: column.type === type, separator: i === 0, action: () => this.setType(c, type) }),
      )
      if (r !== HEADER) {
        const span = computeSpans(model)[r][c]
        const merged = span.colSpan > 1 || span.rowSpan > 1
        if (c > 0) items.push({ label: 'Объединить с ячейкой слева', separator: true, action: () => this.merge(r, c, '<') })
        if (r > 0) items.push({ label: 'Объединить с ячейкой сверху', separator: c === 0, action: () => this.merge(r, c, '^') })
        if (merged) items.push({ label: 'Разъединить', action: () => this.unmerge(r, c) })
      }
    }
    showMenu(event, items)
  }
}
