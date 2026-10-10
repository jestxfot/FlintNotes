import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, keymap } from '@codemirror/view'
import type { App } from '../app'
import { errorMessage } from '../notice'
import { findInNote } from './find-bar'
import { inlineTitle } from './inline-title'
import { filePath, staticPreview } from './state'
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
  private readingConfig = new Compartment()
  /** Reading: the note is shown as it reads, every element drawn, and cannot be typed in. */
  reading = false

  constructor(
    private app: App,
    private path: string,
    private containerEl: HTMLElement,
  ) {}

  async load(): Promise<this> {
    // The index already holds the text of every note, so a note opens without
    // waiting for the server; the file is then compared with the disk.
    const indexed = this.app.metadata.text(this.path)
    this.reading = this.app.settings.get<boolean>('core', 'defaultReading') === true
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
          autocompletion({
            icons: false,
            // An alias is marked with an arrow: choosing it links to the note the alias belongs to.
            addToOptions: [
              {
                // A suggestion that stands for a file shows that file's icon, if it has one.
                position: 10,
                render: (completion) => {
                  const file = (completion as { path?: string }).path
                  const look = file ? this.app.icons.look('file', file) : undefined
                  if (!look?.icon) return null
                  const icon = this.app.icons.draw(look.icon, look.color)
                  icon.classList.add('cm-completionNoteIcon')
                  return icon
                },
              },
              {
                position: 90,
                render: (completion) => {
                  if (completion.type !== 'alias') return null
                  const arrow = document.createElement('span')
                  arrow.className = 'cm-completionAlias'
                  arrow.textContent = '↪'
                  arrow.title = 'Псевдоним'
                  return arrow
                },
              },
            ],
            // While a link is being typed, the list says what else can be typed.
            tooltipClass: (state) => {
              const head = state.selection.main.head
              return /\[\[[^\]\n]*$/.test(state.sliceDoc(state.doc.lineAt(head).from, head)) ? 'cm-link-completion' : ''
            },
          }),
          // Before the other keys: Ctrl+H and Ctrl+F are this app's here, not anything else's.
          findInNote(this.app),
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          editorLook,
          this.pathConfig.of(filePath.of(this.path)),
          this.readingConfig.of(this.readingExtensions()),
          inlineTitle(this.app),
          this.app.livePreview.extension,
          this.app.editor.extension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.scheduleSave()
          }),
          // Plugins may add items for the editor; with none, the browser's own menu (spelling, copy, paste) stays.
          EditorView.domEventHandlers({ contextmenu: (event, view) => this.app.menus.show(event, 'editor', view) }),
        ],
      }),
    })
    this.app.editor.attach(this.editor)
    this.skipFrontmatter()
    if (indexed !== undefined) void this.onExternalChange()
    return this
  }

  private readingExtensions() {
    // No cursor reveals the source in a reading view, so everything stays drawn; ticking a task or a click on a link still works.
    return this.reading ? [EditorState.readOnly.of(true), EditorView.editable.of(false), staticPreview.of(true), EditorView.editorAttributes.of({ class: 'reading' })] : []
  }

  setReading(on: boolean): void {
    if (on === this.reading) return
    this.reading = on
    this.editor.dispatch({ effects: this.readingConfig.reconfigure(this.readingExtensions()) })
    this.app.livePreview.refresh()
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
    this.eol = text.includes('\r\n') ? '\r\n' : '\n'
    // Only what really differs is replaced: the lines before and after it stay as they are on the page
    // (their drawn blocks, the cursor, the scroll), and the changed ones are lit for a moment.
    const before = this.editor.state.doc.toString()
    const after = text.replace(/\r\n/g, '\n')
    let start = 0
    const shortest = Math.min(before.length, after.length)
    while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) start++
    let end = 0
    while (end < shortest - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++
    // Whole lines: a change inside a line replaces that line, so what is lit is what was touched.
    start = start === 0 ? 0 : before.lastIndexOf('\n', start - 1) + 1
    const tail = end === 0 ? -1 : before.indexOf('\n', before.length - end)
    end = tail < 0 ? 0 : before.length - tail
    const insert = after.slice(start, after.length - end)
    // The text must come out exactly as it is in the file. If the parts do not add up to it
    // (which would be a mistake here, not in the file), the whole text is taken instead.
    const exact = before.slice(0, start) + insert + before.slice(before.length - end) === after
    this.editor.dispatch({ changes: exact ? { from: start, to: before.length - end, insert } : { from: 0, to: before.length, insert: after } })
    this.saved = this.text()
    this.flash(start, start + insert.length)
  }

  /** Lights the lines of a part of the text for a moment. */
  private flash(from: number, to: number): void {
    requestAnimationFrame(() => {
      if (this.destroyed) return
      const { doc } = this.editor.state
      const { from: top, to: bottom } = this.editor.viewport
      let pos = Math.max(from, top)
      const last = Math.min(to, bottom, doc.length)
      for (let count = 0; pos <= last && count < 300; count++) {
        const line = doc.lineAt(pos)
        const node = this.editor.domAtPos(line.from).node
        const el = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.cm-line')
        if (el) {
          el.classList.remove('line-flash')
          void el.offsetWidth
          el.classList.add('line-flash')
        }
        pos = line.to + 1
      }
    })
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
    // The line is lit for a moment, so the eye finds it at once.
    const flash = (tries: number) =>
      requestAnimationFrame(() => {
        if (this.destroyed) return
        const node = this.editor.domAtPos(pos).node
        const line = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.cm-line')
        if (!line) return void (tries > 0 && flash(tries - 1))
        line.classList.remove('line-flash')
        void line.offsetWidth
        line.classList.add('line-flash')
      })
    flash(8)
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
