import { Plugin } from '../../api'
import { GraphView } from './graph-view'
import { loadSettings, saveSettings } from './settings'
import './style.css'

const VIEW = 'graph'

export default class Graph extends Plugin {
  onload() {
    const views = new Set<GraphView>()
    this.registerView(
      VIEW,
      async ({ app, containerEl }) => {
        const settings = await loadSettings(app)
        const view = new GraphView(app, containerEl, settings, () => saveSettings(app, settings))
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
      icon: 'git-fork',
      hotkey: 'Mod+G',
      callback: () => this.app.workspace.openView(VIEW, 'Граф'),
    })
  }
}
