import type { PreviewRenderer } from '..'

/** `> quote`: lines get a side bar; the `>` is hidden unless the cursor is on the line. */
export const quotes: PreviewRenderer = {
  name: 'quotes',
  nodes: ['Blockquote', 'QuoteMark'],
  render(node, ctx) {
    if (node.name === 'Blockquote') {
      ctx.lines(node.from, node.to, (line) => ctx.line(line.from, 'lp-quote'))
      return
    }
    if (ctx.lineActive(node.from)) return
    const space = ctx.text(node.to, node.to + 1) === ' ' ? 1 : 0
    ctx.hide(node.from, node.to + space)
  },
}
