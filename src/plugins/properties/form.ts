import { isMap, isScalar, parseDocument, type Document } from 'yaml'
import { renderInline, setYamlValue, type CodeBlockContext, type CodeBlockInstance } from '../../api'

type Kind = 'text' | 'number' | 'checkbox' | 'date' | 'datetime' | 'list'

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'text', label: 'Текст' },
  { kind: 'number', label: 'Число' },
  { kind: 'checkbox', label: 'Флажок' },
  { kind: 'date', label: 'Дата' },
  { kind: 'datetime', label: 'Дата и время' },
  { kind: 'list', label: 'Список' },
]

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/
const KIND_ICONS: Record<Kind, string> = { text: 'align-left', number: 'binary', checkbox: 'square-check', date: 'calendar', datetime: 'clock', list: 'list' }
const BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?(?:---|\.\.\.)[ \t]*$/

function kindOf(value: unknown): Kind {
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'string' && DATETIME.test(value)) return 'datetime'
  return typeof value === 'string' && DATE.test(value) ? 'date' : 'text'
}

/** Converts a value when the user changes a property's type; what cannot be converted starts empty. */
function convert(value: unknown, kind: Kind): unknown {
  const text = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value)
  if (kind === 'checkbox') return value === true || /^(true|yes|да|1)$/i.test(text)
  if (kind === 'number') return Number.isNaN(Number(text.replace(',', '.'))) || !text ? 0 : Number(text.replace(',', '.'))
  if (kind === 'date') return DATE.test(text) ? text : DATETIME.test(text) ? text.slice(0, 10) : new Date().toISOString().slice(0, 10)
  if (kind === 'datetime') return DATETIME.test(text) ? text : `${DATE.test(text) ? text : new Date().toISOString().slice(0, 10)}T00:00`
  if (kind === 'list') return Array.isArray(value) ? value : text ? text.split(',').map((item) => item.trim()).filter(Boolean) : []
  return text
}

/** A value that is nothing but a link: `[[Note]]`, `[text](address)` or a web address. */
const LINKISH = /^(\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)$/

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/**
 * Draws a note's frontmatter as a form. The YAML stays the data: each change
 * is applied to it (keeping comments and the order of keys) and written back.
 */
export function propertiesForm(source: string, root: HTMLElement, ctx: CodeBlockContext): CodeBlockInstance {
  root.classList.add('props')
  let written = source
  const offIcons = ctx.app.icons.on('change', () => render())
  let doc: Document

  const save = () => {
    const yaml = doc.contents && isMap(doc.contents) && doc.contents.items.length ? doc.toString({ flowCollectionPadding: false }) : ''
    written = `---\n${yaml}---`
    ctx.setSource(written)
    render()
  }

  const render = () => {
    const match = BLOCK.exec(written)
    if (!match) {
      // While the closing `---` is missing there is nothing sound to edit.
      root.replaceChildren(el('pre', 'props-raw', written), el('div', 'props-error', 'Блок свойств не закрыт строкой ---'))
      return
    }
    doc = parseDocument(match[1])
    const data = doc.toJS() ?? {}
    if (doc.errors.length || typeof data !== 'object' || Array.isArray(data)) {
      const message = doc.errors[0]?.message ?? 'Свойства должны быть парами «имя: значение»'
      root.replaceChildren(el('pre', 'props-raw', written), el('div', 'props-error', `Ошибка в свойствах: ${message}`))
      return
    }

    const rows = Object.entries(data as Record<string, unknown>).map(([key, value]) => {
      const kind = kindOf(value)
      const row = el('div', 'props-row')
      row.dataset.key = key

      // The property's icon, its own or one for its type; a right click on it opens the property's menu.
      const look = ctx.app.icons.look('property', key)
      const icon = row.appendChild(ctx.app.icons.clickable(ctx.app.icons.draw(look?.icon ?? (key === 'tags' ? 'tags' : key === 'aliases' ? 'forward' : KIND_ICONS[kind]), look?.color), 'property', key))
      icon.classList.add('props-icon')
      // The property's menu: its type, the clipboard, deleting; plugins add theirs (an icon, say).
      const setType = (next: Kind) => {
        setYamlValue(doc, key, convert(value, next))
        save()
      }
      const copy = () => navigator.clipboard.writeText(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).catch(() => {})
      const menu = (event: MouseEvent) =>
        ctx.app.menus.show(event, 'property', key, [
          { section: 'new', icon: 'info', title: 'Тип свойства', submenu: KINDS.map(({ kind: k, label }) => ({ icon: k === kind ? 'check' : KIND_ICONS[k], title: label, onClick: () => setType(k) })) },
          {
            section: 'copy',
            icon: 'scissors',
            title: 'Вырезать',
            onClick: () => {
              void copy()
              doc.delete(key)
              save()
            },
          },
          { section: 'copy', icon: 'copy', title: 'Копировать', onClick: () => void copy() },
          {
            section: 'copy',
            icon: 'clipboard-paste',
            title: 'Вставить',
            onClick: async () => {
              // A copied property is `name: value`; pasted, it becomes a property of this note.
              const pasted = /^([^:\n]+):\s*([\s\S]*)$/.exec((await navigator.clipboard.readText().catch(() => '')).trim())
              if (!pasted) return ctx.app.notice('В буфере нет свойства вида «имя: значение»')
              let parsed: unknown = pasted[2]
              try {
                parsed = JSON.parse(pasted[2])
              } catch {
                // Not JSON: the value is the text itself.
              }
              setYamlValue(doc, pasted[1].trim(), parsed)
              save()
            },
          },
          {
            section: 'danger',
            icon: 'trash',
            title: 'Удалить',
            danger: true,
            onClick: () => {
              doc.delete(key)
              save()
            },
          },
        ])
      icon.oncontextmenu = menu
      row.oncontextmenu = (event) => {
        // In a field the browser's own menu (paste, spelling) is the useful one.
        if (!(event.target instanceof HTMLInputElement) || event.target.classList.contains('props-name')) menu(event)
      }

      const name = row.appendChild(el('input', 'props-name'))
      name.value = key
      name.setAttribute('aria-label', 'Имя свойства')
      name.onchange = () => {
        const next = name.value.trim()
        if (!next || next === key || doc.has(next)) return void (name.value = key)
        // Renaming in place keeps the property where it is in the list.
        const pair = isMap(doc.contents) ? doc.contents.items.find((item) => isScalar(item.key) && item.key.value === key) : null
        if (pair && isScalar(pair.key)) pair.key.value = next
        save()
      }

      row.append(editor(key, value, kind))

      const type = row.appendChild(el('select', 'props-type'))
      type.title = 'Тип значения'
      for (const { kind: k, label } of KINDS) type.append(new Option(label, k, false, k === kind))
      type.onchange = () => {
        setYamlValue(doc, key, convert(value, type.value as Kind))
        save()
      }

      const remove = row.appendChild(el('button', 'props-remove', '×'))
      remove.title = 'Удалить свойство'
      remove.onclick = () => {
        doc.delete(key)
        save()
      }
      return row
    })

    const add = el('button', 'props-add', '+ Добавить свойство')
    add.onclick = () => {
      let name = 'свойство'
      for (let i = 2; doc.has(name); i++) name = `свойство ${i}`
      doc.set(name, '')
      save()
      const inputs = root.querySelectorAll<HTMLInputElement>('.props-name')
      inputs[inputs.length - 1]?.select()
    }
    root.replaceChildren(el('div', 'props-heading', 'Свойства'), ...rows, add)
  }

  /**
   * Offers, under a value's field, the values this very property has in other
   * notes, the most used first: a note's `breakfast` suggests what was written
   * in `breakfast` elsewhere, not every note or tag of the vault.
   */
  const suggest = (input: HTMLInputElement, key: string, pick: (value: string) => void, taken: string[] = []) => {
    let popup: HTMLElement | null = null
    const close = () => {
      popup?.remove()
      popup = null
    }
    const open = () => {
      const counts = new Map<string, number>()
      for (const note of ctx.app.metadata.notes()) {
        const value = ctx.app.metadata.get(note)?.frontmatter?.[key]
        for (const item of Array.isArray(value) ? value : [value]) {
          if (typeof item !== 'string' && typeof item !== 'number') continue
          const text = String(item).trim()
          if (text && !taken.includes(text)) counts.set(text, (counts.get(text) ?? 0) + 1)
        }
      }
      const typed = input.value.trim().toLowerCase()
      const values = [...counts].filter(([value]) => !typed || value.toLowerCase().includes(typed)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40)
      close()
      if (!values.length) return
      popup = document.body.appendChild(el('div', 'props-suggest'))
      const box = input.getBoundingClientRect()
      popup.style.left = `${box.left}px`
      popup.style.top = `${box.bottom + 4}px`
      popup.style.minWidth = `${Math.max(260, box.width)}px`
      popup.style.maxHeight = `${Math.max(120, window.innerHeight - box.bottom - 16)}px`
      for (const [value] of values) {
        const link = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(value)
        const row = popup.appendChild(el('button', 'props-suggest-row'))
        row.append(el('span', '', link ? (link[2] ?? link[1].split('/').pop()!) : key === 'tags' ? value.replace(/^#/, '') : value))
        if (link) row.append(ctx.app.icons.draw('link'))
        // The field keeps the focus: the choice is made on the press, before the field would lose it.
        row.onmousedown = (event) => {
          event.preventDefault()
          close()
          input.value = ''
          pick(value)
        }
      }
    }
    input.addEventListener('focus', open)
    input.addEventListener('input', open)
    input.addEventListener('blur', close)
    input.addEventListener('keydown', (event) => event.key === 'Escape' && close())
  }

  /** The control for one value, chosen by its type. */
  const editor = (key: string, value: unknown, kind: Kind): HTMLElement => {
    const set = (next: unknown) => {
      setYamlValue(doc, key, next)
      save()
    }
    if (kind === 'checkbox') {
      const box = el('input', 'props-value')
      box.type = 'checkbox'
      box.checked = value === true
      box.onchange = () => set(box.checked)
      return box
    }
    if (kind === 'list') return listEditor(key, value as unknown[], set)
    const input = el('input', 'props-value')
    // A value that is a link is shown as one; a click beside it (or on the pencil) brings the text back for editing.
    if (kind === 'text' && typeof value === 'string' && LINKISH.test(value.trim())) {
      const shown = el('div', 'props-value props-link')
      shown.append(renderInline(ctx.app, value.trim(), ctx.path))
      const edit = shown.appendChild(el('button', 'props-edit', '✎'))
      edit.title = 'Изменить'
      const toInput = () => {
        shown.replaceWith(input)
        input.focus()
      }
      edit.onclick = toInput
      shown.onclick = (event) => event.target === shown && toInput()
      input.type = 'text'
      input.value = value
      input.onchange = () => set(input.value)
      return shown
    }
    input.type = kind === 'date' ? 'date' : kind === 'datetime' ? 'datetime-local' : kind === 'number' ? 'number' : 'text'
    if (kind === 'number') input.step = 'any'
    input.placeholder = 'Нет значения'
    input.value = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : kind === 'datetime' ? String(value).replace(' ', 'T') : String(value)
    // Nested data cannot be edited as one line of text; it stays readable here and editable in the source.
    input.readOnly = typeof value === 'object' && value !== null
    input.onchange = () => set(kind === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value)
    if (kind === 'text') suggest(input, key, (picked) => set(picked))
    return input
  }

  /** A list as chips, with a field to add items (Enter or comma) and Backspace to remove the last. */
  const listEditor = (key: string, items: unknown[], set: (next: unknown) => void): HTMLElement => {
    const box = el('div', 'props-value props-list')
    items.forEach((item, i) => {
      // A tag may be written with or without its `#`; it is shown with exactly one.
      const link = key !== 'tags' && typeof item === 'string' && LINKISH.test(item.trim())
      // A tag is shown without its `#`, as Obsidian shows it among the properties.
      const chip = box.appendChild(el('span', 'props-chip', link ? '' : key === 'tags' ? String(item).replace(/^#/, '') : String(item)))
      if (link) chip.classList.add('props-chip-link')
      // A link kept in a list (`link: "[[Hub]]"`) opens its note.
      if (link) chip.append(renderInline(ctx.app, String(item).trim(), ctx.path))
      if (key === 'tags') {
        const tag = String(item).replace(/^#/, '')
        const look = ctx.app.icons.look('tag', tag)
        chip.classList.add('props-tag')
        chip.style.setProperty('--tag-color', ctx.app.icons.css(look?.color))
        if (look?.icon) chip.prepend(ctx.app.icons.clickable(ctx.app.icons.draw(look.icon), 'tag', tag))
        chip.oncontextmenu = (event) => ctx.app.menus.show(event, 'tag', tag)
      }
      const remove = chip.appendChild(el('button', '', '×'))
      remove.title = 'Убрать'
      remove.onclick = () => set(items.filter((_, index) => index !== i))
    })
    const input = box.appendChild(el('input'))
    input.placeholder = items.length ? '' : 'Нет значения'
    suggest(input, key, (value) => set([...items, key === 'tags' ? value.replace(/^#/, '') : value]), items.map(String))
    const add = () => {
      const fresh = input.value.split(',').map((item) => item.trim().replace(key === 'tags' ? /^#/ : /^$/, '')).filter(Boolean)
      if (fresh.length) set([...items, ...fresh])
    }
    input.onchange = add
    input.onkeydown = (event) => {
      if (event.key === ',') {
        event.preventDefault()
        add()
      } else if (event.key === 'Backspace' && !input.value && items.length) set(items.slice(0, -1))
    }
    return box
  }

  // Keys typed in the form belong to the form, not to the note's editor around it.
  root.addEventListener('keydown', (event) => event.stopPropagation())
  render()
  return {
    update(next) {
      if (next === written) return
      written = next
      render()
    },
    destroy: offIcons,
  }
}
