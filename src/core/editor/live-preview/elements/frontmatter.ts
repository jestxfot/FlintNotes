import type { PreviewRenderer } from '..'

/** The YAML block at the top of a note is set apart from the text, unless a plugin draws it as a form. */
export const frontmatter: PreviewRenderer = {
  name: 'frontmatter',
  nodes: ['Frontmatter'],
  render(node, ctx) {
    if (ctx.isRendered(node.node)) return false
    const last = ctx.state.doc.lineAt(node.to).number
    ctx.lines(node.from, node.to, (line) => {
      const edge = (line.number === 1 ? ' lp-frontmatter-first' : '') + (line.number === last ? ' lp-frontmatter-last' : '')
      ctx.line(line.from, `lp-frontmatter${edge}`)
    })
  },
}
