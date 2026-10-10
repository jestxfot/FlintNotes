import { mount, unmount } from 'svelte'
import { Plugin } from '../../api'
import SearchDialog from './SearchDialog.svelte'
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
    // The search window: over the note, with nothing of the sidebar needed.
    let shown: (() => void) | null = null
    const openDialog = () => {
      if (shown) return
      const target = document.body.appendChild(document.createElement('div'))
      const dialog = mount(SearchDialog, {
        target,
        props: {
          app,
          onclose: () => {
            shown = null
            void unmount(dialog)
            target.remove()
          },
        },
      })
      shown = () => target.querySelector('dialog')?.close()
    }
    this.register(() => shown?.())
    this.addCommand({ id: 'open', name: 'Поиск по всем заметкам', icon: 'search', scope: 'vault', hotkey: 'Mod+Shift+F', callback: openDialog })
    this.addCommand({ id: 'open-panel', name: 'Поиск по всем заметкам в боковой панели', icon: 'panel-left', callback: () => app.panels.reveal(PANEL) })
    // A button for it where the note's own tools are, so it is one click away with the sidebars hidden.
    this.addToolbarButton('page-header', { id: 'search', icon: 'search', title: 'Поиск по всем заметкам (Ctrl+Shift+F)', onClick: openDialog })
  }
}
