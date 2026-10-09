import { parse } from 'yaml'
import { Plugin, type CodeBlockProcessor } from '../../api'
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
  }
}
