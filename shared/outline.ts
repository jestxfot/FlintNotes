// A note's text without its prose: what the readers of a whole vault (tasks, queries) look at, and nothing else.
//
// The tasks list and the queries read every note, but only its list items, its `key:: value` fields, its reminders `(@date)`
// its headings (a plan is under one) and the lines that open and close a code block (what is inside a block is skipped by them). The rest — most of the text —
// is replaced by a dot, which still tells them "a paragraph is here" (it ends a list), and an empty line stays empty. The line
// numbers are the note's own, so what they find is where it is in the note. The server makes this once per note; the page
// holds it instead of the text (a fifth of it on a vault of prose).

/** The lines the readers look at: a list item (also in a quote), a field, a reminder, a heading, the edge of a block, of the properties. */
const KEEP = /^[\s>]*(?:[-*+]|\d+[.)])\s|::|\(@|^ {0,3}#{1,6}\s|^ {0,3}(?:`{3,}|~{3,})|^(?:---|\.\.\.)[ \t\r]*$/

export function outline(text: string): string {
  return text
    .split('\n')
    .map((line) => (KEEP.test(line) ? line : line.trim() ? '.' : ''))
    .join('\n')
}

/** How many words a note has: its properties and markup are not counted, only what is left of the text (a calendar's dots are made of it). */
export function wordCount(text: string): number {
  return text.replace(/^---[\s\S]*?\n---/, '').match(/[\p{L}\p{N}]+/gu)?.length ?? 0
}
