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

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/**
 * A typed word as it is looked for in text: at the beginning of a word, so that
 * `he` does not find every `the`; a word of one or two letters only as a whole word.
 */
const wordPattern = (word: string) => `(?<![\\p{L}\\p{N}])${escape(word)}${[...word].length < 3 ? '(?![\\p{L}\\p{N}])' : ''}`
const wordRegex = (word: string) => new RegExp(wordPattern(word), 'iu')

/** What to light up in the results: the whole phrase where it stands together, otherwise the words. */
export function highlightPattern(query: string): RegExp | null {
  const words = textTerms(query)
  if (!words.length) return null
  const phrase = words.length > 1 ? [words.map(escape).join('\\s+')] : []
  return new RegExp(`(${[...phrase, ...words.map(wordPattern)].join('|')})`, 'giu')
}

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
  const patterns = new Map(words.map((word) => [word, wordRegex(word)]))
  // Several words typed together are first of all a phrase: notes that have it as written come before
  // notes that merely have all of its words somewhere.
  const phraseRegex = words.length > 1 ? new RegExp(words.map(escape).join('\\s+'), 'iu') : null
  // Every place a word begins, to come to the lines that have the words without going through every line of every note.
  const anyWord = words.length ? new RegExp(words.map(wordPattern).join('|'), 'giu') : null

  for (const file of app.metadata.notes()) {
    const meta = app.metadata.get(file)
    const text = app.metadata.text(file) ?? ''
    const full = file.toLowerCase()
    const title = path.stripExt(path.basename(full))
    const aliases = meta?.aliases ?? []
    const names = [title, ...aliases.map((alias) => alias.toLowerCase())]
    const tags = (meta?.tags ?? []).map((tag) => tag.toLowerCase())

    const matchesAll = terms.every((term) => {
      if (term.kind === 'path') return full.includes(term.value)
      if (term.kind === 'tag') return tags.some((tag) => tag === term.value || tag.startsWith(`${term.value}/`))
      // Each word may be found in a different place: the title, an alias or the text.
      // In a name any part of a word will do; in the text a word must begin with what was typed.
      // (The text is not lowered as a whole first: for every note on every search that took twenty times longer than the search.)
      return names.some((name) => name.includes(term.value)) || patterns.get(term.value)!.test(text)
    })
    if (!matchesAll) continue

    const byTitle = nameRank(title, words, phrase)
    const aliasRanks = aliases.map((alias) => nameRank(alias.toLowerCase(), words, phrase))
    const byAlias = Math.max(0, ...aliasRanks)
    const inHeading = words.length > 0 && (meta?.headings ?? []).some((h) => words.every((word) => h.text.toLowerCase().includes(word)))
    const hasPhrase = !!phraseRegex && phraseRegex.test(text)
    // Title 400..100, alias 90..60, the phrase in the text 30, heading 20, text 10; a tie goes to the better kind of match.
    const rank = byTitle ? byTitle * 100 : byAlias ? 50 + byAlias * 10 : hasPhrase ? 30 : inHeading ? 20 : 10

    // The lines shown are the ones that answer best: with the phrase; failing that, with all the
    // words; failing that, with the most of them. A line that has one small word of four says nothing.
    const matches: SearchResult['matches'] = []
    let total = 0
    if (anyWord) {
      const found: { line: number; at: number; score: number; text: string }[] = []
      let number = 0
      let counted = 0
      let end = -1
      for (const match of text.matchAll(anyWord)) {
        if (match.index <= end) continue
        const start = text.lastIndexOf('\n', match.index - 1) + 1
        for (let at = text.indexOf('\n', counted); at >= 0 && at < start; at = text.indexOf('\n', at + 1)) number++
        counted = start
        end = text.indexOf('\n', match.index)
        if (end < 0) end = text.length
        const line = text.slice(start, end)
        const phraseAt = phraseRegex ? line.search(phraseRegex) : -1
        if (phraseAt >= 0) {
          found.push({ line: number, at: phraseAt, score: words.length + 1, text: line })
          continue
        }
        let score = 0
        let at = Infinity
        for (const word of words) {
          const index = line.search(patterns.get(word)!)
          if (index < 0) continue
          score++
          at = Math.min(at, index)
        }
        if (score) found.push({ line: number, at, score, text: line })
      }
      const best = Math.max(0, ...found.map((one) => one.score))
      // With several words, a line must have at least half of them (and never fewer than the best line by more than one).
      const enough = Math.max(best - 1, Math.ceil(words.length / 2), 1)
      const kept = found.filter((one) => one.score >= Math.min(best, enough)).sort((a, b) => b.score - a.score || a.line - b.line)
      total = kept.length
      for (const one of kept.slice(0, SHOWN_LINES).sort((a, b) => a.line - b.line)) matches.push({ line: one.line, text: snippet(one.text, one.at) })
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
