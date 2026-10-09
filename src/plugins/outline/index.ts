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
      mount: (target) => {
        const panel = mount(OutlinePanel, { target, props: { app } })
        return () => void unmount(panel)
      },
    })
  }
}
