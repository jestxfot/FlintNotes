/** Small dialogs that templates open to ask the user something. */

function dialog(title: string): { el: HTMLDialogElement; body: HTMLElement; buttons: HTMLElement } {
  const el = document.createElement('dialog')
  el.className = 'tpl-dialog'
  const heading = el.appendChild(document.createElement('h2'))
  heading.textContent = title
  heading.hidden = !title
  const body = el.appendChild(document.createElement('div'))
  body.className = 'tpl-body'
  const buttons = el.appendChild(document.createElement('div'))
  buttons.className = 'tpl-buttons'
  document.body.append(el)
  return { el, body, buttons }
}

const button = (label: string, primary = false) => {
  const el = document.createElement('button')
  el.textContent = label
  if (primary) el.className = 'primary'
  return el
}

/** Asks for a line (or several lines) of text. Resolves with `null` if the user backs out. */
export function prompt(title = '', value = '', multiline = false, selectValue = false): Promise<string | null> {
  return new Promise((resolve) => {
    const { el, body, buttons } = dialog(title)
    const input = body.appendChild(document.createElement(multiline ? 'textarea' : 'input'))
    input.value = value ?? ''
    if (input instanceof HTMLTextAreaElement) input.rows = 6
    let result: string | null = null
    const ok = buttons.appendChild(button('Готово', true))
    ok.onclick = () => {
      result = input.value
      el.close()
    }
    input.onkeydown = (event) => {
      // Enter submits; in a multi-line field that takes Ctrl+Enter.
      if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        ok.click()
      }
    }
    el.onclose = () => {
      el.remove()
      resolve(result)
    }
    el.showModal()
    input.focus()
    if (selectValue) input.select()
  })
}

/** Lets the user tick any number of items. Resolves with `null` if the user backs out. */
export function multiSuggest<T>(labels: string[], items: T[], title = '', preselected: T[] = []): Promise<T[] | null> {
  return new Promise((resolve) => {
    const { el, body, buttons } = dialog(title)
    const filter = body.appendChild(document.createElement('input'))
    filter.placeholder = 'Фильтр…'
    const list = body.appendChild(document.createElement('div'))
    list.className = 'tpl-list'
    const boxes = items.map((item, i) => {
      const row = list.appendChild(document.createElement('label'))
      const box = row.appendChild(document.createElement('input'))
      box.type = 'checkbox'
      box.checked = preselected.includes(item)
      row.append(labels[i])
      return { row, box, item, label: labels[i].toLowerCase() }
    })
    filter.oninput = () => {
      const query = filter.value.trim().toLowerCase()
      for (const { row, label } of boxes) row.hidden = !!query && !label.includes(query)
    }
    let result: T[] | null = null
    buttons.appendChild(button('Готово', true)).onclick = () => {
      result = boxes.filter(({ box }) => box.checked).map(({ item }) => item)
      el.close()
    }
    el.onclose = () => {
      el.remove()
      resolve(result)
    }
    el.showModal()
    filter.focus()
  })
}
