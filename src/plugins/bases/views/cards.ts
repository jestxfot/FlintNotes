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
  const local = target ? ctx.app.metadata.resolve(target, row.path) : null
  const src = /^https?:/i.test(target) ? target : local ? ctx.app.vault.url(local) : ''
  const ratio = Number(ctx.view.imageAspectRatio)
  const fit = ctx.view.imageFit === 'contain' ? 'object-fit:contain;' : ''
  const style = ratio > 0 ? `${fit}height:auto;aspect-ratio:${1 / ratio}` : fit || undefined
  // A view with pictures keeps their place on every card, so the cards line up; a note without one gets a blank.
  return src ? h('img', { class: 'base-cover', src, alt: '', loading: 'lazy', decoding: 'async', style }) : h('div', { class: 'base-cover base-cover-empty', style })
}

/** A value on a card: tags as pills, nothing as a dash, the rest as everywhere. */
function fieldValue(ctx: ViewContext, property: string, value: unknown): Node {
  if (expr.isEmpty(value) && value !== false) return h('span', { class: 'base-none' }, '—')
  if (Array.isArray(value) && /(^|\.)tags$/i.test(property)) {
    return h(
      'div',
      { class: 'base-pills' },
      ...value.map((item) => {
        const tag = String(item).replace(/^#/, '')
        const pill = h('span', { class: 'base-pill' }, tag)
        pill.style.setProperty('--tag-color', ctx.app.icons.css(ctx.app.icons.look('tag', tag)?.color))
        return pill
      }),
    )
  }
  return renderValue(ctx.app, value, ctx.sourcePath, property)
}

/** One note as a card: title, then its properties. Shared with the board view. */
export function card(ctx: ViewContext, row: Row, skip: string[] = []): HTMLElement {
  const fields = ctx.columns
    .filter((property) => property !== 'file.name' && property !== 'file.basename' && !skip.includes(property))
    .map((property) => ({ property, value: ctx.engine.value(row, property) }))
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
      h('div', { class: 'base-field' }, h('span', { class: 'base-field-name' }, ctx.engine.label(property)), fieldValue(ctx, property, value)),
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
      h('div', { class: 'base-cards', style: Number(ctx.view.cardSize) > 0 ? `grid-template-columns:repeat(auto-fill,minmax(${Number(ctx.view.cardSize)}px,1fr))` : undefined }, ...group.rows.map((row) => card(ctx, row))),
    ]),
  )
