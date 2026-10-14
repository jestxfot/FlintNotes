import { Plugin } from '../../api'
import { GraphView } from './graph-view'
import { loadSettings, saveSettings } from './settings'
import './style.css'

const LAYOUT = '.flint/graph-layout.json'
/** The physics the remembered places were worked out with: places from another one are not kept. */
const PHYSICS = 2
const VIEW = 'graph'

export default class Graph extends Plugin {
  onload() {
    const views = new Set<GraphView>()
    this.registerView(
      VIEW,
      async ({ app, containerEl }) => {
        const settings = await loadSettings(app)
        // Where the dots came to rest last time: the graph opens laid out instead of exploding from the centre.
        let places: Record<string, [number, number]> = {}
        try {
          const saved = JSON.parse((await app.vault.readOptional(LAYOUT)) ?? '{}')
          if (saved?.physics === PHYSICS && saved.places && typeof saved.places === 'object') places = saved.places
        } catch {
          // A broken file only costs one layout from scratch.
        }
        const remember = (settled: Record<string, [number, number]>) => void app.vault.write(LAYOUT, JSON.stringify({ physics: PHYSICS, places: settled })).catch(() => {})
        const view = new GraphView(app, containerEl, settings, () => saveSettings(app, settings), places, remember)
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
