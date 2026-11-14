import { path, type App } from '../../api'
import { escape, WordSet, wordPattern, type Line } from '../../../shared/search-text'

export interface SearchResult {
  path: string
  /** Where the note matched best; decides its place in the list. */
  rank: number
  /** The alias that matched, when the note was found by one. */
  alias?: string
  /** First matching lines of the text; `total` counts all of them. */
  matches: Line[]
  total: number
}

interface Term {
  kind: 'text' | 'tag' | 'path'
  value: string
}

const MAX_FILES = 100

/** `word "exact phrase" tag:#project path:folder` -> terms that must all match. */
export function parseQuery(query: string): Term[] {
  const terms: Term[] = []
  for (const m of query.matchAll(/(?:(tag|path):)?(?:"([^"]+)"|(\S+))/gi)) {
    const kind = (m[1]?.toLowerCase() ?? 'text') as Term['kind']
    const value = (m[2] ?? m[3]).toLowerCase()
    terms.push({ kind, value: kind === 'tag' ? value.replace(/^#/, '') : value })
  }
  return terms.filter((term) => term.value)
}

/** The words to highlight in results. */
export const textTerms = (query: string) =>
  parseQuery(query)
    .filter((term) => term.kind === 'text')
    .map((term) => term.value)

/** What to light up in the results: the whole phrase where it stands together, otherwise the words. */
export function highlightPattern(query: string): RegExp | null {
  const words = textTerms(query)
  if (!words.length) return null
  const phrase = words.length > 1 ? [words.map(escape).join('\\s+')] : []
  return new RegExp(`(${[...phrase, ...words.map(wordPattern)].join('|')})`, 'giu')
}

/**
 * How well a name (a note's title or one of its aliases) answers the words
 * typed: the whole name, its beginning, the beginning of a word in it, or just
 * somewhere inside. 0 if some word is missing.
 */
function nameRank(name: string, words: string[], phrase: string): number {
  if (!words.length || !words.every((word) => name.includes(word))) return 0
  if (name === phrase) return 4
  if (name.startsWith(phrase)) return 3
  const starts = name.split(/[\s\-_.,/()]+/)
  return words.every((word) => starts.some((start) => start.startsWith(word))) ? 2 : 1
}

/** What a note's text says of the words: which of them it has, whether it has them together, and on how many lines. */
export interface Hit {
  mask: number
  phrase: boolean
  total: number
}
const NOTHING: Hit = { mask: 0, phrase: false, total: 0 }

/**
 * Every note that answers the query, ranked, without the lines to show (those are taken from the few that are shown).
 * The titles, aliases, tags and headings come from the page's own index; what the text says comes from `hitOf`, asked
 * for a note only when its names do not already settle it.
 */
function rank(app: App, terms: Term[], hitOf: (file: string) => Hit): Omit<SearchResult, 'matches'>[] {
  const words = terms.filter((term) => term.kind === 'text').map((term) => term.value)
  const phrase = words.join(' ')
  const wordIndex = new Map(words.map((word, i) => [word, i]))
  const results: Omit<SearchResult, 'matches'>[] = []
  for (const file of app.metadata.notes()) {
    const meta = app.metadata.get(file)
    const full = file.toLowerCase()
    const title = path.stripExt(path.basename(full))
    const aliases = meta?.aliases ?? []
    const names = [title, ...aliases.map((alias) => alias.toLowerCase())]
    const tags = (meta?.tags ?? []).map((tag) => tag.toLowerCase())
    let hit: Hit | undefined
    const text = () => (hit ??= hitOf(file))

    const matchesAll = terms.every((term) => {
      if (term.kind === 'path') return full.includes(term.value)
      if (term.kind === 'tag') return tags.some((tag) => tag === term.value || tag.startsWith(`${term.value}/`))
      // Each word may be found in a different place: the title, an alias or the text.
      // In a name any part of a word will do; in the text a word must begin with what was typed.
      return names.some((name) => name.includes(term.value)) || (text().mask & (1 << wordIndex.get(term.value)!)) !== 0
    })
    if (!matchesAll) continue

    const byTitle = nameRank(title, words, phrase)
    const aliasRanks = aliases.map((alias) => nameRank(alias.toLowerCase(), words, phrase))
    const byAlias = Math.max(0, ...aliasRanks)
    const inHeading = words.length > 0 && (meta?.headings ?? []).some((h) => words.every((word) => h.text.toLowerCase().includes(word)))
    const found = words.length ? text() : NOTHING
    // Title 400..100, alias 90..60, the phrase in the text 30, heading 20, text 10; a tie goes to the better kind of match.
    results.push({
      path: file,
      rank: byTitle ? byTitle * 100 : byAlias ? 50 + byAlias * 10 : found.phrase ? 30 : inHeading ? 20 : 10,
      alias: !byTitle && byAlias ? aliases[aliasRanks.indexOf(byAlias)] : undefined,
      total: found.total,
    })
  }
  return results.sort((a, b) => b.rank - a.rank || b.total - a.total || a.path.localeCompare(b.path, undefined, { numeric: true })).slice(0, MAX_FILES)
}

/** The search on this page alone, over the texts it holds. Used when the server cannot answer (an older one, a lost line). */
export function search(app: App, query: string): SearchResult[] {
  const terms = parseQuery(query)
  if (!terms.length) return []
  const words = textTerms(query)
  const set = new WordSet(words)
  const text = (file: string) => app.metadata.text(file) ?? ''
  return rank(app, terms, (file) => set.scan(text(file), false)).map((one) => ({ ...one, matches: words.length ? set.scan(text(one.path), true).matches : [] }))
}

/** `[path, mask, phrase, total]` per note, as the server answers. */
type Row = [string, number, number, number]

/**
 * The same search, with the texts looked through by the server, which keeps them in memory with an index of words:
 * this page does only the names, and nothing it does holds the typing. A server that cannot answer leaves the page
 * to the search above.
 */
export async function searchRemote(app: App, query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const terms = parseQuery(query)
  if (!terms.length) return []
  const words = textTerms(query)
  if (!words.length) return search(app, query)
  try {
    const rows = new Map((await app.vault.searchText<Row[]>({ words }, signal)).map(([file, mask, phrase, total]) => [file, { mask, phrase: !!phrase, total }]))
    const ranked = rank(app, terms, (file) => rows.get(file) ?? NOTHING)
    const lines = ranked.length ? await app.vault.searchText<Record<string, Line[]>>({ words, lines: ranked.map((one) => one.path) }, signal) : {}
    return ranked.map((one) => ({ ...one, matches: lines[one.path] ?? [] }))
  } catch (err) {
    if (signal.aborted) throw err
    return search(app, query)
  }
}
