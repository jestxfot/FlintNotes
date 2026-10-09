import { mount, unmount } from 'svelte'
import { Plugin } from '../../api'
import BacklinksPanel from './BacklinksPanel.svelte'

export default class Backlinks extends Plugin {
  onload() {
    const { app } = this
    this.addPanel({
      id: 'backlinks',
      title: 'Обратные ссылки',
      side: 'right',
      icon: 'M6.5 9.5l3-3M5 7L3.5 8.5a2.1 2.1 0 0 0 3 3L8 10M8 6l1.5-1.5a2.1 2.1 0 0 1 3 3L11 9',
      mount: (target) => {
        const panel = mount(BacklinksPanel, { target, props: { app } })
        return () => void unmount(panel)
      },
    })
  }
}
