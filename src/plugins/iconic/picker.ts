import type { App, Look } from '../../api'

const COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'gray']
/** Icons drawn at once; typing in the search field narrows them down. */
const SHOWN = 140

/**
 * A dialog for choosing an icon and a colour. Resolves with the choice, with
 * an empty look to take both away, or with `null` if the user backs out.
 */
export function pickLook(app: App, title: string, current: Look, custom: string[]): Promise<Look | null> {
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

    const search = el(dialog, 'input', 'iconic-search')
    search.placeholder = 'Найти значок или вставить эмодзи…'
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
      if (query && /[^\x00-\x7f]/.test(query)) add(search.value.trim(), 'Эмодзи')
      let left = SHOWN
      for (const name of custom) {
        if (left <= 0) break
        if (name.includes(query)) add(name, name), left--
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
