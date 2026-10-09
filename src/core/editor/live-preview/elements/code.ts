import { WidgetType } from '@codemirror/view'
import type { PreviewRenderer } from '..'

class LanguageLabel extends WidgetType {
  constructor(private lang: string) {
    super()
  }
  eq(other: LanguageLabel) {
    return other.lang === this.lang
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'lp-code-lang'
    el.textContent = this.lang
    return el
  }
}

/**
 * Code blocks get a background; the ``` fences are hidden unless the cursor is
 * inside the block. Blocks drawn by a code block processor are left to it.
 */
export const code: PreviewRenderer = {
  name: 'code',
  nodes: ['FencedCode', 'CodeBlock'],
  render(node, ctx) {
    if (node.name === 'FencedCode' && ctx.isRendered(node.node)) return false
    const first = ctx.state.doc.lineAt(node.from).number
    const last = ctx.state.doc.lineAt(node.to).number
    ctx.lines(node.from, node.to, (line) => {
      const edge = (line.number === first ? ' lp-code-first' : '') + (line.number === last ? ' lp-code-last' : '')
      ctx.line(line.from, `lp-code${edge}`)
    })
    if (node.name !== 'FencedCode' || ctx.isActive(node.from, node.to)) return
    const [open, close] = node.node.getChildren('CodeMark')
    const info = node.node.getChild('CodeInfo')
    const lang = info ? ctx.text(info.from, info.to).trim() : ''
    const openEnd = ctx.state.doc.lineAt(open.from).to
    if (lang) ctx.replace(open.from, openEnd, new LanguageLabel(lang))
    else ctx.hide(open.from, openEnd)
    ctx.line(open.from, 'lp-code-fence')
    if (close) {
      ctx.hide(close.from, close.to)
      ctx.line(close.from, 'lp-code-fence')
    }
  },
}
