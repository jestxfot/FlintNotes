import { WidgetType, type EditorView } from '@codemirror/view'
import type { PreviewRenderer } from '..'

class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'lp-bullet'
    el.textContent = '•'
    return el
  }
}

class CheckboxWidget extends WidgetType {
  constructor(private checked: boolean) {
    super()
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'lp-checkbox'
    box.checked = this.checked
    // The click edits the note's text; the checkbox is redrawn from it.
    box.onmousedown = (event) => event.preventDefault()
    box.onclick = (event) => {
      event.preventDefault()
      const inside = view.posAtDOM(box) + 1
      view.dispatch({ changes: { from: inside, to: inside + 1, insert: this.checked ? ' ' : 'x' } })
    }
    return box
  }
}

const bullet = new BulletWidget()

/**
 * Lists: `-` becomes a bullet and `- [ ]` a clickable checkbox. The source
 * shows while the cursor is on the marker itself.
 */
export const lists: PreviewRenderer = {
  name: 'lists',
  nodes: ['ListMark', 'TaskMarker'],
  render(node, ctx) {
    if (node.name === 'TaskMarker') {
      const checked = /x/i.test(ctx.text(node.from, node.to))
      if (checked) ctx.line(node.from, 'lp-task-done')
      const listMark = node.node.parent?.prevSibling
      if (!ctx.isActive(listMark?.from ?? node.from, node.to)) {
        ctx.replace(node.from, node.to, new CheckboxWidget(checked))
      }
      return
    }
    const task = node.node.nextSibling?.name === 'Task' ? node.node.nextSibling : null
    if (task) {
      // The checkbox stands in for the bullet, so `- ` disappears with it.
      const marker = task.firstChild
      if (marker && !ctx.isActive(node.from, marker.to)) ctx.hide(node.from, marker.from)
    } else if (!node.matchContext(['BulletList', 'ListItem'])) {
      ctx.mark(node.from, node.to, { class: 'lp-list-number' })
    } else if (!ctx.isActive(node.from, node.to)) {
      ctx.replace(node.from, node.to, bullet)
    }
  },
}
