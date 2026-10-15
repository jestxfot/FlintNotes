import { parse as parseYaml } from 'yaml'
import { IndexCache } from './index-cache'
import { moment } from './moment'
import { expandVariables } from './variables'
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

/** Everything about a note that other notes' links, the tag list or queries can depend on. */
const signature = (meta: CachedMetadata) =>
  JSON.stringify([meta.links.map((l) => [l.target, l.subpath, l.embed]), meta.tags, meta.aliases, meta.headings.map((h) => [h.level, h.text]), meta.frontmatter])

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
  /** Goes up whenever links, tags or properties changed; a cheap way to tell that derived data is stale. */
  generation = 0
  /** Resolves once every note has been read for the first time. */
  readonly ready: Promise<void>
  private markReady!: () => void

  private cache = new Map<string, CachedMetadata>()
  private texts = new Map<string, string>()
  private versions = new Map<string, number>()
  // Snapshots of the vault's files, rebuilt with the link maps.
  private paths = new Map<string, string>()
  private names = new Map<string, string[]>()
  private backlinkIndex = new Map<string, Map<string, number>>()
  private tagIndex = new Map<string, { tag: string; files: string[] }>()
  private loading = true
  /** Modification time of each note as last indexed; a `modify` for a time already seen is skipped. */
  private indexed = new Map<string, number>()
  /** Answers of `resolve` since the last rebuild; the same links are asked about again and again. */
  private resolved = new Map<string, string | null>()
  /** The index as it was at the end of the last visit, kept by the browser. */
  private stored: IndexCache | null = null

  constructor(private vault: Vault) {
    super()
    this.ready = new Promise((resolve) => (this.markReady = resolve))
  }

  /** Starts reading the index the browser kept, as early as the vault is known: it arrives while the rest starts. */
  prefetch(): void {
    this.stored ??= new IndexCache(this.vault.urlName || 'vault')
  }

  /** Starts following the vault. Links by name resolve from here on; contents come with `load`. */
  init(): void {
    const { vault } = this
    vault.on('create', (entry) => (isNote(entry) ? void this.index(entry.path) : this.rebuild()))
    // Text saved by the app itself is taken as is; only changes made elsewhere are read from disk.
    vault.on('written', (entry, text) => {
      if (!isNote(entry)) return
      this.versions.set(entry.path, (this.versions.get(entry.path) ?? 0) + 1)
      this.indexed.set(entry.path, entry.mtime)
      this.store(entry.path, text)
    })
    vault.on('modify', (entry) => isNote(entry) && this.indexed.get(entry.path) !== entry.mtime && void this.index(entry.path))
    vault.on('delete', (entry) => {
      this.cache.delete(entry.path)
      this.texts.delete(entry.path)
      this.stored?.remove(entry.path)
      this.rebuild()
    })
    vault.on('rename', (entry, oldPath) => this.onRename(entry, oldPath))
    this.rebuild()
  }

  /** Reads every note. Called once the first screen is up, so it does not hold that up. */
  load(): void {
    void this.indexAll().then(this.markReady)
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
    const text = this.expandTarget(target, source).trim()
    if (!text) return source
    // The answer depends on the target and on the folder of the linking note.
    const key = `${dirname(source)}\n${text}`
    let answer = this.resolved.get(key)
    if (answer === undefined) this.resolved.set(key, (answer = this.find(text, source)))
    return answer
  }

  /**
   * A link whose target is written with a date variable, `[[{{date+1d:YYYY-MM-DD}}|tomorrow]]`,
   * in a note named after a day, points to the day counted from that note's own.
   * Obsidian's core templates leave such variables unexpanded when they create a
   * daily note (only Periodic Notes and Calendar work them out), so vaults are
   * full of these links; here they lead where they were meant to.
   */
  expandTarget(target: string, source: string): string {
    if (!target.includes('{{')) return target
    const name = basename(source).replace(/\.md$/i, '')
    const day = moment(/\d{4}-\d{2}-\d{2}/.exec(name)?.[0] ?? '')
    return day.isValid() ? expandVariables(target, name, day) : target
  }

  private find(text: string, source: string): string | null {
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

  /** Puts a note as it is now into the index kept by the browser. */
  private remember(path: string): void {
    const entry = this.vault.get(path)
    const text = this.texts.get(path)
    const meta = this.cache.get(path)
    if (entry && text !== undefined && meta) this.stored?.put({ path, mtime: entry.mtime, size: entry.size, text, meta })
  }

  /**
   * Reads every note. Notes whose file has not changed since the last visit come
   * from the index the browser kept, already parsed; only the others are read
   * from the server: one by one when they are few, in one stream when they are many.
   */
  private async indexAll(): Promise<void> {
    this.stored ??= new IndexCache(this.vault.urlName || 'vault')
    performance.mark('flint:index-start')
    const kept = await this.stored.readAll()
    performance.mark('flint:index-kept')
    const notes = this.vault.files().filter(isNote)
    const stale: string[] = []
    let sliceStart = performance.now()
    for (const entry of notes) {
      const known = kept.get(entry.path)
      kept.delete(entry.path)
      if (!known || known.mtime !== entry.mtime || known.size !== entry.size) {
        stale.push(entry.path)
        continue
      }
      // A note read on its own meanwhile (it was just edited) is newer than what was kept.
      if (this.versions.has(entry.path)) continue
      this.texts.set(entry.path, known.text)
      this.cache.set(entry.path, known.meta)
      this.indexed.set(entry.path, entry.mtime)
      this.trigger('changed', entry.path)
      if (performance.now() - sliceStart > 12) {
        await new Promise((resume) => setTimeout(resume))
        sliceStart = performance.now()
      }
    }
    // What was kept for notes that are gone is forgotten.
    for (const path of kept.keys()) this.stored.remove(path)

    const take = (path: string, text: string) => {
      if (this.versions.has(path) || !this.vault.get(path)) return
      this.texts.set(path, text)
      this.cache.set(path, parseMarkdown(text))
      this.indexed.set(path, this.vault.get(path)!.mtime)
      this.remember(path)
      this.trigger('changed', path)
    }
    const oneByOne = async (paths: string[]) => {
      const queue = [...paths]
      const worker = async () => {
        for (let path = queue.pop(); path; path = queue.pop()) {
          const text = await this.vault.read(path).catch(() => null)
          if (text !== null) take(path, text)
        }
      }
      await Promise.all(Array.from({ length: 8 }, worker))
    }
    if (stale.length > 150) {
      const wanted = new Set(stale)
      try {
        await this.vault.readNotes((path, text) => wanted.has(path) && take(path, text))
      } catch (err) {
        console.error('Reading all notes at once failed; reading them one by one', err)
        await oneByOne(stale.filter((path) => !this.cache.has(path)))
      }
    } else await oneByOne(stale)
    // Notes came from the kept index and from the server in no set order; queries list them
    // in the order of the files, whatever way they arrived.
    const order = this.vault.files().filter(isNote).map((entry) => entry.path)
    const inOrder = new Set(order)
    const sorted = <T>(map: Map<string, T>) => new Map([...order.filter((path) => map.has(path)).map((path): [string, T] => [path, map.get(path)!]), ...[...map].filter(([path]) => !inOrder.has(path))])
    this.cache = sorted(this.cache)
    this.texts = sorted(this.texts)
    this.loading = false
    this.rebuild()
    performance.mark('flint:index')
  }

  private async index(path: string): Promise<void> {
    const version = (this.versions.get(path) ?? 0) + 1
    this.versions.set(path, version)
    const text = await this.vault.read(path).catch(() => null)
    // Skip if the file is gone or a newer read of it has started meanwhile.
    if (text === null || this.versions.get(path) !== version || !this.vault.get(path)) return
    this.indexed.set(path, this.vault.get(path)!.mtime)
    this.store(path, text)
  }

  /**
   * Takes in a note's new text. Links, backlinks and tags are worked out again
   * only if the note's own links, tags, names, headings or properties changed;
   * ordinary typing leaves them alone.
   */
  private store(path: string, text: string): void {
    const before = this.cache.get(path)
    const meta = parseMarkdown(text)
    this.texts.set(path, text)
    this.cache.set(path, meta)
    this.remember(path)
    this.trigger('changed', path)
    if (!this.loading && (!before || signature(before) !== signature(meta))) this.rebuild()
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
      this.stored?.remove(oldPath)
      this.remember(entry.path)
    } else if (isNote(entry)) {
      void this.index(entry.path)
    }
    this.rebuild()
    this.trigger('renamed', entry.path, oldPath, affected)
  }

  // Recomputing everything on each change keeps the index trivially correct and
  // costs a few map lookups per link.
  private rebuild(): void {
    this.generation++
    this.resolved.clear()
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
          count(this.unresolvedLinks, source, this.expandTarget(link.target, source))
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
