import { WidgetType } from '@codemirror/view'
import type { PreviewRenderer } from '..'

class RuleWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'lp-rule'
    return el
  }
}

const rule = new RuleWidget()

/** `---` on its own line is drawn as a horizontal rule. */
export const rules: PreviewRenderer = {
  name: 'rules',
  nodes: ['HorizontalRule'],
  render(node, ctx) {
    if (!ctx.lineActive(node.from)) ctx.replace(node.from, node.to, rule)
  },
}
