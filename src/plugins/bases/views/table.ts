import { expr, path as paths } from '../../../api'
import { h } from '../dom'
import { noteKey, type Row } from '../engine'
import { renderValue } from '../format'
import { groupTitle, isGrouped, type ViewContext, type ViewRenderer } from './shared'

type Kind = 'boolean' | 'number' | 'date' | 'list' | 'text'

function kindOf(value: unknown): Kind | null {
  const type = expr.typeOf(value)
  if (type === 'null') return null
  return type === 'boolean' || type === 'number' || type === 'date' || type === 'list' ? type : 'text'
}

/** The kind of values a column holds, judged by its first filled cell. */
function columnKind(ctx: ViewContext, property: string): Kind {
  for (const row of ctx.result.rows) {
    const kind = kindOf(ctx.engine.value(row, property))
    if (kind) return kind
  }
  return 'text'
}

function parseInput(text: string, kind: Kind): unknown {
  const value = text.trim()
  if (!value) return undefined
  if (kind === 'number') {
    const n = Number(value.replace(',', '.'))
    return Number.isNaN(n) ? value : n
  }
  if (kind === 'list') return value.split(',').map((item) => item.trim()).filter(Boolean)
  return value
}

/** Replaces a cell's content with an input; Enter or leaving saves, Escape cancels. */
function edit(ctx: ViewContext, cell: HTMLElement, row: Row, key: string, kind: Kind): void {
  const current = row.props[key]
  const text =
    current instanceof Date ? expr.isoDate(current) : Array.isArray(current) ? current.map(expr.toText).join(', ') : expr.toText(current)
  const dateTime = kind === 'date' && text.includes(':')
  const input = h('input', {
    class: 'base-input',
    type: kind === 'date' ? (dateTime ? 'datetime-local' : 'date') : 'text',
    value: dateTime ? text.replace(' ', 'T') : text,
  })
  let done = false
  const finish = (save: boolean) => {
    if (done) return
    done = true
    const next = parseInput(input.value.replace('T', ' '), kind)
    const before = parseInput(text, kind)
    if (save && JSON.stringify(next) !== JSON.stringify(before)) {
      // Show the new value at once; the base redraws from the note when the save lands.
      cell.replaceChildren(Array.isArray(next) ? next.join(', ') : expr.toText(next))
      ctx.setProperty(row, key, next)
    } else {
      cell.replaceChildren(renderValue(ctx.app, ctx.engine.value(row, key), ctx.sourcePath, key))
    }
  }
  input.onblur = () => finish(true)
  input.onkeydown = (event) => {
    if (event.key === 'Enter') finish(true)
    else if (event.key === 'Escape') finish(false)
    event.stopPropagation()
  }
  cell.replaceChildren(input)
  input.focus()
  if (input.type === 'text') input.select()
}

/** A table: one row per note, one column per property. Cells of note properties can be edited. */
export const table: ViewRenderer = (ctx) => {
  const { engine, view, result, columns } = ctx
  const sort = Array.isArray(view.sort) ? view.sort[0] : undefined

  const head = h(
    'tr',
    {},
    ...columns.map((property) => {
      const direction = sort?.property === property ? (sort.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC') : null
      return h(
        'th',
        {
          title: 'Сортировать',
          // Clicking a header cycles: ascending, descending, unsorted.
          onclick: () =>
            ctx.updateView({
              sort: direction === 'DESC' ? [] : [{ property, direction: direction === 'ASC' ? 'DESC' : 'ASC' }],
            }),
        },
        h('span', { class: 'base-th-name' }, engine.label(property)),
        direction ? h('span', { class: 'base-sort' }, direction === 'ASC' ? '▲' : '▼') : null,
      )
    }),
  )

  const body = h('tbody')
  for (const group of result.groups) {
    if (isGrouped(ctx)) {
      body.append(
        h('tr', { class: 'base-group' }, h('th', { colSpan: columns.length }, groupTitle(ctx, group), h('span', {}, String(group.rows.length)))),
      )
    }
    for (const row of group.rows) {
      const cells = columns.map((property) => {
        const value = engine.value(row, property)
        if (property === 'file.name' || property === 'file.basename') {
          const name = property === 'file.name' && row.file.ext === 'md' ? row.file.basename : String(value)
          return h(
            'td',
            {},
            h('a', { class: 'inline-link', href: '#', title: row.path, onclick: (e: MouseEvent) => (e.preventDefault(), ctx.app.workspace.openFile(row.path)) }, name),
          )
        }
        const key = noteKey(property)
        const editable = key !== null && paths.extname(row.path) === 'md'
        const kind = editable ? (kindOf(value) ?? columnKind(ctx, property)) : 'text'
        if (editable && kind === 'boolean') {
          const box = h('input', { type: 'checkbox', checked: value === true })
          box.onchange = () => ctx.setProperty(row, key!, box.checked)
          return h('td', {}, box)
        }
        const cell = h('td', { class: editable ? 'editable' : '' }, renderValue(ctx.app, value, ctx.sourcePath, property))
        if (editable) {
          cell.onclick = (event) => {
            // A click on a link inside the cell follows the link.
            if ((event.target as Element).closest('a, input')) return
            edit(ctx, cell, row, key!, kind)
          }
        }
        return cell
      })
      body.append(h('tr', {}, ...cells))
    }
  }

  const summaries = columns.map((property) => engine.summary(view, property, (ctx.total ?? result).rows))
  const foot = summaries.some(Boolean)
    ? h(
        'tfoot',
        {},
        h(
          'tr',
          {},
          ...summaries.map((summary) =>
            h('td', {}, summary ? h('span', { class: 'base-summary' }, summary.name) : null, summary ? expr.toText(summary.value) : null),
          ),
        ),
      )
    : null

  return h('div', { class: 'base-table-wrap' }, h('table', { class: 'base-table' }, h('thead', {}, head), body, foot))
}
