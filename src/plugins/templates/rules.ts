import { path as paths } from '../../api'

export interface Rule {
  /** A folder (`/` for every note), or `re:` followed by a regular expression for the note's path. */
  pattern: string
  template: string
}

/**
 * Reads the rules setting: one rule per line, `pattern = template`. Lines
 * starting with `#` are comments.
 */
export function parseRules(text: string): Rule[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const at = line.lastIndexOf('=')
      return at < 0 ? null : { pattern: line.slice(0, at).trim(), template: line.slice(at + 1).trim() }
    })
    .filter((rule): rule is Rule => !!rule && !!rule.pattern && !!rule.template)
}

function matches(pattern: string, notePath: string): boolean {
  if (pattern.startsWith('re:')) {
    try {
      return new RegExp(pattern.slice(3).trim()).test(notePath)
    } catch {
      return false
    }
  }
  const folder = paths.normalize(pattern)
  // `/` or `*` stands for the whole vault: the one template for everything else.
  if (!folder || folder === '*') return true
  const dir = paths.dirname(notePath)
  return dir === folder || dir.startsWith(`${folder}/`)
}

/** The template for a new note: rules are tried from the top, the first that fits wins. */
export const templateFor = (rules: Rule[], notePath: string): string | undefined =>
  rules.find((rule) => matches(rule.pattern, notePath))?.template

export const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
