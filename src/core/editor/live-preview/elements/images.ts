import { WidgetType, type EditorView } from '@codemirror/view'
import type { PreviewRenderer } from '..'
import type { App } from '../../../app'
import { resolvePath } from '../../../links'

/** A picture in the text. `below` puts it on its own row under the source that stays visible. */
export class ImageWidget extends WidgetType {
  constructor(
    private src: string,
    private alt: string,
    private width: string,
    private below: boolean,
  ) {
    super()
  }
  eq(other: ImageWidget) {
    return (
      other.src === this.src && other.alt === this.alt && other.width === this.width && other.below === this.below
    )
  }
  toDOM(view: EditorView) {
    const img = document.createElement('img')
    img.className = this.below ? 'lp-image lp-image-below' : 'lp-image'
    img.src = this.src
    img.alt = this.alt
    if (this.width) img.width = Number(this.width)
    // The editor laid out the line before the picture had a size.
    img.onload = () => view.requestMeasure()
    return img
  }
  // Clicks reach the editor, so clicking the picture puts the cursor there and shows its source.
  ignoreEvent() {
    return false
  }
}

/**
 * `![alt](path)` shows the picture; with the cursor on it, the source stays and
 * the picture moves below. `![alt|300](path)` sets the width, as in Obsidian.
 */
export const images = (app: App): PreviewRenderer => ({
  name: 'images',
  nodes: ['Image'],
  render(node, ctx) {
    const url = node.node.getChild('URL')
    const marks = node.node.getChildren('LinkMark')
    if (!url || marks.length < 2) return false
    const target = ctx.text(url.from, url.to)
    let src = target
    if (!/^(https?:|data:image\/)/i.test(target)) {
      const path = resolvePath(app, target, ctx.path)
      if (!path) return false
      src = app.vault.url(path)
    }
    const [alt, width = ''] = ctx.text(marks[0].to, marks[1].from).split(/\|(?=\d+$)/)
    const active = ctx.isActive(node.from, node.to)
    const widget = new ImageWidget(src, alt, width, active)
    if (active) ctx.widget(node.to, widget)
    else ctx.replace(node.from, node.to, widget)
    return false
  },
})
