import { mount, unmount } from 'svelte'
import { Plugin } from '../../api'
import OutlinePanel from './OutlinePanel.svelte'

export default class Outline extends Plugin {
  onload() {
    const { app } = this
    this.addPanel({
      id: 'outline',
      title: 'Оглавление',
      side: 'right',
      icon: 'M2.5 4h11M5 8h8.5M7.5 12h6',
      mount: (target) => {
        const panel = mount(OutlinePanel, { target, props: { app } })
        return () => void unmount(panel)
      },
    })
  }
}
