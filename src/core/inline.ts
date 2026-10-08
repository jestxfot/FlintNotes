import type { App } from './app'
import { openLink } from './links'

// One alternative per inline element; the order decides which wins on overlap.
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(!?\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\([^)\s]+\))|((?<![\p{L}\p{N}_/#&;])#[\p{L}\p{N}_/-]+)|(https?:\/\/[^\s<>)\]]+)|(<br\s*\/?>)/gu

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string) {
  const el = document.createElement(tag)
  if (className) el.className = className
  el.textContent = text
  return el
}

/**
 * Draws one line of Markdown (bold, italic, code, links, tags) as DOM, for
 * text shown outside the editor: table cells, task lists, cards. Links work:
 * notes open in the app, web links in a new tab.
 */
export function renderInline(app: App, text: string, sourcePath: string): DocumentFragment {
  const out = document.createDocumentFragment()
  const link = (label: string, href: string, wiki: boolean) => {
    const a = element('a', 'inline-link', label)
    a.href = '#'
    a.title = href
    a.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (!wiki) return openLink(app, href, sourcePath)
      const dest = app.metadata.resolve(href.split('#')[0], sourcePath)
      if (dest) app.workspace.openFile(dest)
      else app.notice(`Заметка «${href}» не найдена`)
    }
    return a
  }

  let last = 0
  for (const m of text.matchAll(INLINE)) {
    out.append(text.slice(last, m.index))
    last = m.index + m[0].length
    const [all, code, bold, strike, italic, wiki, md, tag, url, br] = m
    if (code) out.append(element('code', '', code.slice(1, -1)))
    else if (bold) out.append(element('strong', '', bold.slice(2, -2)))
    else if (strike) out.append(element('s', '', strike.slice(2, -2)))
    else if (italic) out.append(element('em', '', italic.slice(1, -1)))
    else if (wiki) {
      const [target, alias] = wiki.replace(/^!?\[\[|\]\]$/g, '').split('|')
      out.append(link(alias ?? target, target, true))
    } else if (md) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(md)!
      out.append(link(label, href, false))
    } else if (tag) out.append(element('span', 'inline-tag', tag))
    else if (url) out.append(link(url, url, false))
    else if (br) out.append(document.createElement('br'))
    else out.append(all)
  }
  out.append(text.slice(last))
  return out
}
