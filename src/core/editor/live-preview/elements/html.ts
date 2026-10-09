import type { CodeBlockProcessor } from '..'
import { openLink, resolvePath } from '../../../links'

/** Elements that could run code, load it, or take the page over: they are dropped with what is inside them. */
const DROPPED = new Set(['script', 'object', 'embed', 'link', 'meta', 'base', 'frame', 'frameset', 'applet', 'noscript', 'template', 'slot', 'portal'])
/** Attributes that carry an address. */
const ADDRESSES = ['src', 'href', 'poster', 'srcset', 'action', 'formaction', 'xlink:href', 'data']
const SAFE_ADDRESS = /^(https?:|mailto:|tel:|data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]|blob:|#|\/api\/)/i

/**
 * Makes HTML written in a note safe to put on the page: what could run code is
 * taken out (scripts, `on...` handlers, `javascript:` addresses), everything
 * else stays as written, styles included, as in Obsidian.
 */
export function cleanHtml(html: string, address: (value: string, attribute: string) => string | null): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const node of [...parsed.body.querySelectorAll('*')]) {
    const tag = node.tagName.toLowerCase()
    if (DROPPED.has(tag)) {
      node.remove()
      continue
    }
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc') node.removeAttribute(attribute.name)
      else if (ADDRESSES.includes(name)) {
        const value = address(attribute.value.trim(), name)
        if (value === null) node.removeAttribute(attribute.name)
        else node.setAttribute(attribute.name, value)
      } else if (name === 'style' && /expression\s*\(|javascript:|@import|behavior\s*:/i.test(attribute.value)) node.removeAttribute(attribute.name)
    }
    // A frame from another site (a video player) is allowed, shut off from this page.
    if (tag === 'iframe') {
      if (!/^https:/i.test(node.getAttribute('src') ?? '')) node.remove()
      else node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation')
    }
    if (tag === 'style') node.textContent = (node.textContent ?? '').replace(/@import[^;]*;?/gi, '')
    if (tag === 'a') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
    if (tag === 'img') node.setAttribute('loading', 'lazy')
  }
  const out = document.createDocumentFragment()
  out.append(...parsed.body.childNodes)
  return out
}

/**
 * A block of HTML in a note (`<div ...>...</div>` on lines of its own) is shown
 * as the page it describes; the cursor in it brings the text back. Pictures and
 * links may name files of the vault the way Markdown ones do.
 */
export const htmlBlock: CodeBlockProcessor = (source, el, ctx) => {
  const { app, path } = ctx
  el.classList.add('lp-html')
  el.append(
    cleanHtml(source, (value, attribute) => {
      if (SAFE_ADDRESS.test(value)) return value
      // No scheme at all: a file of the vault, by path or by name.
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) || attribute === 'srcset') return null
      const file = resolvePath(app, value, path)
      if (attribute === 'href') return file ? `#${file}` : null
      return file ? app.vault.url(file) : null
    }),
  )
  // Links to notes open in the app.
  el.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a') : null
    const href = link?.getAttribute('href') ?? ''
    if (!link || !href.startsWith('#') || href.length < 2) return
    event.preventDefault()
    openLink(app, decodeURIComponent(href.slice(1)), path)
  })
}
