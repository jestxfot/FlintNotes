// The notes' text, kept in the server's memory, and the search of it.
//
// The page used to hold every note's text and look through all of it, on its own thread, at each pause in the typing:
// 25-110 ms on a vault a third of the real one, with the keys waiting. Here the text is read once, indexed by word, and
// kept up to date from what the watcher sees; a search looks only at the notes that have the words, a few at a time, so
// that the server answers others between the slices. The same texts answer `GET /api/notes` (the page reading the
// vault at start), so that is not a read of three thousand files each time either.

import fs from 'node:fs/promises'
import path from 'node:path'
import { WordSet, type TextHit, type Line } from '../shared/search-text'
import { outline, wordCount } from '../shared/outline'
import { parseMarkdown, type CachedMetadata } from '../src/core/parse-markdown'

/** A word as the index has it: lower case, the final sigma written as the other (the page's patterns ignore case, `ς` and `σ` alike). */
const fold = (word: string) => word.toLowerCase().replace(/ς/g, 'σ')
const TOKEN = /[\p{L}\p{N}]+/gu

/** Only words made of letters and digits are found through the index; one with a dash or a dot in it is looked for in every text. */
const plainWord = (word: string) => /^[\p{L}\p{N}]+$/u.test(word)

/** The time one slice of work may take before the server is let to do something else, ms. */
const SLICE = 8
const yieldToServer = () => new Promise<void>((resume) => setImmediate(resume))

export interface NoteHit {
  path: string
  hit: Omit<TextHit, 'matches'>
}

/** What the page keeps of a note instead of its text: what the index knows of it, and the lines the readers of a vault look at. */
export interface Derived {
  meta: CachedMetadata
  outline: string
  words: number
}

export class NoteStore {
  private texts = new Map<string, string>()
  /** `parseMarkdown` and the outline of each note, worked out when first asked for and again after the note changes. */
  private derived = new Map<string, Derived>()
  /** Every word of the texts, with the notes it is in; `sorted` is the same words in order, for looking up a beginning. */
  private words = new Map<string, Set<string>>()
  private sorted: string[] | null = null
  /** The words each note has now, to take them out of the index when it changes. */
  private tokens = new Map<string, string[]>()
  private dirty = new Set<string>()
  private loading: Promise<void> | null = null
  /** The word index is built after the texts are read, in the background: until then a search looks through the texts themselves. */
  private indexed = false
  private indexing: Promise<void> | null = null

  constructor(
    private root: string,
    /** The vault's notes now: paths, md only. */
    private list: () => Promise<string[]>,
  ) {}

  /** A note was created, changed or deleted (the watcher saw it): it is read again before the next answer. */
  touch(file: string): void {
    if (this.loading || this.texts.size) this.dirty.add(file)
  }

  /** The watcher lost count of what changed: every note is read again. */
  touchAll(): void {
    for (const file of this.texts.keys()) this.dirty.add(file)
  }

  /** Reads what is not read yet. The first call reads everything; later ones only what `touch` named. */
  load(each?: (batch: [string, string][]) => Promise<void>): Promise<void> {
    return (this.loading ??= this.fill(each).finally(() => (this.loading = null)))
  }

  /** `each` gets the notes as they are read, so that a page reading the vault can start on them at once. */
  private async fill(each?: (batch: [string, string][]) => Promise<void>): Promise<void> {
    const files = new Set(await this.list())
    const first = !this.texts.size
    const wanted = first ? [...files] : [...this.dirty]
    this.dirty.clear()
    let slice = performance.now()
    for (let i = 0; i < wanted.length; i += 32) {
      const batch: [string, string][] = []
      await Promise.all(
        wanted.slice(i, i + 32).map(async (file) => {
          const text = files.has(file) ? await fs.readFile(path.join(this.root, file), 'utf8').catch(() => null) : null
          if (text === null) this.drop(file)
          else (this.put(file, text), batch.push([file, text]))
        }),
      )
      // A page that went away mid-way must not leave the store half read: the reading goes on without it.
      if (each) await each(batch).catch(() => (each = undefined))
      if (performance.now() - slice > SLICE) (await yieldToServer(), (slice = performance.now()))
    }
    // A note gone from the list without the watcher saying so.
    for (const file of this.texts.keys()) if (!files.has(file)) this.drop(file)
    // The word index, then each note's index entry and outline (a page starting later finds them made): both in the background.
    if (first && !this.indexing) setTimeout(() => void this.buildIndex().then(() => this.derivedAll(async () => {})), 1500).unref()
  }

  /** Every word of every note, a few notes at a time. Searches before it is done look through the texts instead. */
  private buildIndex(): Promise<void> {
    return (this.indexing ??= (async () => {
      let slice = performance.now()
      for (const file of [...this.texts.keys()]) {
        const text = this.texts.get(file)
        if (text !== undefined && !this.tokens.has(file)) this.index(file, text)
        if (performance.now() - slice > SLICE) (await yieldToServer(), (slice = performance.now()))
      }
      this.indexed = true
    })())
  }

  private put(file: string, text: string): void {
    this.drop(file)
    this.derived.delete(file)
    this.texts.set(file, text)
    // Once the index is being built, a note that changes is indexed at once: one note is a few ms.
    if (this.indexing) this.index(file, text)
  }

  private index(file: string, text: string): void {
    const mine = new Set<string>()
    for (const match of text.toLowerCase().matchAll(TOKEN)) mine.add(fold(match[0]))
    for (const word of mine) {
      let notes = this.words.get(word)
      if (!notes) (notes = new Set()), this.words.set(word, notes), (this.sorted = null)
      notes.add(file)
    }
    this.tokens.set(file, [...mine])
  }

  private drop(file: string): void {
    this.derived.delete(file)
    if (!this.texts.delete(file)) return
    for (const word of this.tokens.get(file) ?? []) {
      const notes = this.words.get(word)
      notes?.delete(file)
      if (notes && !notes.size) (this.words.delete(word), (this.sorted = null))
    }
    this.tokens.delete(file)
  }

  /** Every note with its text, for the page reading the vault at start: handed over in batches, as they are read the first time. */
  async all(each: (batch: [string, string][]) => Promise<void>): Promise<void> {
    if (!this.texts.size && !this.loading) return this.load(each)
    await this.load()
    const notes = [...this.texts]
    for (let i = 0; i < notes.length; i += 32) await each(notes.slice(i, i + 32))
  }

  /** The texts of the given notes (those that are notes the store has): asked for the few the page needs whole, not for every note. */
  async pick(files: string[]): Promise<Record<string, string>> {
    await this.load()
    const out: Record<string, string> = {}
    for (const file of files.slice(0, 500)) {
      const text = this.texts.get(file)
      if (text !== undefined) out[file] = text
    }
    return out
  }

  /** The index entry and the outline of every note, for the page reading the vault at start (it keeps these, not the texts); handed over in batches. */
  async derivedAll(each: (batch: [string, Derived][]) => Promise<void>): Promise<void> {
    await this.load()
    const files = [...this.texts.keys()]
    let slice = performance.now()
    for (let i = 0; i < files.length; i += 32) {
      const batch: [string, Derived][] = []
      for (const file of files.slice(i, i + 32)) {
        let made = this.derived.get(file)
        const text = this.texts.get(file)
        if (!made && text !== undefined) this.derived.set(file, (made = { meta: parseMarkdown(text), outline: outline(text), words: wordCount(text) }))
        if (made) batch.push([file, made])
        if (performance.now() - slice > SLICE) (await yieldToServer(), (slice = performance.now()))
      }
      await each(batch)
    }
  }

  /** The notes that may have `word` at the beginning of a word (for one or two letters, as a whole word). */
  private notesWith(word: string): Set<string> {
    const folded = fold(word)
    if ([...folded].length < 3) return this.words.get(folded) ?? new Set()
    const sorted = (this.sorted ??= [...this.words.keys()].sort())
    let low = 0
    let high = sorted.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (sorted[mid] < folded) low = mid + 1
      else high = mid
    }
    const found = new Set<string>()
    for (let i = low; i < sorted.length && sorted[i].startsWith(folded); i++) for (const file of this.words.get(sorted[i])!) found.add(file)
    return found
  }

  /** What the texts say of the typed words: for each note that has at least one of them. Sliced, so as not to hold the server. */
  async find(words: string[]): Promise<NoteHit[]> {
    await this.load()
    if (!words.length || words.length > 8) return []
    const set = new WordSet(words)
    let candidates: Iterable<string>
    if (this.indexed && words.every(plainWord)) {
      const union = new Set<string>()
      for (const word of words) for (const file of this.notesWith(word)) union.add(file)
      candidates = union
    } else candidates = this.texts.keys()
    const out: NoteHit[] = []
    let slice = performance.now()
    for (const file of candidates) {
      const text = this.texts.get(file)
      if (text === undefined) continue
      const { matches: _, ...hit } = set.scan(text, false)
      if (hit.mask) out.push({ path: file, hit })
      if (performance.now() - slice > SLICE) (await yieldToServer(), (slice = performance.now()))
    }
    return out
  }

  /** The best lines of the given notes: asked for the few that are shown, not for every note found. */
  async lines(words: string[], files: string[]): Promise<Record<string, Line[]>> {
    await this.load()
    const set = new WordSet(words)
    const out: Record<string, Line[]> = {}
    for (const file of files.slice(0, 200)) {
      const text = this.texts.get(file)
      if (text !== undefined) out[file] = set.scan(text, true).matches
    }
    return out
  }
}
