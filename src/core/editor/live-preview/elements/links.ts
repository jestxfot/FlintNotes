import { EditorView } from '@codemirror/view'
import type { PreviewRenderer } from '..'
import type { App } from '../../../app'
import { openLink } from '../../../links'
import { filePath } from '../../state'

const NOT_STANDALONE = new Set(['Link', 'Image', 'LinkReference'])

/**
 * `[text](url)` shows only its text and opens on click. Bare URLs stay editable
 * by clicking and open with Ctrl+click.
 */
export const links = (app: App): PreviewRenderer => {
  /** The link under the pointer that this click should open, if any. */
  const target = (event: MouseEvent): string | undefined => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    const rendered = event.target.closest<HTMLElement>('.lp-link')
    if (rendered) return rendered.dataset.href
    if (event.ctrlKey || event.metaKey) return event.target.closest<HTMLElement>('.lp-url')?.dataset.href
  }

  return {
    name: 'links',
    nodes: ['Link', 'URL', 'Autolink'],
    render(node, ctx) {
      if (node.name === 'URL') {
        if (NOT_STANDALONE.has(node.node.parent?.name ?? '')) return
        const href = ctx.text(node.from, node.to)
        ctx.mark(node.from, node.to, { class: 'lp-url', attributes: { 'data-href': href } })
        return
      }
      if (ctx.isActive(node.from, node.to)) return
      const marks = node.node.getChildren('LinkMark')
      if (node.name === 'Autolink') {
        for (const mark of marks) ctx.hide(mark.from, mark.to)
        return
      }
      const url = node.node.getChild('URL')
      if (!url || marks.length < 2) return
      const href = ctx.text(url.from, url.to)
      ctx.hide(marks[0].from, marks[0].to)
      ctx.hide(marks[1].from, node.to)
      ctx.mark(marks[0].to, marks[1].from, { class: 'lp-link', attributes: { 'data-href': href, title: href } })
    },
    extension: EditorView.domEventHandlers({
      // Swallowing mousedown keeps the cursor out of the link, which would reveal its source.
      mousedown: (event) => target(event) !== undefined,
      click: (event, view) => {
        const href = target(event)
        if (href === undefined) return false
        openLink(app, href, view.state.facet(filePath))
        return true
      },
    }),
  }
}
