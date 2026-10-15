import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

// Colors come from CSS variables, so the editor follows the app theme by itself.
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size)', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-text)', lineHeight: '1.5' },
  '.cm-content': {
    padding: '32px 32px 40vh',
    maxWidth: 'var(--line-width)',
    margin: '0 auto',
    caretColor: 'var(--accent)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  // The selection is drawn over the text by selection.ts; the layer CodeMirror keeps behind the text stays empty.
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'transparent',
  },
  '.flint-selection-layer': { pointerEvents: 'none' },
  '.flint-selection': { backgroundColor: 'var(--selection-over)', borderRadius: '2px' },
  '&:not(.cm-focused) .flint-selection': { opacity: '0.55' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-faint)' },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    borderRadius: '8px',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    boxShadow: 'var(--shadow)',
    overflow: 'hidden',
  },
  // The list of suggestions, as in Obsidian: a name with what was typed in bold, and under it where the thing is.
  '.cm-tooltip.cm-tooltip-autocomplete': { padding: '6px', backgroundColor: 'var(--bg-alt)', borderRadius: '10px', overflow: 'hidden' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui)', fontSize: '14px', maxHeight: '19em', minWidth: 'min(460px, 80vw)', maxWidth: 'min(560px, 90vw)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    columnGap: '0',
    alignItems: 'center',
    padding: '6px 12px',
    borderRadius: '6px',
    lineHeight: '1.35',
    whiteSpace: 'normal',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },
  '.cm-completionLabel': { gridColumn: '2', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-completionDetail': { gridColumn: '2', marginLeft: '0', color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'normal', overflowWrap: 'anywhere' },
  // The icon of the note a suggestion stands for, before its name.
  '.cm-completionNoteIcon': { gridColumn: '1', gridRow: '1 / span 2', display: 'flex', marginRight: '10px', fontSize: '17px', color: 'var(--text-muted)' },
  '.cm-completionAlias': { gridColumn: '3', gridRow: '1 / span 2', color: 'var(--text-faint)', fontSize: '15px' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700', color: 'inherit' },
  '.cm-link-completion::after': {
    content: '"Введите #, чтобы сослаться на заголовок  ·  Введите |, чтобы изменить отображаемый текст"',
    display: 'block',
    padding: '8px 10px 4px',
    borderTop: '1px solid var(--border)',
    marginTop: '4px',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-ui)',
    fontSize: '12px',
    textAlign: 'center',
  },
  '.cm-panels': { backgroundColor: 'var(--bg-alt)', color: 'var(--text)', borderColor: 'var(--border)' },
})

const highlight = HighlightStyle.define([
  // Obsidian's scale: each heading level is one step of a 1.1 ratio smaller.
  { tag: t.heading1, fontSize: '1.618em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.462em', fontWeight: '600' },
  { tag: t.heading3, fontSize: '1.318em', fontWeight: '600' },
  { tag: t.heading4, fontSize: '1.188em', fontWeight: '600' },
  { tag: t.heading5, fontSize: '1.076em', fontWeight: '600' },
  { tag: t.heading6, fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  { tag: t.quote, color: 'var(--text-muted)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--text-faint)' },
  // Code inside fenced blocks.
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
])

/** Fonts, colors and Markdown highlighting shared by the editor and read-only previews. */
export const editorLook = [theme, syntaxHighlighting(highlight)]
