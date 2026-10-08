import { path, type App } from '../../api'

export interface SearchResult {
  path: string
  /** First matching lines; `total` counts all of them. */
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

export function search(app: App, query: string): SearchResult[] {
  const terms = parseQuery(query)
  if (!terms.length) return []
  const words = terms.filter((term) => term.kind === 'text').map((term) => term.value)
  const results: (SearchResult & { inName: boolean })[] = []

  for (const file of app.metadata.notes()) {
    const text = app.metadata.text(file) ?? ''
    const lower = text.toLowerCase()
    const name = file.toLowerCase()
    const tags = (app.metadata.get(file)?.tags ?? []).map((tag) => tag.toLowerCase())
    const matchesAll = terms.every((term) => {
      if (term.kind === 'path') return name.includes(term.value)
      if (term.kind === 'tag') return tags.some((tag) => tag === term.value || tag.startsWith(`${term.value}/`))
      return lower.includes(term.value) || name.includes(term.value)
    })
    if (!matchesAll) continue

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
    const inName = words.some((word) => path.basename(name).includes(word))
    results.push({ path: file, matches, total, inName })
  }
  // Notes whose name matches come first.
  return results.sort((a, b) => Number(b.inName) - Number(a.inName) || a.path.localeCompare(b.path)).slice(0, MAX_FILES)
}
