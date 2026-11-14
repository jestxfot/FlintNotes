// What a page says of itself, for the card a link becomes: read from the page's own text. Pure (no network), so the server reads a
// page it fetched and the page reads one the desktop app fetched (where the server cannot get to the site) in one and the same way.

export interface Card {
  url: string
  title: string
  description: string
  image: string
  favicon: string
  author?: string
  problem?: string
}

/** Paths of t.me that are not a name: invitations, stickers, sharing and the like. */
const TELEGRAM_PATHS = new Set(['joinchat', 'addstickers', 'addemoji', 'addlist', 'addtheme', 'share', 'proxy', 'socks', 'setlanguage', 'login', 'boost', 'contact', 'iv', 'invoice', 'giftcode', 'confirmphone'])

/** The channel, group or person a Telegram address is of (`/name`, `/s/name`), and the post if it is one (`/name/123`). */
export function telegramName(pathname: string): { name: string; post?: string } | null {
  const [, name, post] = /^\/(?:s\/)?([A-Za-z]\w{3,31})(?:\/(\d+))?\/?$/.exec(pathname) ?? []
  if (!name || TELEGRAM_PATHS.has(name.toLowerCase())) return null
  return post ? { name, post } : { name }
}

const decode = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
    const lower = code.toLowerCase()
    if (Object.hasOwn(named, lower)) return named[lower]
    const point = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10)
    return Number.isFinite(point) ? String.fromCodePoint(point) : all
  })

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined)

/** The card of a page from its HTML: title, description, picture and icon by what the page says (Open Graph, then the usual tags). `final`: the address the page came from after redirects. */
export function cardOfHtml(address: string, html: string, final: string): Card {
  const url = new URL(address)
  const meta = new Map<string, string>()
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase()
    const content = attr(tag, 'content')
    if (key && content && !meta.has(key)) meta.set(key, decode(content).trim())
  }
  const absolute = (href: string | undefined) => {
    try {
      return href ? new URL(decode(href), final).href : ''
    } catch {
      return ''
    }
  }
  const icons = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => tag).filter((tag) => /\bicon\b/i.test(attr(tag, 'rel') ?? ''))
  let image = absolute(meta.get('og:image') ?? meta.get('twitter:image'))
  // The picture of a channel, a group or a person on Telegram, by an address that stays: the one its page
  // names is signed for a while and goes stale. A post keeps its own picture.
  const telegram = /^(www\.)?(t\.me|telegram\.me|telegram\.dog)$/i.test(url.hostname)
  const channel = telegram ? telegramName(url.pathname) : null
  if (channel && !channel.post && /(^|\.)telesco\.pe$/i.test(new URL(image || 'x:').hostname)) image = `https://t.me/i/userpic/320/${channel.name}.jpg`
  return {
    url: url.href,
    title: meta.get('og:title') ?? meta.get('twitter:title') ?? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim(),
    description: (meta.get('og:description') ?? meta.get('description') ?? meta.get('twitter:description') ?? '').replace(/\s+/g, ' ').trim(),
    image,
    favicon: absolute(icons.length ? attr(icons[0], 'href') : '/favicon.ico'),
  }
}

/** The description as a few readable lines: no rows of hashtags, no runs of spaces, at most about 300 letters. */
export function cleanDescription(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    // A line of nothing but hashtags says nothing.
    .filter((line) => line && !/^(#[\p{L}\p{N}_]+[\s,]*)+$/u.test(line))
  let joined = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (joined.length > 300) {
    const cut = joined.slice(0, 300)
    joined = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 200)).replace(/[,.;:!?\s]+$/, '')}…`
  }
  return joined
}

/**
 * A video's card from what its two pages say: the oEmbed answer (title, channel, frame) and the watch page (the description under the
 * video, which only the page keeps). `page.error`: why the page could not be had. `null`: nothing says what the video is called.
 */
export function youtubeCard(embedText: string | null, page: { status: number; text: string } | { error: string }): { title: string; author: string; image: string; description: string; problem?: string } | null {
  let title = ''
  let author = ''
  let image = ''
  if (embedText) {
    try {
      const video = JSON.parse(embedText) as { title?: string; author_name?: string; thumbnail_url?: string }
      title = video.title ?? ''
      author = video.author_name ?? ''
      image = video.thumbnail_url ?? ''
    } catch {
      // The page may still say it.
    }
  }
  let description = ''
  // Why the description could not be had, to be told rather than guessed.
  let problem = 'error' in page ? page.error : page.status !== 200 ? `страница видео ответила ${page.status}` : ''
  if (!('error' in page) && page.status === 200) {
    const raw = /"shortDescription":"((?:\\.|[^"\\])*)"/.exec(page.text)?.[1]
    if (raw) {
      try {
        description = cleanDescription(JSON.parse(`"${raw}"`) as string)
      } catch {
        description = ''
      }
    }
    if (!title) title = /<meta\s+property="og:title"\s+content="([^"]*)"/.exec(page.text)?.[1] ?? ''
    if (!author) author = /"ownerChannelName":"((?:\\.|[^"\\])*)"/.exec(page.text)?.[1] ?? ''
    if (!description && !/"shortDescription"/.test(page.text)) problem = 'на странице видео нет описания (возможно, YouTube показал страницу согласия)'
  }
  if (!title) return null
  return { title, author, image, description: description || author, ...(problem ? { problem } : {}) }
}
