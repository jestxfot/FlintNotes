import type { PreviewRenderer } from '..'

const LEVELS = [1, 2, 3, 4, 5, 6]

/** `# Heading`: the `#` marks are hidden unless the cursor is on the line. */
export const headings: PreviewRenderer = {
  name: 'headings',
  nodes: LEVELS.map((n) => `ATXHeading${n}`),
  render(node, ctx) {
    ctx.line(node.from, `lp-heading lp-h${node.name.at(-1)}`)
    if (ctx.lineActive(node.from)) return
    const mark = node.node.getChild('HeaderMark')
    if (!mark) return
    const spaces = /^\s*/.exec(ctx.text(mark.to, node.to))![0].length
    ctx.hide(mark.from, mark.to + spaces)
  },
}
