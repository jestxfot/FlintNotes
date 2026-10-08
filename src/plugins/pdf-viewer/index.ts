import { Plugin } from '../../api'
import './style.css'

const EMBED_HEIGHT = 480

// PDFs are shown by the browser's own viewer: paging, zoom, search and print
// come with it, and nothing has to be downloaded to render them.
function frame(src: string): HTMLIFrameElement {
  const el = document.createElement('iframe')
  el.className = 'pdf-frame'
  el.src = src
  return el
}

export default class PdfViewer extends Plugin {
  onload() {
    this.registerView(
      'pdf',
      ({ app, path, containerEl }) => {
        const el = containerEl.appendChild(frame(app.vault.url(path)))
        return {
          onExternalChange: () => (el.src = el.src),
          onRename: (renamed) => (el.src = app.vault.url(renamed)),
          destroy: () => el.remove(),
        }
      },
      ['pdf'],
    )

    // `![[file.pdf#page=3]]` opens at a page; `![[file.pdf|600]]` sets the height.
    this.registerEmbed(['pdf'], (el, ctx) => {
      const pdf = el.appendChild(frame(ctx.app.vault.url(ctx.path) + ctx.subpath))
      pdf.style.height = `${/^\d+$/.test(ctx.alias) ? ctx.alias : EMBED_HEIGHT}px`
    })
  }
}
