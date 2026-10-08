export class StatusBar {
  readonly el = document.createElement('div')

  constructor() {
    this.el.className = 'status-bar'
  }

  /** Adds an empty item; remove the returned element to take it away again. */
  addItem(): HTMLElement {
    const item = document.createElement('span')
    item.className = 'status-item'
    this.el.append(item)
    return item
  }
}
