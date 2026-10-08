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
      mount: (target) => {
        const panel = mount(BacklinksPanel, { target, props: { app } })
        return () => void unmount(panel)
      },
    })
  }
}
