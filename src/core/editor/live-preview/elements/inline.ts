import type { PreviewRenderer } from '..'

/** `*italic*`, `**bold**`, `~~strike~~`, `==highlight==`, `` `code` `` and `\*` escapes: marks are hidden outside the cursor. */
export const inline: PreviewRenderer = {
  name: 'inline',
  nodes: ['Emphasis', 'StrongEmphasis', 'Strikethrough', 'Highlight', 'InlineCode', 'Escape'],
  render(node, ctx) {
    if (node.name === 'InlineCode') ctx.mark(node.from, node.to, { class: 'lp-inline-code' })
    if (node.name === 'Highlight') ctx.mark(node.from + 2, node.to - 2, { class: 'lp-highlight' })
    if (ctx.isActive(node.from, node.to)) return
    if (node.name === 'Escape') {
      ctx.hide(node.from, node.from + 1)
      return
    }
    for (let child = node.node.firstChild; child; child = child.nextSibling) {
      if (child.name.endsWith('Mark')) ctx.hide(child.from, child.to)
    }
  },
}
