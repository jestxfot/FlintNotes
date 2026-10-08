import { path as paths } from '../../../api'
import { h } from '../dom'
import { groupRule, noteKey, type Row } from '../engine'
import { card } from './cards'
import { groupTitle, type ViewContext, type ViewRenderer } from './shared'

/**
 * A board: one column per value of the grouping property, notes as cards.
 * Dragging a card to another column writes that column's value into the note.
 */
export const board: ViewRenderer = (ctx) => {
  const group = groupRule(ctx.view)
  if (!group) {
    return h('div', { class: 'base-empty' }, 'Доске нужна группировка: выберите свойство в настройках представления (⚙).')
  }
  const key = noteKey(group.property)
  let dragged: Row | null = null

  return h(
    'div',
    { class: 'base-board' },
    ...ctx.result.groups.map((column) => {
      const el = h(
        'div',
        { class: 'base-column' },
        h('h4', { class: 'base-group-title' }, groupTitle(ctx, column), h('span', {}, String(column.rows.length))),
        ...column.rows.map((row) => {
          const item = card(ctx, row, [group.property])
          // Only a note's own property can be changed by moving the card.
          item.draggable = key !== null && paths.extname(row.path) === 'md'
          item.ondragstart = (event) => {
            dragged = row
            event.dataTransfer?.setData('text/plain', row.path)
            item.classList.add('dragging')
          }
          item.ondragend = () => item.classList.remove('dragging')
          return item
        }),
      )
      el.ondragover = (event) => {
        if (!dragged || key === null) return
        event.preventDefault()
        el.classList.add('drop-target')
      }
      el.ondragleave = () => el.classList.remove('drop-target')
      el.ondrop = (event) => {
        event.preventDefault()
        el.classList.remove('drop-target')
        if (!dragged || key === null) return
        const value = column.key === null || column.key === undefined ? undefined : column.key
        if (ctx.engine.value(dragged, group.property) !== value) ctx.setProperty(dragged, key, value)
        dragged = null
      }
      return el
    }),
  )
}
