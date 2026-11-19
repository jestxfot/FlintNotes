import { moment } from './moment'
import { expandVariables } from './variables'
import { Events } from './events'
import { pause } from './pause'
import { basename, dirname, extname, join, normalize, stripExt } from './path'
import type { Vault, VaultEntry } from './vault'

export { parseMarkdown, type CachedMetadata, type HeadingRef, type LinkRef } from './parse-markdown'
import { parseMarkdown, type CachedMetadata } from './parse-markdown'
import { outline, wordCount } from '../../shared/outline'

/** Notes whose links pointed at a renamed file, with the link texts they used. */
export interface AffectedLinks {
  source: string
  targets: string[]
}

/** What changed when the maps of links and tags were last brought up to date. */
export interface Resolution {
  /**
   * The notes whose links, tags, aliases, headings or properties changed; `null` when it may be any of them
   * (the notes were read at startup, or files came, went or were renamed).
   */
  notes: ReadonlySet<string> | null
  /** Whether files came, went or were renamed, so that a link written somewhere may now lead elsewhere. */
  names: boolean
}

type MetadataEvents = {
  /** A note was (re)parsed. */
  changed: [path: string]
  /** Links, backlinks and tags are up to date again. */
  resolved: [what: Resolution]
  /** A file was renamed; `affected` lists the links that pointed at its old path. */
  renamed: [path: string, oldPath: string, affected: AffectedLinks[]]
}

/** Everything about a note that other notes' links, the tag list or queries can depend on. */
const signature = (meta: CachedMetadata) =>
  JSON.stringify([meta.links.map((l) => [l.target, l.subpath, l.embed]), meta.tags, meta.aliases, meta.headings.map((h) => [h.level, h.text]), meta.frontmatter])

/** Earlier versions kept every note's text and index in the browser (tens of MB); the server holds them now, and what was kept is let go. */
function forgetKeptIndex(): void {
  void indexedDB
    .databases?.()
    .then((list) => list.forEach((db) => db.name?.startsWith('flint-index:') && indexedDB.deleteDatabase(db.name)))
    .catch(() => {})
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
  /** Goes up whenever links, tags or properties changed; a cheap way to tell that derived data is stale. */
  generation = 0
  /** Resolves once every note has been read for the first time. */
  readonly ready: Promise<void>
  private markReady!: () => void

  private cache = new Map<string, CachedMetadata>()
  /** Each note's list items, fields and reminders, with the note's line numbers (shared/outline.ts): what the readers of a whole vault look at. */
  private outlines = new Map<string, string>()
  /** Texts read on demand (see `read`): what the page does not hold for every note. */
  private loose = new Map<string, string>()
  private reading = new Map<string, Promise<string | undefined>>()
  private wordCounts = new Map<string, number>()
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

  constructor(private vault: Vault) {
    super()
    this.ready = new Promise((resolve) => (this.markReady = resolve))
  }

  /** Starts following the vault. Links by name resolve from here on; contents come with `load`. */
  init(): void {
    const { vault } = this
    // Files come and go in bursts (a folder copied in, a sync, the server finding what changed while it was off):
    // a link to the new file resolves at once, the maps of links are worked out once the burst is over.
    vault.on('create', (entry) => {
      if (entry.kind !== 'file') return
      this.addName(entry.path)
      // A note is read first (its own links come with it); any other file only changes where links by its name lead.
      if (isNote(entry)) void this.index(entry.path)
      else this.namesChanged(entry.path)
    })
    // Text saved by the app itself is taken as is; only changes made elsewhere are read from disk.
    vault.on('written', (entry, text) => {
      if (!isNote(entry)) return
      this.versions.set(entry.path, (this.versions.get(entry.path) ?? 0) + 1)
      this.indexed.set(entry.path, entry.mtime)
      this.store(entry.path, text)
    })
    vault.on('modify', (entry) => {
      if (!isNote(entry)) return
      if (this.indexed.get(entry.path) !== entry.mtime) {
        this.loose.delete(entry.path)
        void this.index(entry.path)
      }
    })
    vault.on('delete', (entry) => {
      const meta = this.cache.get(entry.path)
      this.cache.delete(entry.path)
      this.outlines.delete(entry.path)
      this.loose.delete(entry.path)
      this.wordCounts.delete(entry.path)
      if (entry.kind !== 'file') return
      // What the note said goes out of the maps; the links that led to it lead elsewhere or nowhere now.
      if (meta && !this.namesStale) {
        this.generation++
        this.unlink(entry.path, meta)
      }
      this.removeName(entry.path)
      this.namesChanged(entry.path)
    })
    vault.on('rename', (entry, oldPath) => this.onRename(entry, oldPath))
    this.rebuild()
  }

  /** Reads every note. Called once the first screen is up, so it does not hold that up. */
  load(): void {
    forgetKeptIndex()
    void this.indexAll().then(this.markReady)
  }

  get(path: string): CachedMetadata | undefined {
    return this.cache.get(path)
  }

  /** Text of a note as last read from disk, if the page has it: the notes opened or saved here, and those read for something. */
  text(path: string): string | undefined {
    return this.loose.get(path)
  }

  /** The text of a note: as the page has it, or read from the server (and kept for a while). Asked twice at once, it is read once. */
  read(path: string): Promise<string | undefined> {
    const held = this.text(path)
    if (held !== undefined) return Promise.resolve(held)
    let pending = this.reading.get(path)
    if (!pending) {
      pending = this.vault
        .read(path)
        .then((text): string | undefined => (this.keep(path, text), text))
        .catch(() => undefined)
        .finally(() => this.reading.delete(path))
      this.reading.set(path, pending)
    }
    return pending
  }

  /** A note is about to be opened (the pointer is down on it): its text is on its way, so that it opens without waiting for the server. */
  prefetch(path: string): void {
    const entry = this.vault.get(path)
    if (entry && isNote(entry)) void this.read(path)
  }

  /** The texts of several notes, a request for each two hundred. A note that is not there is left out. */
  async readMany(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const missing: string[] = []
    for (const path of paths) {
      const held = this.text(path)
      if (held !== undefined) out.set(path, held)
      else missing.push(path)
    }
    for (let i = 0; i < missing.length; i += 200) {
      const got = await this.vault.texts(missing.slice(i, i + 200)).catch(() => ({}) as Record<string, string>)
      for (const [path, text] of Object.entries(got)) {
        out.set(path, text)
        this.keep(path, text)
      }
    }
    return out
  }

  /** Texts read on demand are kept for a while (the newest 200), so that asking again does not ask the server again. */
  private keep(path: string, text: string): void {
    this.loose.delete(path)
    this.loose.set(path, text)
    for (const old of this.loose.keys()) {
      if (this.loose.size <= 200) break
      this.loose.delete(old)
    }
  }

  /**
   * What the readers of a whole vault (the tasks list, queries) look at in a note: its list items, fields and reminders at their
   * own line numbers, the prose left out. A note's prose changing leaves it as it was, so what is built from it is not built again.
   */
  outline(path: string): string | undefined {
    return this.outlines.get(path)
  }

  /** How many words the note has (see `wordCount`): the server counted them for every note, the page for the notes it has read. */
  words(path: string): number {
    return this.wordCounts.get(path) ?? 0
  }

  /** A note's text is in hand (it was saved here, or read after another program changed it): what is kept of every note is made from it. */
  private setText(path: string, text: string): void {
    this.keep(path, text)
    this.wordCounts.set(path, wordCount(text))
    this.outlines.set(path, outline(text))
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
    if (this.namesStale) this.makeNames()
    // A bare name that one file has (or none) leads there from any note: most links are such.
    if (!text.includes('/') && text !== '.' && text !== '..') {
      const named = this.names.get(text.toLowerCase())
      if (!named || named.length === 1) return named?.[0] ?? null
    }
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

  /**
   * Takes in what the server read of every note: the index entry and the outline of each, in one stream. The texts stay on the
   * server; a note's text is asked for when something needs it whole (`read`).
   */
  private async indexAll(): Promise<void> {
    performance.mark('flint:index-start')
    const known = new Set(this.vault.files().filter(isNote).map((entry) => entry.path))
    try {
      await this.vault.readIndex((note) => {
        // A note read on its own meanwhile (it was just edited) is newer than what the server sent; one made since is not in the list yet.
        if (this.versions.has(note.path) || !known.has(note.path)) return
        known.delete(note.path)
        this.cache.set(note.path, note.meta)
        this.outlines.set(note.path, note.outline)
        this.wordCounts.set(note.path, note.words)
        this.indexed.set(note.path, this.vault.get(note.path)!.mtime)
        this.trigger('changed', note.path)
      })
    } catch (err) {
      console.error('Reading the index of the notes failed; reading them one by one', err)
    }
    // Notes the stream did not carry (the server had not seen them yet): read one by one.
    const missing = [...known].filter((path) => !this.cache.has(path) && !this.versions.has(path))
    const queue = [...missing]
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        for (let path = queue.pop(); path; path = queue.pop()) await this.index(path)
      }),
    )
    // Queries list notes in the order of the files, whatever order they arrived in.
    const order = this.vault.files().filter(isNote).map((entry) => entry.path)
    const inOrder = new Set(order)
    const sorted = <T>(map: Map<string, T>) => new Map([...order.filter((path) => map.has(path)).map((path): [string, T] => [path, map.get(path)!]), ...[...map].filter(([path]) => !inOrder.has(path))])
    this.cache = sorted(this.cache)
    this.outlines = sorted(this.outlines)
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
    this.setText(path, text)
    this.cache.set(path, meta)
    this.trigger('changed', path)
    if (!this.loading && (!before || signature(before) !== signature(meta))) this.relink(path, before, meta)
  }

  /**
   * One note's links and tags are taken out of the maps and put in again as they are now: a link typed, a tag added
   * costs the links of that note, not those of the whole vault. Which file a link leads to does not change with that
   * (only files coming, going and renamed change it), so nothing else needs working out again.
   */
  private relink(path: string, before: CachedMetadata | undefined, meta: CachedMetadata): void {
    if (this.namesStale) return this.rebuild()
    this.generation++
    this.unlink(path, before)
    this.link(path, meta)
    // A note new to the index is a name that other notes' links may have been waiting for.
    if (!before) return this.namesChanged(path, path)
    this.trigger('resolved', { notes: new Set([path]), names: false })
  }

  /** Puts what a note says (its links and its tags) into the maps. */
  private link(source: string, meta: CachedMetadata): void {
    for (const link of meta.links) {
      const key = this.nameKey(link.target, source)
      if (key) push(this.linkedByName, key, source)
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

  /** Takes what a note said (as `meta` has it) out of the maps. */
  private unlink(source: string, meta: CachedMetadata | undefined): void {
    for (const link of meta?.links ?? []) {
      const key = this.nameKey(link.target, source)
      const sources = key ? this.linkedByName.get(key) : undefined
      const at = sources?.indexOf(source) ?? -1
      if (at >= 0) sources!.splice(at, 1)
      if (sources && !sources.length) this.linkedByName.delete(key)
    }
    for (const dest of this.resolvedLinks.get(source)?.keys() ?? []) {
      const sources = this.backlinkIndex.get(dest)
      sources?.delete(source)
      if (sources && !sources.size) this.backlinkIndex.delete(dest)
    }
    this.resolvedLinks.delete(source)
    this.unresolvedLinks.delete(source)
    for (const tag of meta?.tags ?? []) {
      const key = tag.toLowerCase()
      const entry = this.tagIndex.get(key)
      if (!entry) continue
      entry.files = entry.files.filter((file) => file !== source)
      if (!entry.files.length) this.tagIndex.delete(key)
    }
  }

  private onRename(entry: VaultEntry, oldPath: string): void {
    if (entry.kind !== 'file') return
    // Collected before the index forgets the old path.
    const affected = [...this.backlinks(oldPath).keys()].map((source) => {
      const links = this.cache.get(source)?.links ?? []
      const targets = links.filter((link) => this.resolve(link.target, source) === oldPath).map((l) => l.target)
      return { source, targets: [...new Set(targets)] }
    })
    // Only now are the names made again: the links above were read as they led before the rename.
    this.namesStale = true
    const meta = this.cache.get(oldPath)
    if (meta) {
      this.cache.delete(oldPath)
      this.cache.set(entry.path, meta)
      // What is kept of the note goes with it to its new name.
      const text = this.loose.get(oldPath)
      if (text !== undefined) this.keep(entry.path, text)
      this.loose.delete(oldPath)
      this.outlines.set(entry.path, this.outlines.get(oldPath) ?? '')
      this.outlines.delete(oldPath)
      this.wordCounts.set(entry.path, this.wordCounts.get(oldPath) ?? 0)
      this.wordCounts.delete(oldPath)
    } else if (isNote(entry)) {
      void this.index(entry.path)
    }
    this.rebuild()
    this.trigger('renamed', entry.path, oldPath, affected)
  }

  /** A file that came: links to it resolve from now on, before the maps of links are made again. */
  private addName(path: string): void {
    const lower = path.toLowerCase()
    const name = basename(lower)
    this.paths.set(lower, path)
    push(this.names, name, path)
    if (name.endsWith('.md')) push(this.names, name.slice(0, -3), path)
    this.resolved.clear()
  }

  /** A file that went: links by its name resolve without it from now on. */
  private removeName(path: string): void {
    const lower = path.toLowerCase()
    if (this.paths.get(lower) === path) this.paths.delete(lower)
    const name = basename(lower)
    for (const key of name.endsWith('.md') ? [name, name.slice(0, -3)] : [name]) {
      const list = this.names.get(key)
      const at = list?.indexOf(path) ?? -1
      if (at >= 0) list!.splice(at, 1)
      if (list && !list.length) this.names.delete(key)
    }
    this.resolved.clear()
  }

  /**
   * The name by which a link can lead to a file: the last part of where it points, without `.md`, in lower case. A file
   * named so is the only one that coming or going can change where the link leads (by name, by path, relative alike).
   */
  private nameKey(target: string, source: string): string {
    const text = this.expandTarget(target, source).trim()
    if (!text) return ''
    return basename(normalize(text).toLowerCase()).replace(/\.md$/, '')
  }

  /** Notes, by the name their links point with (`nameKey`): the ones to look at again when a file of that name comes or goes. */
  private linkedByName = new Map<string, string[]>()
  private pendingNames = new Set<string>()
  private pendingNotes = new Set<string>()
  private namesTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * A file came or went (`note`: a note just added to the maps): only the notes whose links point with its name are linked
   * again, a moment later, all the names of a burst together. A burst of many files (a folder copied in, a sync) is one
   * full rebuild instead.
   */
  private namesChanged(path: string, note?: string): void {
    if (this.loading) return
    if (this.namesStale) return this.rebuildSoon()
    this.pendingNames.add(basename(path.toLowerCase()).replace(/\.md$/, ''))
    if (note) this.pendingNotes.add(note)
    clearTimeout(this.namesTimer)
    this.namesTimer = setTimeout(() => this.relinkNames(), 80)
  }

  private relinkNames(): void {
    const names = [...this.pendingNames]
    const notes = new Set(this.pendingNotes)
    this.pendingNames.clear()
    this.pendingNotes.clear()
    if (this.namesStale || names.length > 200) return this.rebuild()
    for (const name of names) for (const source of this.linkedByName.get(name) ?? []) notes.add(source)
    this.generation++
    for (const source of notes) {
      const meta = this.cache.get(source)
      if (!meta) continue
      this.unlink(source, meta)
      this.link(source, meta)
    }
    this.trigger('resolved', { notes, names: true })
  }

  /** The files' names and paths are to be made again (a file went or was renamed); a new file is added to them as it comes. */
  private namesStale = true

  private makeNames(): void {
    this.namesStale = false
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
  }

  private rebuildTimer: ReturnType<typeof setTimeout> | undefined
  private rebuildSoon(): void {
    clearTimeout(this.rebuildTimer)
    this.rebuildTimer = setTimeout(() => this.rebuild(), 80)
  }

  // When files come, go or are renamed, any link may lead elsewhere: all of them are worked out again,
  // which costs a few map lookups per link. A note's own changes go through `relink`.
  private rebuild(): void {
    clearTimeout(this.rebuildTimer)
    this.generation++
    // Which file a link leads to changes only when files come, go or are renamed; a note's own text does not change it.
    if (this.namesStale) this.makeNames()
    this.resolvedLinks = new Map()
    this.unresolvedLinks = new Map()
    this.backlinkIndex = new Map()
    this.tagIndex = new Map()
    this.linkedByName = new Map()
    this.pendingNames.clear()
    this.pendingNotes.clear()
    clearTimeout(this.namesTimer)
    for (const [source, meta] of this.cache) this.link(source, meta)
    this.trigger('resolved', { notes: null, names: true })
  }
}
