import { Plugin } from '../../api'
import { GraphView } from './graph-view'
import './style.css'

const VIEW = 'graph'

export default class Graph extends Plugin {
  onload() {
    const views = new Set<GraphView>()
    this.addSettings([
      {
        key: 'unresolved',
        name: 'Несуществующие заметки',
        desc: 'Показывать заметки, на которые есть ссылки, но самих их ещё нет',
        type: 'toggle',
        default: true,
      },
      { key: 'orphans', name: 'Заметки без связей', type: 'toggle', default: true },
      {
        key: 'attachments',
        name: 'Вложения',
        desc: 'Показывать картинки, PDF и другие файлы, на которые ссылаются заметки',
        type: 'toggle',
        default: false,
      },
    ])
    this.onSettingChange(() => views.forEach((view) => view.rebuild()))

    this.registerView(
      VIEW,
      ({ app, containerEl }) => {
        const view = new GraphView(app, containerEl, () => ({
          unresolved: this.getSetting<boolean>('unresolved'),
          orphans: this.getSetting<boolean>('orphans'),
          attachments: this.getSetting<boolean>('attachments'),
        }))
        views.add(view)
        const destroy = view.destroy.bind(view)
        view.destroy = () => {
          views.delete(view)
          destroy()
        }
        return view
      },
      [],
    )
    this.addCommand({
      id: 'open',
      name: 'Открыть граф связей',
      hotkey: 'Mod+G',
      callback: () => this.app.workspace.openView(VIEW, 'Граф'),
    })
  }
}
