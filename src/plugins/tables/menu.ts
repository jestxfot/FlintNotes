export interface MenuItem {
  label: string
  action?: () => void
  /** Draws a line above this item. */
  separator?: boolean
  checked?: boolean
}

let close: (() => void) | undefined

/** Shows a context menu at the pointer; it closes on a choice, a click elsewhere or Escape. */
export function showMenu(event: MouseEvent, items: MenuItem[]): void {
  event.preventDefault()
  close?.()
  const menu = document.createElement('div')
  menu.className = 'ft-menu'
  menu.setAttribute('role', 'menu')
  for (const item of items) {
    if (item.separator) menu.append(document.createElement('hr'))
    const button = menu.appendChild(document.createElement('button'))
    button.setAttribute('role', 'menuitem')
    button.textContent = (item.checked ? '✓ ' : '') + item.label
    button.onclick = () => {
      close?.()
      item.action?.()
    }
  }
  document.body.append(menu)
  // Kept on screen even when opened near the right or bottom edge.
  const { width, height } = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(4, Math.min(event.clientX, innerWidth - width - 4))}px`
  menu.style.top = `${Math.max(4, Math.min(event.clientY, innerHeight - height - 4))}px`

  const onDown = (e: Event) => !menu.contains(e.target as Node) && close?.()
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close?.()
  close = () => {
    menu.remove()
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('keydown', onKey, true)
    close = undefined
  }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('keydown', onKey, true)
}
