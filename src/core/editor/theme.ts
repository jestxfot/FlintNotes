import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

// Colors come from CSS variables, so the editor follows the app theme by itself.
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size)', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-text)', lineHeight: '1.65' },
  '.cm-content': {
    padding: '28px 32px 40vh',
    maxWidth: 'var(--line-width)',
    margin: '0 auto',
    caretColor: 'var(--accent)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-faint)' },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    borderRadius: '8px',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    boxShadow: 'var(--shadow)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui)', fontSize: '14px', maxHeight: '18em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },
  '.cm-completionDetail': { marginLeft: '12px', color: 'var(--text-faint)', fontStyle: 'normal' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent)' },
  '.cm-panels': { backgroundColor: 'var(--bg-alt)', color: 'var(--text)', borderColor: 'var(--border)' },
})

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.45em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.25em', fontWeight: '650' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  { tag: t.quote, color: 'var(--text-muted)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--text-faint)' },
])

/** Fonts, colors and Markdown highlighting shared by the editor and read-only previews. */
export const editorLook = [theme, syntaxHighlighting(highlight)]
