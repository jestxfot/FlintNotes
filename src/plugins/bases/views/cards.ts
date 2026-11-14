import { expr } from '../../../api'
import { h } from '../dom'
import type { Row } from '../engine'
import { renderValue } from '../format'
import { groupTitle, isGrouped, type ViewContext, type ViewRenderer } from './shared'

/**
 * A YouTube thumbnail is made in several sizes at fixed addresses; the largest (`maxresdefault`, 1280x720, 100-200 KB) is
 * drawn to fill a card 150-300 px wide. The small one (`mqdefault`, 320x180, the same picture) is a tenth of the bytes and a
 * sixteenth of the pixels to decode, and the browser fetches it as before, so no server need reach YouTube.
 */
const YOUTUBE = /^(https?:\/\/(?:i\d?\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/[\w-]+\/)(?:maxresdefault|sddefault|hqdefault|hq720|0|default)(\.(?:jpg|webp))(\?.*)?$/i

/** The server's small copies are left alone for a minute after they failed several times in a row (no resizer there, the web out of its reach). */
let trouble = 0
let pausedUntil = 0

/** A cover as small as it is shown; the picture itself if anything fails. */
function coverImage(ctx: ViewContext, original: string, local: string | null, style: string | undefined): HTMLImageElement {
  const shown = (Number(ctx.view.cardSize) || 240) * 1.5 * (window.devicePixelRatio || 1)
  const youtube = YOUTUBE.exec(original)
  let src = original
  let small = false
  if (youtube && shown <= 320) (src = `${youtube[1]}mqdefault${youtube[2]}${youtube[3] ?? ''}`), (small = true)
  else if (Date.now() >= pausedUntil && !youtube) (src = local ? ctx.app.vault.thumbUrl(local, Math.ceil(shown)) : ctx.app.vault.thumbWebUrl(original, Math.ceil(shown))), (small = true)
  const img = h('img', { class: 'base-cover', src, alt: '', loading: 'lazy', decoding: 'async', style }) as HTMLImageElement
  if (small && src !== original) {
    img.addEventListener('load', () => (trouble = 0), { once: true })
    img.addEventListener(
      'error',
      () => {
        if (++trouble >= 5) pausedUntil = Date.now() + 60_000
        img.src = original
      },
      { once: true },
    )
  }
  return img
}

/** The picture of a card: the `image` property may hold a link, a path or a web address. */
function cover(ctx: ViewContext, row: Row): HTMLElement | null {
  if (!ctx.view.image) return null
  const value = ctx.engine.value(row, ctx.view.image)
  const target = value instanceof expr.Link ? value.target : typeof value === 'string' ? value : ''
  const local = target ? ctx.app.metadata.resolve(target, row.path) : null
  const original = /^https?:/i.test(target) ? target : local ? ctx.app.vault.url(local) : ''
  const ratio = Number(ctx.view.imageAspectRatio)
  const fit = ctx.view.imageFit === 'contain' ? 'object-fit:contain;' : ''
  const style = ratio > 0 ? `${fit}height:auto;aspect-ratio:${1 / ratio}` : fit || undefined
  // A view with pictures keeps their place on every card, so the cards line up; a note without one gets a blank.
  return original ? coverImage(ctx, original, /^https?:/i.test(target) ? null : local, style) : h('div', { class: 'base-cover base-cover-empty', style })
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
