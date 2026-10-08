import { expr } from '../../../api'
import { h } from '../dom'
import type { Row } from '../engine'
import { renderValue } from '../format'
import { groupTitle, isGrouped, type ViewContext, type ViewRenderer } from './shared'

/** The picture of a card: the `image` property may hold a link, a path or a web address. */
function cover(ctx: ViewContext, row: Row): HTMLElement | null {
  if (!ctx.view.image) return null
  const value = ctx.engine.value(row, ctx.view.image)
  const target = value instanceof expr.Link ? value.target : typeof value === 'string' ? value : ''
  if (!target) return null
  const local = ctx.app.metadata.resolve(target, row.path)
  const src = /^https?:/i.test(target) ? target : local ? ctx.app.vault.url(local) : ''
  return src ? h('img', { class: 'base-cover', src, alt: '', loading: 'lazy' }) : null
}

/** One note as a card: title, then its properties. Shared with the board view. */
export function card(ctx: ViewContext, row: Row, skip: string[] = []): HTMLElement {
  const fields = ctx.columns
    .filter((property) => property !== 'file.name' && property !== 'file.basename' && !skip.includes(property))
    .map((property) => ({ property, value: ctx.engine.value(row, property) }))
    .filter(({ value }) => !expr.isEmpty(value) || value === false)
  return h(
    'div',
    { class: 'base-card' },
    cover(ctx, row),
    h(
      'a',
      { class: 'base-card-title', href: '#', title: row.path, onclick: (e: MouseEvent) => (e.preventDefault(), ctx.app.workspace.openFile(row.path)) },
      row.file.basename,
    ),
    ...fields.map(({ property, value }) =>
      h('div', { class: 'base-field' }, h('span', {}, ctx.engine.label(property)), renderValue(ctx.app, value, ctx.sourcePath, property)),
    ),
  )
}

/** A grid of cards, one per note. */
export const cards: ViewRenderer = (ctx) =>
  h(
    'div',
    { class: 'base-cards-wrap' },
    ...ctx.result.groups.flatMap((group) => [
      isGrouped(ctx) ? h('h4', { class: 'base-group-title' }, groupTitle(ctx, group), h('span', {}, String(group.rows.length))) : null,
      h('div', { class: 'base-cards' }, ...group.rows.map((row) => card(ctx, row))),
    ]),
  )
