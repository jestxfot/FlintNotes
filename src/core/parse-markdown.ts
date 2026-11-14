// Reading a note's text for what the index keeps: links, tags, headings, properties. Pure (no page, no vault), so that the
// server reads notes the same way the page does (server/search.ts) and the page need not.
import { parse as parseYaml } from 'yaml'

export interface LinkRef {
  /** File part of the link as written, without `#heading` and `|alias`. */
  target: string
  /** `#heading` part, or `''`. */
  subpath: string
  /** `![[embed]]` or `![image](path)`. */
  embed: boolean
  kind: 'wiki' | 'markdown'
  /** Zero-based line of the link. */
  line: number
  /** Where the file part sits in the note's text; rewriting a link replaces this range. */
  targetFrom: number
  targetTo: number
}

export interface HeadingRef {
  level: number
  text: string
  line: number
}

/** What the index knows about one note. */
export interface CachedMetadata {
  links: LinkRef[]
  /** Tags without `#`, from the text and from frontmatter. */
  tags: string[]
  /** Other names of the note, from the `aliases` property. */
  aliases: string[]
  headings: HeadingRef[]
  frontmatter: Record<string, unknown> | null
}

const WIKILINK = /(!?)\[\[([^\[\]|#\n]*)(#[^\[\]|\n]*)?(?:\|[^\[\]\n]*)?\]\]/dg
const MARKDOWN_LINK = /(!?)\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/dg
const TAG = /(^|[^\p{L}\p{N}_/#&;])#([\p{L}\p{N}_/-]+)/gu
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

function frontmatterTags(frontmatter: Record<string, unknown> | null): string[] {
  const value = frontmatter?.tags ?? frontmatter?.tag
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : []
  return list.map((tag) => String(tag).replace(/^#/, '')).filter(Boolean)
}

/** `aliases: [a, b]` or `aliases: a, b`; a single name may contain spaces, so only commas separate. */
function frontmatterAliases(frontmatter: Record<string, unknown> | null): string[] {
  const value = frontmatter?.aliases ?? frontmatter?.alias
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return list.map((alias) => String(alias ?? '').trim()).filter(Boolean)
}

const blank = (text: string, from: number, to: number) => text.slice(0, from) + ' '.repeat(to - from) + text.slice(to)

/** Extracts links, tags, headings and frontmatter from a note's text. */
export function parseMarkdown(text: string): CachedMetadata {
  const meta: CachedMetadata = { links: [], tags: [], aliases: [], headings: [], frontmatter: null }
  // Tags are case-insensitive; the first spelling seen is kept.
  const tags = new Map<string, string>()
  const addTag = (tag: string) => tags.has(tag.toLowerCase()) || tags.set(tag.toLowerCase(), tag)

  const lines = text.split('\n')
  let i = 0
  let offset = 0
  if (/^---\s*$/.test(lines[0])) {
    const end = lines.findIndex((line, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(line))
    if (end > 0) {
      try {
        const data = parseYaml(lines.slice(1, end).join('\n'))
        if (data && typeof data === 'object' && !Array.isArray(data)) meta.frontmatter = data
      } catch {
        // Invalid YAML: the note simply has no properties.
      }
      frontmatterTags(meta.frontmatter).forEach(addTag)
      meta.aliases = frontmatterAliases(meta.frontmatter)
      for (; i <= end; i++) {
        // `link: "[[Hub]]"` in the properties is a link like any other: it shows
        // up in backlinks, in the graph and in bases, and follows renames.
        for (const m of lines[i].matchAll(WIKILINK)) {
          const [from, to] = m.indices![2]!
          meta.links.push({ target: m[2].trim(), subpath: m[3] ?? '', embed: false, kind: 'wiki', line: i, targetFrom: offset + from, targetTo: offset + to })
        }
        offset += lines[i].length + 1
      }
    }
  }

  let fence: string | null = null
  for (; i < lines.length; offset += lines[i].length + 1, i++) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i])
    if (fence) {
      if (fenceMatch && fenceMatch[1].startsWith(fence) && !fenceMatch[2].trim()) fence = null
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      continue
    }
    const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(lines[i])
    if (heading) meta.headings.push({ level: heading[1].length, text: heading[2], line: i })

    // Inline code is blanked out (keeping offsets) so nothing inside it is indexed.
    let line = lines[i].replace(/`[^`]*`/g, (code) => ' '.repeat(code.length))
    for (const m of line.matchAll(WIKILINK)) {
      const [from, to] = m.indices![2]!
      meta.links.push({
        target: m[2].trim(),
        subpath: m[3] ?? '',
        embed: m[1] === '!',
        kind: 'wiki',
        line: i,
        targetFrom: offset + from,
        targetTo: offset + to,
      })
    }
    for (const m of line.matchAll(MARKDOWN_LINK)) {
      const raw = m[2].replace(/^<|>$/g, '')
      if (SCHEME.test(raw) || raw.startsWith('#')) continue
      const [file, ...rest] = raw.split('#')
      let target = file
      try {
        target = decodeURIComponent(file)
      } catch {
        // Not percent-encoded; use it as written.
      }
      const from = m.indices![2]![0] + (m[2].startsWith('<') ? 1 : 0)
      meta.links.push({
        target,
        subpath: rest.length ? `#${rest.join('#')}` : '',
        embed: m[1] === '!',
        kind: 'markdown',
        line: i,
        targetFrom: offset + from,
        targetTo: offset + from + file.length,
      })
    }
    // A `#` inside a link (`[[note#heading]]`, `page.md#part`) is not a tag.
    for (const m of [...line.matchAll(WIKILINK), ...line.matchAll(MARKDOWN_LINK)]) {
      line = blank(line, m.index, m.index + m[0].length)
    }
    for (const m of line.matchAll(TAG)) if (!/^\d+$/.test(m[2])) addTag(m[2])
  }
  meta.links.sort((a, b) => a.targetFrom - b.targetFrom)
  meta.tags = [...tags.values()]
  return meta
}
