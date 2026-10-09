import { path, type App } from '../../api'

export interface SearchResult {
  path: string
  /** Where the note matched best; decides its place in the list. */
  rank: number
  /** The alias that matched, when the note was found by one. */
  alias?: string
  /** First matching lines of the text; `total` counts all of them. */
  matches: { line: number; text: string }[]
  total: number
}

interface Term {
  kind: 'text' | 'tag' | 'path'
  value: string
}

const SHOWN_LINES = 5
const MAX_FILES = 100
const SNIPPET = 140

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

/** Cuts a long line down to the part around the first match. */
function snippet(line: string, at: number): string {
  const text = line.trim()
  if (text.length <= SNIPPET) return text
  const start = Math.max(0, at - (line.length - line.trimStart().length) - 40)
  return (start ? '…' : '') + text.slice(start, start + SNIPPET) + (start + SNIPPET < text.length ? '…' : '')
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

/**
 * Finds notes by their titles, aliases and text. Titles come first, then
 * aliases, then headings, then plain text; within each, the closer match wins.
 */
export function search(app: App, query: string): SearchResult[] {
  const terms = parseQuery(query)
  if (!terms.length) return []
  const words = terms.filter((term) => term.kind === 'text').map((term) => term.value)
  const phrase = words.join(' ')
  const results: SearchResult[] = []

  for (const file of app.metadata.notes()) {
    const meta = app.metadata.get(file)
    const text = app.metadata.text(file) ?? ''
    const lower = text.toLowerCase()
    const full = file.toLowerCase()
    const title = path.stripExt(path.basename(full))
    const aliases = meta?.aliases ?? []
    const names = [title, ...aliases.map((alias) => alias.toLowerCase())]
    const tags = (meta?.tags ?? []).map((tag) => tag.toLowerCase())

    const matchesAll = terms.every((term) => {
      if (term.kind === 'path') return full.includes(term.value)
      if (term.kind === 'tag') return tags.some((tag) => tag === term.value || tag.startsWith(`${term.value}/`))
      // Each word may be found in a different place: the title, an alias or the text.
      return lower.includes(term.value) || names.some((name) => name.includes(term.value))
    })
    if (!matchesAll) continue

    const byTitle = nameRank(title, words, phrase)
    const aliasRanks = aliases.map((alias) => nameRank(alias.toLowerCase(), words, phrase))
    const byAlias = Math.max(0, ...aliasRanks)
    const inHeading = words.length > 0 && (meta?.headings ?? []).some((h) => words.every((word) => h.text.toLowerCase().includes(word)))
    // Title 400..100, alias 90..60, heading 20, text 10; a tie goes to the better kind of match.
    const rank = byTitle ? byTitle * 100 : byAlias ? 50 + byAlias * 10 : inHeading ? 20 : 10

    const matches: SearchResult['matches'] = []
    let total = 0
    if (words.length) {
      text.split('\n').forEach((line, number) => {
        const lineLower = line.toLowerCase()
        const at = Math.min(...words.map((word) => lineLower.indexOf(word)).filter((i) => i >= 0))
        if (at === Infinity) return
        if (++total <= SHOWN_LINES) matches.push({ line: number, text: snippet(line, at) })
      })
    }
    results.push({
      path: file,
      rank,
      alias: !byTitle && byAlias ? aliases[aliasRanks.indexOf(byAlias)] : undefined,
      matches,
      total,
    })
  }
  return results
    .sort((a, b) => b.rank - a.rank || b.total - a.total || a.path.localeCompare(b.path, undefined, { numeric: true }))
    .slice(0, MAX_FILES)
}
