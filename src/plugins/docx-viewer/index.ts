import { renderAsync } from 'docx-preview'
import { errorMessage, Plugin, type App } from '../../api'
import './style.css'

const EMBED_HEIGHT = 480

/** Draws a Word document into `el`, laid out in pages like the original. */
async function render(app: App, path: string, el: HTMLElement): Promise<void> {
  try {
    const data = await app.vault.readBinary(path)
    const page = document.createElement('div')
    // "Alt chunks" can carry arbitrary HTML from the file, so they are not rendered.
    await renderAsync(data, page, undefined, { renderAltChunks: false, ignoreLastRenderedPageBreak: true })
    el.replaceChildren(page)
  } catch (err) {
    el.textContent = `Не удалось открыть документ: ${errorMessage(err)}`
  }
}

export default class DocxViewer extends Plugin {
  onload() {
    this.registerView(
      'docx',
      ({ app, path, containerEl }) => {
        const el = containerEl.appendChild(document.createElement('div'))
        el.className = 'docx-view'
        let current = path
        void render(app, current, el)
        return {
          onExternalChange: () => void render(app, current, el),
          onRename: (renamed) => (current = renamed),
          destroy: () => el.remove(),
        }
      },
      ['docx'],
    )

    // `![[file.docx|600]]` sets the height of the embedded document.
    this.registerEmbed(['docx'], (el, ctx) => {
      const view = el.appendChild(document.createElement('div'))
      view.className = 'docx-view docx-embed'
      view.style.maxHeight = `${/^\d+$/.test(ctx.alias) ? ctx.alias : EMBED_HEIGHT}px`
      void render(ctx.app, ctx.path, view)
    })
  }
}
