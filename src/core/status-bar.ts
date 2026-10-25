export class StatusBar {
  readonly el = document.createElement('div')
  /** The first item: the buttons the user put into the status bar. */
  readonly buttons: HTMLElement

  constructor() {
    this.el.className = 'status-bar'
    this.buttons = this.addItem()
  }

  /** Adds an empty item; remove the returned element to take it away again. */
  addItem(): HTMLElement {
    const item = document.createElement('span')
    item.className = 'status-item'
    this.el.append(item)
    return item
  }
}
