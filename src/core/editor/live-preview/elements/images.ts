import { WidgetType, type EditorView } from '@codemirror/view'
import type { PreviewRenderer } from '..'
import type { App } from '../../../app'
import { resolvePath } from '../../../links'
import { imageSize, rememberImage, reserveImage } from '../../../sizes'

/**
 * The address of a picture drawn by the server for an SVG (`/api/thumb?…&x=2`: a WebP at twice its own size), or null for any
 * other picture. An SVG in an `<img>` is a whole document to the browser: the charts of an article (thousands of shapes, blur
 * filters) cost it a second and more of the page's own thread when they arrive and again whenever the text around them is
 * redrawn, so that typing under one waits for it. A plain picture of it costs nothing of the kind.
 */
export function drawnCopy(src: string): string | null {
  let url: URL
  try {
    url = new URL(src, location.href)
  } catch {
    return null
  }
  if (url.origin === location.origin && url.pathname === '/api/file') {
    if (!/\.svg$/i.test(url.searchParams.get('path') ?? '')) return null
    return `/api/thumb${url.search}&x=2`
  }
  if (!/^https?:$/.test(url.protocol) || !/\.svgz?$/i.test(url.pathname)) return null
  return `/api/thumb?url=${encodeURIComponent(url.href)}&x=2`
}

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
    const copy = drawnCopy(this.src)
    // Twice its own size, said so: the copy takes the place the SVG would, and stays sharp on a dense screen and when zoomed.
    // Only `srcset`: a `src` beside it would be taken as the copy at 1x and shown twice as large.
    if (copy) img.srcset = `${copy} 2x`
    else img.src = this.src
    img.alt = this.alt
    if (this.width) img.width = Number(this.width)
    else if (copy) {
      // A picture of `srcset` is never there at once, not even from the memory cache: with no size of its own it would be
      // 0 high for a moment each time the editor draws it again (scrolled back to), and the text around it would jump.
      const known = imageSize(this.src)
      if (known) [img.width, img.height] = known
    }
    // Room for it before it arrives: what is below does not move when it does.
    reserveImage(img, this.src, !!this.width)
    img.onload = () => {
      // The copy says the drawing's size (its own, by the `2x`), remembered under the drawing's address for the next opening.
      if (copy && img.currentSrc.includes('/api/thumb')) rememberImage(this.src, img.naturalWidth, img.naturalHeight)
      // The editor laid out the line before the picture had a size.
      view.requestMeasure()
    }
    // No copy (no resizer on the server, a site it cannot reach): the drawing itself, as before.
    if (copy)
      img.onerror = () => {
        img.onerror = null
        img.removeAttribute('srcset')
        img.src = this.src
      }
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
