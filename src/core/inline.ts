import type { App } from './app'
import { openLink } from './links'

// One alternative per inline element; the order decides which wins on overlap.
const INLINE =
  /(`[^`\n]+`)|(==[^=\n]+==)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(!?\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\([^)\s]+\))|((?<![\p{L}\p{N}_/#&;])#[\p{L}\p{N}_/-]+)|(https?:\/\/[^\s<>)\]]+)|(<br\s*\/?>)/gu

/** Draws the text of an `inline code` as something else, a computed value say; `null` leaves it as code. */
export type InlineCodeRenderer = (code: string, sourcePath: string) => Node | null

const codeRenderers = new Set<InlineCodeRenderer>()

/** Teaches `renderInline` to draw some inline code as something else; returns how to stop. */
export function addInlineCodeRenderer(renderer: InlineCodeRenderer): () => void {
  codeRenderers.add(renderer)
  return () => codeRenderers.delete(renderer)
}

/** Inline code as a plugin draws it (`= expression` as its value, with Dataview), or as code. */
function drawCode(code: string, sourcePath: string): Node {
  for (const renderer of codeRenderers) {
    try {
      const drawn = renderer(code, sourcePath)
      if (drawn) return drawn
    } catch (err) {
      console.error('Inline code renderer failed', err)
    }
  }
  return element('code', '', code)
}

/** A mark after a link to a note, saying something of that note: its birthday is near, say. */
export interface LinkBadge {
  text: string
  title?: string
  /** `today` and `soon` stand out; anything else is quiet. */
  tone?: string
}

/** Says what mark, if any, links to the note at a path get. */
export type LinkBadgeProvider = (path: string) => LinkBadge | null

const badgeProviders = new Set<LinkBadgeProvider>()

/** Gives links to notes a mark after them; returns how to stop. */
export function addLinkBadgeProvider(provider: LinkBadgeProvider): () => void {
  badgeProviders.add(provider)
  return () => badgeProviders.delete(provider)
}

/** The mark for links to the note at `path`, if a plugin gives one. */
export function linkBadge(path: string): LinkBadge | null {
  for (const provider of badgeProviders) {
    try {
      const badge = provider(path)
      if (badge) return badge
    } catch (err) {
      console.error('Link badge failed', err)
    }
  }
  return null
}

/** The element of a link's mark. */
export function drawLinkBadge(badge: LinkBadge): HTMLElement {
  const el = element('span', 'link-badge', badge.text)
  if (badge.title) el.title = badge.title
  if (badge.tone) el.dataset.tone = badge.tone
  return el
}

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
    const a = element('a', !wiki && /^[a-z][a-z0-9+.-]*:/i.test(href) ? 'inline-link external-link' : 'inline-link', label)
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
    // The icon of the note the link leads to, as before links in a note's text.
    if (wiki && app.icons.inNotes) {
      const dest = app.metadata.resolve(href.split('#')[0], sourcePath)
      const look = dest ? app.icons.look('file', dest) : undefined
      if (look?.icon) {
        const icon = app.icons.draw(look.icon, look.color)
        icon.classList.add('inline-link-icon')
        a.prepend(icon)
      }
    }
    return a
  }

  let last = 0
  for (const m of text.matchAll(INLINE)) {
    out.append(text.slice(last, m.index))
    last = m.index + m[0].length
    const [all, code, mark, bold, strike, italic, wiki, md, tag, url, br] = m
    if (code) out.append(drawCode(code.slice(1, -1), sourcePath))
    else if (mark) out.append(element('mark', 'inline-mark', mark.slice(2, -2).trim()))
    else if (bold) out.append(element('strong', '', bold.slice(2, -2)))
    else if (strike) out.append(element('s', '', strike.slice(2, -2)))
    else if (italic) out.append(element('em', '', italic.slice(1, -1)))
    else if (wiki) {
      const [target, alias] = wiki.replace(/^!?\[\[|\]\]$/g, '').split('|')
      out.append(link(alias ?? target, target, true))
      const dest = app.metadata.resolve(target.split('#')[0], sourcePath)
      const badge = dest ? linkBadge(dest) : null
      if (badge) out.append(drawLinkBadge(badge))
    } else if (md) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(md)!
      out.append(link(label, href, false))
    } else if (tag) {
      const pill = element('span', 'inline-tag', tag)
      const look = app.icons.look('tag', tag.slice(1))
      pill.style.setProperty('--tag-color', app.icons.css(look?.color))
      if (look?.icon) pill.prepend(app.icons.draw(look.icon), ' ')
      out.append(pill)
    }
    else if (url) out.append(link(url, url, false))
    else if (br) out.append(document.createElement('br'))
    else out.append(all)
  }
  out.append(text.slice(last))
  return out
}
