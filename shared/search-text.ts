// How a note's text is searched. One piece of code for the page (the search it falls back to when the server cannot
// answer) and for the server (which keeps the texts and answers while the page does something else), so that the two
// can never find different things. No imports: both sides load it.

export const SHOWN_LINES = 5
export const SNIPPET = 140

export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A typed word as it is looked for in text: at the beginning of a word, so that
 * `he` does not find every `the`; a word of one or two letters only as a whole word.
 */
export const wordPattern = (word: string) => `(?<![\\p{L}\\p{N}])${escape(word)}${[...word].length < 3 ? '(?![\\p{L}\\p{N}])' : ''}`
export const wordRegex = (word: string) => new RegExp(wordPattern(word), 'iu')

/** Cuts a long line down to the part around the first match. */
export function snippet(line: string, at: number): string {
  const text = line.trim()
  if (text.length <= SNIPPET) return text
  const start = Math.max(0, at - (line.length - line.trimStart().length) - 40)
  return (start ? '…' : '') + text.slice(start, start + SNIPPET) + (start + SNIPPET < text.length ? '…' : '')
}

export interface Line {
  line: number
  text: string
}

/** What the text of one note says about the typed words. */
export interface TextHit {
  /** Bit `i` is set when word `i` is in the text. */
  mask: number
  /** The words stand together, as typed, somewhere in the text. */
  phrase: boolean
  /** How many lines answer (the lines shown are the best of them). */
  total: number
  /** The best lines; only made when asked for (`lines`). */
  matches: Line[]
}

/** The patterns for a set of words, made once for a search and used on every note. */
export class WordSet {
  readonly words: string[]
  readonly patterns: RegExp[]
  /** Several words typed together are first of all a phrase. */
  readonly phrase: RegExp | null
  /** Every place a word begins, to come to the lines that have the words without going through every line. */
  readonly any: RegExp | null

  constructor(words: string[]) {
    this.words = words
    this.patterns = words.map(wordRegex)
    this.phrase = words.length > 1 ? new RegExp(words.map(escape).join('\\s+'), 'iu') : null
    this.any = words.length ? new RegExp(words.map(wordPattern).join('|'), 'giu') : null
  }

  /** Looks at the text of one note. `lines`: also pick the lines to show (more work, and wanted only for the notes shown). */
  scan(text: string, lines = true): TextHit {
    let mask = 0
    this.patterns.forEach((pattern, i) => pattern.test(text) && (mask |= 1 << i))
    const hit: TextHit = { mask, phrase: !!this.phrase && this.phrase.test(text), total: 0, matches: [] }
    if (!this.any || !mask) return hit
    const found: { line: number; at: number; score: number; text: string }[] = []
    let number = 0
    let counted = 0
    let end = -1
    for (const match of text.matchAll(this.any)) {
      if (match.index <= end) continue
      const start = text.lastIndexOf('\n', match.index - 1) + 1
      for (let at = text.indexOf('\n', counted); at >= 0 && at < start; at = text.indexOf('\n', at + 1)) number++
      counted = start
      end = text.indexOf('\n', match.index)
      if (end < 0) end = text.length
      const line = text.slice(start, end)
      const phraseAt = this.phrase ? line.search(this.phrase) : -1
      if (phraseAt >= 0) {
        found.push({ line: number, at: phraseAt, score: this.words.length + 1, text: line })
        continue
      }
      let score = 0
      let at = Infinity
      this.patterns.forEach((pattern) => {
        const index = line.search(pattern)
        if (index < 0) return
        score++
        at = Math.min(at, index)
      })
      if (score) found.push({ line: number, at, score, text: line })
    }
    // The lines shown are the ones that answer best: with the phrase; failing that, with all the
    // words; failing that, with the most of them. A line that has one small word of four says nothing.
    const best = Math.max(0, ...found.map((one) => one.score))
    // With several words, a line must have at least half of them (and never fewer than the best line by more than one).
    const enough = Math.max(best - 1, Math.ceil(this.words.length / 2), 1)
    const kept = found.filter((one) => one.score >= Math.min(best, enough)).sort((a, b) => b.score - a.score || a.line - b.line)
    hit.total = kept.length
    if (lines) for (const one of kept.slice(0, SHOWN_LINES).sort((a, b) => a.line - b.line)) hit.matches.push({ line: one.line, text: snippet(one.text, one.at) })
    return hit
  }
}
