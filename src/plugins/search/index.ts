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
      icon: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM11 11l3 3',
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
