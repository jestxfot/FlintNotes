import { parse as parseYaml } from 'yaml'
import { Events } from './events'
import { basename, dirname, extname, join, normalize, stripExt } from './path'
import type { Vault, VaultEntry } from './vault'

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

const blank = (text: string, from: number, to: number) => text.slice(0, from) + ' '.repeat(to - from) + text.slice(to)

/** Extracts links, tags, headings and frontmatter from a note's text. */
export function parseMarkdown(text: string): CachedMetadata {
  const meta: CachedMetadata = { links: [], tags: [], headings: [], frontmatter: null }
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
      for (; i <= end; i++) offset += lines[i].length + 1
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

/** Notes whose links pointed at a renamed file, with the link texts they used. */
export interface AffectedLinks {
  source: string
  targets: string[]
}

type MetadataEvents = {
  /** A note was (re)parsed. */
  changed: [path: string]
  /** Links, backlinks and tags are up to date again. */
  resolved: []
  /** A file was renamed; `affected` lists the links that pointed at its old path. */
  renamed: [path: string, oldPath: string, affected: AffectedLinks[]]
}

const isNote = (entry: VaultEntry) => entry.kind === 'file' && extname(entry.path) === 'md'

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function count<K>(map: Map<K, Map<string, number>>, key: K, inner: string): void {
  let counts = map.get(key)
  if (!counts) map.set(key, (counts = new Map()))
  counts.set(inner, (counts.get(inner) ?? 0) + 1)
}

/**
 * The index of the vault: parsed metadata of every note and the links between
 * them. It follows the vault's events, so it is always current; everything that
 * needs to know about note contents (backlinks, tags, search, graph) reads it.
 */
export class MetadataCache extends Events<MetadataEvents> {
  /** Source note -> linked file -> number of links. */
  resolvedLinks = new Map<string, Map<string, number>>()
  /** Source note -> link text that matches no file -> number of links. */
  unresolvedLinks = new Map<string, Map<string, number>>()
  /** Resolves once every note has been read for the first time. */
  ready: Promise<void> = Promise.resolve()

  private cache = new Map<string, CachedMetadata>()
  private texts = new Map<string, string>()
  private versions = new Map<string, number>()
  // Snapshots of the vault's files, rebuilt with the link maps.
  private paths = new Map<string, string>()
  private names = new Map<string, string[]>()
  private backlinkIndex = new Map<string, Map<string, number>>()
  private tagIndex = new Map<string, { tag: string; files: string[] }>()
  private loading = true

  constructor(private vault: Vault) {
    super()
  }

  init(): void {
    const { vault } = this
    vault.on('create', (entry) => (isNote(entry) ? void this.index(entry.path) : this.rebuild()))
    vault.on('modify', (entry) => isNote(entry) && void this.index(entry.path))
    vault.on('delete', (entry) => {
      this.cache.delete(entry.path)
      this.texts.delete(entry.path)
      this.rebuild()
    })
    vault.on('rename', (entry, oldPath) => this.onRename(entry, oldPath))
    this.rebuild()
    this.ready = this.indexAll()
  }

  get(path: string): CachedMetadata | undefined {
    return this.cache.get(path)
  }

  /** Text of a note as last read from disk. */
  text(path: string): string | undefined {
    return this.texts.get(path)
  }

  /** Paths of all indexed notes. */
  notes(): string[] {
    return [...this.cache.keys()]
  }

  /** Notes linking to `path`, with the number of links from each. */
  backlinks(path: string): Map<string, number> {
    return this.backlinkIndex.get(path) ?? new Map()
  }

  /** Every tag in the vault with the notes that have it. */
  tags(): { tag: string; files: string[] }[] {
    return [...this.tagIndex.values()]
  }

  /**
   * The file a link target refers to, as written in the note at `source`.
   * Matching ignores case and allows omitting `.md`. Tried in order: a path
   * from the vault root, a path relative to the note, a file of that name
   * anywhere (same folder first, then the shortest path).
   */
  resolve(target: string, source: string): string | null {
    const text = target.trim()
    if (!text) return source
    const wanted = normalize(text).toLowerCase()
    const relative = normalize(join(dirname(source), text)).toLowerCase()
    for (const candidate of [wanted, `${wanted}.md`, relative, `${relative}.md`]) {
      const hit = this.paths.get(candidate)
      if (hit) return hit
    }
    const matches = (this.names.get(basename(wanted)) ?? []).filter((path) => {
      const lower = `/${path.toLowerCase()}`
      return lower.endsWith(`/${wanted}`) || lower.endsWith(`/${wanted}.md`)
    })
    if (!matches.length) return null
    const folder = dirname(source)
    return (
      matches.find((path) => dirname(path) === folder) ??
      matches.sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
    )
  }

  /** Shortest wikilink text that leads from `source` to `path`: the bare name if unambiguous. */
  linkText(path: string, source: string): string {
    const note = extname(path) === 'md'
    const name = note ? stripExt(basename(path)) : basename(path)
    if (this.resolve(name, source) === path) return name
    return note ? path.slice(0, -3) : path
  }

  private async indexAll(): Promise<void> {
    const queue = this.vault.files().filter(isNote)
    const worker = async () => {
      for (let entry = queue.pop(); entry; entry = queue.pop()) await this.index(entry.path)
    }
    await Promise.all(Array.from({ length: 8 }, worker))
    this.loading = false
    this.rebuild()
  }

  private async index(path: string): Promise<void> {
    const version = (this.versions.get(path) ?? 0) + 1
    this.versions.set(path, version)
    const text = await this.vault.read(path).catch(() => null)
    // Skip if the file is gone or a newer read of it has started meanwhile.
    if (text === null || this.versions.get(path) !== version || !this.vault.get(path)) return
    this.texts.set(path, text)
    this.cache.set(path, parseMarkdown(text))
    this.trigger('changed', path)
    if (!this.loading) this.rebuild()
  }

  private onRename(entry: VaultEntry, oldPath: string): void {
    if (entry.kind !== 'file') return
    // Collected before the index forgets the old path.
    const affected = [...this.backlinks(oldPath).keys()].map((source) => {
      const links = this.cache.get(source)?.links ?? []
      const targets = links.filter((link) => this.resolve(link.target, source) === oldPath).map((l) => l.target)
      return { source, targets: [...new Set(targets)] }
    })
    const meta = this.cache.get(oldPath)
    if (meta) {
      this.cache.delete(oldPath)
      this.cache.set(entry.path, meta)
      this.texts.set(entry.path, this.texts.get(oldPath) ?? '')
      this.texts.delete(oldPath)
    } else if (isNote(entry)) {
      void this.index(entry.path)
    }
    this.rebuild()
    this.trigger('renamed', entry.path, oldPath, affected)
  }

  // Recomputing everything on each change keeps the index trivially correct and
  // costs a few map lookups per link.
  private rebuild(): void {
    this.paths.clear()
    this.names.clear()
    for (const file of this.vault.files()) {
      const lower = file.path.toLowerCase()
      const name = basename(lower)
      this.paths.set(lower, file.path)
      push(this.names, name, file.path)
      if (name.endsWith('.md')) push(this.names, name.slice(0, -3), file.path)
    }
    this.resolvedLinks = new Map()
    this.unresolvedLinks = new Map()
    this.backlinkIndex = new Map()
    this.tagIndex = new Map()
    for (const [source, meta] of this.cache) {
      for (const link of meta.links) {
        const dest = this.resolve(link.target, source)
        if (dest) {
          count(this.resolvedLinks, source, dest)
          count(this.backlinkIndex, dest, source)
        } else {
          count(this.unresolvedLinks, source, link.target)
        }
      }
      for (const tag of meta.tags) {
        const key = tag.toLowerCase()
        const entry = this.tagIndex.get(key)
        if (entry) entry.files.push(source)
        else this.tagIndex.set(key, { tag, files: [source] })
      }
    }
    this.trigger('resolved')
  }
}
