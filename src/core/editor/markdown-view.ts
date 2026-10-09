import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, keymap } from '@codemirror/view'
import type { App } from '../app'
import { errorMessage } from '../notice'
import { inlineTitle } from './inline-title'
import { filePath } from './state'
import { editorLook } from './theme'
import type { FileView, ViewContext } from '../workspace'

const SAVE_DELAY = 400

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
    // The index already holds the text of every note, so a note opens without
    // waiting for the server; the file is then compared with the disk.
    const indexed = this.app.metadata.text(this.path)
    this.saved = indexed ?? (await this.app.vault.read(this.path))
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
          this.app.markdown.extension,
          autocompletion({ icons: false }),
          search(),
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          editorLook,
          this.pathConfig.of(filePath.of(this.path)),
          inlineTitle(this.app),
          this.app.livePreview.extension,
          this.app.editor.extension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.scheduleSave()
          }),
        ],
      }),
    })
    this.app.editor.attach(this.editor)
    this.skipFrontmatter()
    if (indexed !== undefined) void this.onExternalChange()
    return this
  }

  /** Puts the cursor on the first line after the properties block, where the note's text begins. */
  private skipFrontmatter(): void {
    const { doc } = this.editor.state
    if (doc.line(1).text.trimEnd() !== '---') return
    for (let n = 2; n < doc.lines; n++) {
      if (/^(---|\.\.\.)\s*$/.test(doc.line(n).text)) {
        this.editor.dispatch({ selection: { anchor: doc.line(n + 1).from } })
        return
      }
    }
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

  revealLine(line: number): void {
    const { doc } = this.editor.state
    const pos = doc.line(Math.min(Math.max(line + 1, 1), doc.lines)).from
    this.editor.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    this.editor.focus()
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
