import { expr } from '../../../api'
import { h } from '../dom'
import { renderValue } from '../format'
import { groupTitle, isGrouped, type ViewContext, type ViewRenderer } from './shared'

/** A compact list: the note's name followed by its properties on one line. */
export const list: ViewRenderer = (ctx) =>
  h(
    'div',
    { class: 'base-list-wrap' },
    ...ctx.result.groups.flatMap((group) => [
      isGrouped(ctx) ? h('h4', { class: 'base-group-title' }, groupTitle(ctx, group), h('span', {}, String(group.rows.length))) : null,
      h(
        'ul',
        { class: 'base-list' },
        ...group.rows.map((row) => {
          const item = h(
            'li',
            {},
            h('a', { class: 'inline-link', href: '#', title: row.path, onclick: (e: MouseEvent) => (e.preventDefault(), ctx.app.workspace.openFile(row.path)) }, row.file.basename),
          )
          for (const property of ctx.columns) {
            if (property === 'file.name' || property === 'file.basename') continue
            const value = ctx.engine.value(row, property)
            if (expr.isEmpty(value) && value !== false) continue
            item.append(h('span', { class: 'base-list-field', title: ctx.engine.label(property) }, renderValue(ctx.app, value, ctx.sourcePath, property)))
          }
          return item
        }),
      ),
    ]),
  )
