import { Plugin } from '../../api'
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
    // Whether a link leads anywhere changes when notes appear or disappear.
    this.register(this.app.metadata.on('resolved', () => this.app.livePreview.refresh()))
  }
}
