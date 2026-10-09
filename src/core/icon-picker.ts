import './icon-picker.css'
import type { App } from './app'
import type { Look } from './icons'

const COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'gray']
/** Icons drawn at once; typing in the search field narrows them down. */
const SHOWN = 140

/**
 * A dialog for choosing an icon and a colour. Resolves with the choice, with
 * an empty look to take both away, or with `null` if the user backs out.
 */
export function pickLook(app: App, title: string, current: Look, custom: string[] = app.icons.customNames()): Promise<Look | null> {
  return new Promise((resolve) => {
    const dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.className = 'iconic-dialog'
    const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = '') => {
      const node = parent.appendChild(document.createElement(tag))
      if (className) node.className = className
      if (text) node.textContent = text
      return node
    }
    let look: Look = { ...current }
    let result: Look | null = null

    const head = el(dialog, 'div', 'iconic-head')
    const preview = el(head, 'span', 'iconic-preview')
    el(head, 'h2', '', title)

    const bar = el(dialog, 'div', 'iconic-bar')
    const search = el(bar, 'input', 'iconic-search')
    search.placeholder = 'Найти значок или вставить эмодзи…'
    // A picture of the user's own: it is kept as an icon and chosen at once.
    if (app.icons.upload) {
      const file = el(dialog, 'input')
      file.type = 'file'
      file.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
      file.hidden = true
      const upload = el(bar, 'button', 'iconic-upload')
      upload.title = 'Загрузить свой значок: PNG, JPG или SVG'
      upload.append(app.icons.draw('lucide-upload'), 'Свой…')
      upload.onclick = () => file.click()
      file.onchange = async () => {
        const picked = file.files?.[0]
        file.value = ''
        const name = picked && (await app.icons.upload?.(picked))
        if (!name) return
        if (!custom.includes(name)) custom = [name, ...custom]
        look.icon = name
        search.value = ''
        draw()
      }
    }
    const grid = el(dialog, 'div', 'iconic-grid')

    const colors = el(dialog, 'div', 'iconic-colors')
    const swatch = (color: string | undefined, label: string) => {
      const button = el(colors, 'button', 'iconic-color')
      button.title = label
      button.style.background = color ? app.icons.css(color) : ''
      if (!color) button.classList.add('none')
      button.onclick = () => {
        look.color = color
        draw()
      }
      return button
    }
    const swatches = new Map<string | undefined, HTMLElement>([[undefined, swatch(undefined, 'Без цвета')]])
    for (const color of COLORS) swatches.set(color, swatch(color, color))
    const custom_ = el(colors, 'input', 'iconic-custom')
    custom_.type = 'color'
    custom_.title = 'Свой цвет'
    custom_.oninput = () => {
      look.color = custom_.value
      draw()
    }

    const buttons = el(dialog, 'div', 'iconic-buttons')
    const reset = el(buttons, 'button', '', 'Убрать значок и цвет')
    reset.onclick = () => {
      result = {}
      dialog.close()
    }
    const ok = el(buttons, 'button', 'primary', 'Готово')
    ok.onclick = () => {
      result = look
      dialog.close()
    }

    const draw = () => {
      preview.replaceChildren(app.icons.draw(look.icon ?? 'file', look.color))
      for (const [color, button] of swatches) button.classList.toggle('selected', color === look.color)
      const query = search.value.trim().toLowerCase()
      grid.replaceChildren()
      const add = (icon: string, label: string) => {
        const button = el(grid, 'button', icon === look.icon ? 'iconic-icon selected' : 'iconic-icon')
        button.title = label
        button.append(app.icons.draw(icon, look.color))
        button.onclick = () => {
          look.icon = icon
          draw()
        }
      }
      // Text that is not a name (an emoji typed or pasted into the field) is itself the icon.
      if (query && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(query)) add(search.value.trim(), 'Эмодзи')
      let left = SHOWN
      for (const name of custom) {
        if (left <= 0) break
        if (name.includes(query) && !app.icons.ownSvg(name)) add(name, name), left--
      }
      // The app's own icons are found by what they are for, in Russian, as well as by name.
      for (const { name, label } of app.icons.ownIcons()) {
        if (left <= 0) break
        if (name.includes(query) || label.includes(query)) add(name, `${name.slice(6)} · ${label}`), left--
      }
      for (const name of app.icons.names()) {
        if (left <= 0) break
        if (name.includes(query)) add(`lucide-${name}`, name), left--
      }
      if (!grid.childElementCount) el(grid, 'div', 'iconic-empty', 'Ничего не найдено')
    }
    search.oninput = draw
    search.onkeydown = (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      const first = grid.querySelector<HTMLButtonElement>('.iconic-icon')
      if (first && !look.icon) first.click()
      ok.click()
    }
    dialog.onclose = () => {
      dialog.remove()
      resolve(result)
    }
    dialog.onclick = (event) => event.target === dialog && dialog.close()
    dialog.showModal()
    draw()
    void app.icons.load().then(draw)
  })
}
