import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { App } from '../app'
import { errorMessage } from '../notice'
import { markdownLanguageSupport } from './markdown'
import { filePath } from './state'
import type { FileView, ViewContext } from '../workspace'

const SAVE_DELAY = 400

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

/** Editor for Markdown files with autosave and reload on external changes. */
export class MarkdownView implements FileView {
  editor!: EditorView
  /** File content as last read from or written to disk. */
  private saved = ''
  private eol = '\n'
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private destroyed = false
  private pathConfig = new Compartment()

  constructor(
    private app: App,
    private path: string,
    private containerEl: HTMLElement,
  ) {}

  async load(): Promise<this> {
    this.saved = await this.app.vault.read(this.path)
    this.eol = this.saved.includes('\r\n') ? '\r\n' : '\n'
    this.editor = new EditorView({
      parent: this.containerEl,
      state: EditorState.create({
        doc: this.saved,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          EditorView.lineWrapping,
          markdownLanguageSupport(),
          syntaxHighlighting(highlight),
          search(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          theme,
          this.pathConfig.of(filePath.of(this.path)),
          this.app.livePreview.extension,
          this.app.editor.extension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.scheduleSave()
          }),
        ],
      }),
    })
    this.app.editor.attach(this.editor)
    return this
  }

  /** Document text with the file's own line endings, so CRLF files stay CRLF. */
  private text(): string {
    return this.editor.state.doc.sliceString(0, undefined, this.eol)
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY)
  }

  async flush(unloading = false): Promise<void> {
    clearTimeout(this.saveTimer)
    const text = this.text()
    if (text === this.saved) return
    const previous = this.saved
    this.saved = text
    try {
      // `keepalive` lets the request outlive the page when the tab is closing.
      await this.app.vault.write(this.path, text, { keepalive: unloading })
    } catch (err) {
      this.saved = previous
      this.app.notice(`Не удалось сохранить «${this.path}»: ${errorMessage(err)}`)
    }
  }

  async onExternalChange(): Promise<void> {
    const text = await this.app.vault.read(this.path).catch(() => null)
    if (text === null || this.destroyed) return
    const current = this.text()
    if (text === current) {
      this.saved = text
      return
    }
    // Unsaved local edits win; the pending autosave writes them out.
    if (current !== this.saved) return
    const doc = this.editor.state.toText(text)
    const cursor = Math.min(this.editor.state.selection.main.head, doc.length)
    this.eol = text.includes('\r\n') ? '\r\n' : '\n'
    this.editor.dispatch({
      changes: { from: 0, to: this.editor.state.doc.length, insert: doc },
      selection: { anchor: cursor },
    })
    this.saved = this.text()
  }

  onRename(path: string): void {
    this.path = path
    this.editor.dispatch({ effects: this.pathConfig.reconfigure(filePath.of(path)) })
  }

  focus(): void {
    this.editor.focus()
  }

  destroy(): void {
    void this.flush()
    this.destroyed = true
    this.app.editor.detach(this.editor)
    this.editor.destroy()
  }
}

export const createMarkdownView = ({ app, path, containerEl }: ViewContext) =>
  new MarkdownView(app, path, containerEl).load()
