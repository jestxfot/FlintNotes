import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { staticPreview } from './state'

const COMMENT = /%%[\s\S]*?%%/g
const CODE = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText'])
const dim = Decoration.mark({ class: 'lp-comment' })
const gone = Decoration.replace({})

/**
 * Comments, written as in Obsidian between `%%` and `%%` (on one line or over
 * several). While a note is edited they are shown dimmed; where it is only
 * read (reading mode, embedded notes) they are not shown at all.
 */
function build(state: EditorState): DecorationSet {
  const text = state.doc.toString()
  if (!text.includes('%%')) return Decoration.none
  const reading = state.facet(staticPreview)
  const tree = syntaxTree(state)
  const ranges: Range<Decoration>[] = []
  for (const match of text.matchAll(COMMENT)) {
    const from = match.index
    let to = from + match[0].length
    // `%%` inside code is code, not the beginning of a comment.
    let node: { name: string; parent: unknown } | null = tree.resolveInner(from, 1)
    let inCode = false
    for (; node; node = node.parent as typeof node) if (CODE.has(node.name)) inCode = true
    if (inCode) continue
    if (reading) {
      // A comment that is all there is on its lines takes the line break after it along, leaving no empty line.
      const first = state.doc.lineAt(from)
      const last = state.doc.lineAt(to)
      if (first.from === from && last.to === to && to < state.doc.length) to++
      ranges.push(gone.range(from, to))
    } else ranges.push(dim.range(from, to))
  }
  return Decoration.set(ranges)
}

export const comments: Extension = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => (tr.docChanged || tr.startState.facet(staticPreview) !== tr.state.facet(staticPreview) || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? build(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field),
})
