import { parse } from 'yaml'
import { cm, errorMessage, Plugin, type CodeBlockProcessor } from '../../api'
import './style.css'

const WEB = /^https?:\/\//i

/**
 * ```embed
 * title: "…"
 * image: "https://…"
 * description: "…"
 * url: "https://…"
 * favicon: "https://…"
 * aspectRatio: "52.5"
 * ```
 */
export default class LinkEmbed extends Plugin {
  onload() {
    const { app } = this
    const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim())
    /** A picture may be on the web or in the vault. */
    const source = (value: string, path: string) => {
      if (!value) return ''
      if (WEB.test(value) || value.startsWith('data:image/')) return value
      const file = app.metadata.resolve(value.replace(/^!?\[\[|\]\]$/g, ''), path) ?? (app.vault.get(value) ? value : null)
      return file ? app.vault.url(file) : ''
    }

    const card: CodeBlockProcessor = (block, el, { path }) => {
      const draw = (yaml: string) => {
        el.replaceChildren()
        let data: Record<string, unknown>
        try {
          const parsed: unknown = parse(yaml)
          if (!parsed || typeof parsed !== 'object') throw new Error('нужны поля title, url, …')
          data = parsed as Record<string, unknown>
        } catch (err) {
          const error = el.appendChild(document.createElement('div'))
          error.className = 'embed-card-error'
          error.textContent = `embed: ${err instanceof Error ? err.message : String(err)}`
          return
        }
        const url = text(data.url)
        const box = el.appendChild(document.createElement('a'))
        box.className = 'embed-card'
        if (WEB.test(url)) {
          box.href = url
          box.target = '_blank'
          box.rel = 'noopener noreferrer'
        }
        const body = box.appendChild(document.createElement('div'))
        body.className = 'embed-card-text'
        const title = body.appendChild(document.createElement('div'))
        title.className = 'embed-card-title'
        title.textContent = text(data.title) || url
        const description = text(data.description)
        if (description) {
          const about = body.appendChild(document.createElement('div'))
          about.className = 'embed-card-description'
          about.textContent = description
        }
        const site = body.appendChild(document.createElement('div'))
        site.className = 'embed-card-url'
        const icon = source(text(data.favicon), path)
        if (icon) {
          const favicon = site.appendChild(document.createElement('img'))
          favicon.src = icon
          favicon.alt = ''
          favicon.onerror = () => favicon.remove()
        }
        site.append(url)

        const picture = source(text(data.image), path)
        if (picture) {
          const frame = box.appendChild(document.createElement('div'))
          frame.className = 'embed-card-image'
          const ratio = Number(text(data.aspectRatio))
          // Link Embed stores the picture's height as a percentage of its width.
          if (ratio > 0) frame.style.aspectRatio = `100 / ${ratio}`
          const image = frame.appendChild(document.createElement('img'))
          image.src = picture
          image.alt = ''
          image.loading = 'lazy'
          image.onerror = () => frame.remove()
        }
      }
      draw(block)
      return { update: draw }
    }
    this.registerCodeBlockProcessor('embed', card)

    // ---- making a card from an address
    this.addSettings([
      {
        key: 'paste',
        name: 'Вставленную ссылку превращать в карточку',
        desc: 'Адрес страницы, вставленный в пустую строку, заменяется карточкой. Отменяется как обычно, Ctrl+Z',
        type: 'toggle',
        default: true,
      },
    ])
    const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim()}"`
    /** The picture's height as a percentage of its width, which Link Embed keeps so the card does not jump while loading. */
    const ratio = (src: string) =>
      new Promise<string>((resolve) => {
        if (!src) return resolve('')
        const image = new Image()
        image.onload = () => resolve(image.naturalWidth ? String(Math.round((image.naturalHeight / image.naturalWidth) * 1000) / 10) : '')
        image.onerror = () => resolve('')
        setTimeout(() => resolve(''), 4000)
        image.src = src
      })
    const block = async (address: string): Promise<string> => {
      const page = await app.vault.unfurl(address)
      const aspect = await ratio(page.image)
      const lines = [`title: ${quote(page.title || address)}`, `image: ${quote(page.image)}`, `description: ${quote(page.description)}`, `url: ${quote(page.url)}`]
      if (page.favicon) lines.push(`favicon: ${quote(page.favicon)}`)
      if (aspect) lines.push(`aspectRatio: ${quote(aspect)}`)
      return `\`\`\`embed\n${lines.join('\n')}\n\`\`\``
    }
    /** Puts a card for `address` in place of `from..to`; the address stays as plain text if the page cannot be read. */
    const embed = async (view: InstanceType<typeof cm.view.EditorView>, address: string, from: number, to: number) => {
      // The address goes in at once and is swapped for the card when the page has answered.
      view.dispatch({ changes: { from, to, insert: address }, selection: { anchor: from + address.length } })
      try {
        const text = await block(address)
        const at = view.state.sliceDoc(from, from + address.length) === address ? from : view.state.doc.toString().indexOf(address)
        if (at < 0) return
        view.dispatch({ changes: { from: at, to: at + address.length, insert: `${text}\n` }, selection: { anchor: at + text.length + 1 } })
      } catch (err) {
        app.notice(`Карточка ссылки: ${errorMessage(err)}`)
      }
    }
    this.registerEditorExtension(
      cm.view.EditorView.domEventHandlers({
        paste: (event, view) => {
          if (!this.getSetting<boolean>('paste')) return false
          const pasted = event.clipboardData?.getData('text/plain').trim() ?? ''
          const { from, to } = view.state.selection.main
          const line = view.state.doc.lineAt(from)
          // Only an address alone on an empty line: inside a sentence a link is meant to stay a link.
          if (!/^https?:\/\/\S+$/i.test(pasted) || from !== to || line.text.trim()) return false
          event.preventDefault()
          void embed(view, pasted, line.from, line.to)
          return true
        },
      }),
    )
    this.addCommand({
      id: 'embed-selection',
      name: 'Превратить ссылку в карточку',
      callback: () => {
        const view = app.workspace.activeEditor
        if (!view) return
        const { from, to } = view.state.selection.main
        const line = view.state.doc.lineAt(from)
        // The selected address, or the one the cursor's line consists of.
        const [text, start, end] = from !== to ? [view.state.sliceDoc(from, to).trim(), from, to] : [line.text.trim(), line.from, line.to]
        if (!WEB.test(text) || /\s/.test(text)) return app.notice('Выделите адрес страницы или поставьте курсор в строку с ним')
        void embed(view, text, start, end)
      },
    })
  }
}
