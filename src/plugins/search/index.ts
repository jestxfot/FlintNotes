import { mount, unmount } from 'svelte'
import { Plugin } from '../../api'
import SearchPanel from './SearchPanel.svelte'

const PANEL = 'search'

export default class Search extends Plugin {
  onload() {
    const { app } = this
    this.addPanel({
      id: PANEL,
      title: 'Поиск',
      side: 'left',
      mount: (target) => {
        const panel = mount(SearchPanel, { target, props: { app, panelId: PANEL } })
        return () => void unmount(panel)
      },
    })
    this.addCommand({
      id: 'open',
      name: 'Поиск по всем заметкам',
      hotkey: 'Mod+Shift+F',
      callback: () => app.panels.reveal(PANEL),
    })
  }
}
