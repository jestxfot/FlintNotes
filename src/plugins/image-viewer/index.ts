import { Plugin } from '../../api'
import './style.css'

const EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']

export default class ImageViewer extends Plugin {
  onload() {
    this.registerView(
      'image',
      ({ app, path, containerEl }) => {
        const box = containerEl.appendChild(document.createElement('div'))
        box.className = 'image-view'
        const img = box.appendChild(document.createElement('img'))
        const show = (file: string) => {
          // The timestamp makes the browser fetch a changed file again.
          img.src = `${app.vault.url(file)}&t=${Date.now()}`
          img.alt = file
        }
        show(path)
        let current = path
        // Click switches between fitting the tab and the picture's real size.
        img.onclick = () => box.classList.toggle('actual-size')
        return {
          onExternalChange: () => show(current),
          onRename: (renamed) => show((current = renamed)),
          destroy: () => box.remove(),
        }
      },
      EXTENSIONS,
    )
  }
}
