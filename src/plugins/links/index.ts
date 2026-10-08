import { Plugin } from '../../api'
import { wikilinkCompletion } from './complete'
import { noteEmbed } from './embed-note'
import { updateLinksOnRename } from './rename'
import { wikilinkRenderer } from './render'
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
    this.registerMarkdownSyntax(wikilinkSyntax)
    this.registerPreviewRenderer(wikilinkRenderer(this.app))
    this.registerCompletionSource(wikilinkCompletion(this.app))
    this.registerEmbed(['md'], noteEmbed)
    updateLinksOnRename(this)
    // Whether a link leads anywhere changes when notes appear or disappear.
    this.register(this.app.metadata.on('resolved', () => this.app.livePreview.refresh()))
  }
}
