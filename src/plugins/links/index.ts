import { filePath, Plugin, whenQuiet } from '../../api'
import { wikilinkCompletion } from './complete'
import { noteEmbed } from './embed-note'
import { updateLinksOnRename } from './rename'
import { follow, wikilinkRenderer } from './render'
import './style.css'
import { wikilinkSyntax } from './syntax'

export default class Links extends Plugin {
  onload() {
    this.addSettings([
      {
        key: 'updateOnRename',
        name: 'Обновлять ссылки при переименовании',
        desc: 'Исправляет ссылки в других заметках, когда файл переименован или перемещён',
        type: 'toggle',
        default: true,
      },
    ])
    this.addInsertCommand('insert', 'Вставить ссылку на заметку', '[[|]]', 'link')
    this.addCommand({
      id: 'follow',
      name: 'Перейти по ссылке под курсором',
      icon: 'corner-down-right',
      callback: () => {
        const editor = this.app.workspace.activeEditor
        if (!editor) return
        const head = editor.state.selection.main.head
        const line = editor.state.doc.lineAt(head)
        const link = [...line.text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].find((m) => line.from + m.index <= head && head <= line.from + m.index + m[0].length)
        if (link) void follow(this.app, link[1], this.app.workspace.active?.path ?? '')
        else this.app.notice('Под курсором нет ссылки')
      },
    })
    this.registerMarkdownSyntax(wikilinkSyntax)
    this.registerPreviewRenderer(wikilinkRenderer(this.app))
    this.registerCompletionSource(wikilinkCompletion(this.app))
    this.registerEmbed(['md'], noteEmbed)
    updateLinksOnRename(this)
    // Whether a link leads anywhere changes when files come and go; what it shows of the note it leads to (its icon,
    // a plugin's badge) when that note changed. Nothing else a note says changes a link in another note, so typing
    // in one note does not draw the others again.
    const refresh = whenQuiet(() => this.app.livePreview.refresh())
    this.register(refresh.cancel)
    this.register(
      this.app.metadata.on('resolved', (what) => {
        if (what.names || !what.notes) return refresh()
        const shown = new Set<string>()
        this.app.editor.each((editor) => shown.add(editor.state.facet(filePath)))
        if ([...what.notes].some((note) => [...this.app.metadata.backlinks(note).keys()].some((source) => shown.has(source)))) refresh()
      }),
    )
  }
}
