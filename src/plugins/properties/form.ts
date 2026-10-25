import { isMap, isScalar, parseDocument, type Document } from 'yaml'
import { renderInline, setYamlValue, type CodeBlockContext, type CodeBlockInstance } from '../../api'
import { dateHint, senseOf, SENSES, type DateSense } from './smart-dates'

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
/** The highest a list of suggestions grows (about nine rows): it must not cover the note being written. */
const SUGGEST_HEIGHT = 330
const LINKISH = /^(\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)$/

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/** What the form needs to know of the meaning of date properties, which is kept per name for the whole vault. */
export interface SmartDates {
  /** Whether dates get their hints at all. */
  enabled(): boolean
  chosen(key: string): DateSense | undefined
  choose(key: string, sense: DateSense): void
  /** Called with a function that draws the form again, when a meaning is chosen anywhere; returns how to stop. */
  watch(redraw: () => void): () => void
}

/**
 * Draws a note's frontmatter as a form. The YAML stays the data: each change
 * is applied to it (keeping comments and the order of keys) and written back.
 */
export function propertiesForm(source: string, root: HTMLElement, ctx: CodeBlockContext, smart?: SmartDates): CodeBlockInstance {
  root.classList.add('props')
  let written = source
  // Icons may change at any moment (other notes are being read, a rule now fits). The form is not
  // drawn again under the user's hands: while a field of it is being typed in, that waits.
  let stale = false
  const typing = () => root.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
  const offIcons = ctx.app.icons.on('change', () => (typing() ? (stale = true) : render()))
  root.addEventListener('focusout', () => {
    if (!stale) return
    // After the field's own change has been taken in.
    setTimeout(() => {
      if (!stale || typing()) return
      stale = false
      render()
    }, 150)
  })
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
      const dated = smart && (kind === 'date' || kind === 'datetime')
      const sense = dated ? (smart.chosen(key) ?? 'auto') : 'auto'
      const menu = (event: MouseEvent) =>
        ctx.app.menus.show(event, 'property', key, [
          { section: 'new', icon: 'info', title: 'Тип свойства', submenu: KINDS.map(({ kind: k, label }) => ({ icon: k === kind ? 'check' : KIND_ICONS[k], title: label, onClick: () => setType(k) })) },
          // What the hint beside a date says: chosen for the name, so for this property in every note.
          ...(dated
            ? [{ section: 'new', icon: 'sparkles', title: 'Подсказка у даты', submenu: SENSES.map((one) => ({ icon: one.sense === sense ? 'check' : 'dot', title: one.sense === 'auto' ? `${one.label} (${SENSES.find((s) => s.sense === senseOf(key, undefined))!.label.split(':')[0].toLowerCase()})` : one.label, onClick: () => smart.choose(key, one.sense) })) }]
            : []),
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
        // A property with no value yet takes the kind of value this name has elsewhere in the vault (a flag, a number, a list).
        const known = vaultProperties().get(next)
        if ((value === '' || value === null || value === undefined) && known && known.kind !== 'text') setYamlValue(doc, next, convert(value, known.kind))
        save()
        // The value is what is filled in next.
        root.querySelector<HTMLElement>(`.props-row[data-key="${CSS.escape(next)}"] .props-value, .props-row[data-key="${CSS.escape(next)}"] .props-list input`)?.focus()
      }
      suggestNames(name)

      // Tags written as one text (`tags: "#food, soup"`) are still tags: they are shown and edited as a list.
      if (key === 'tags' && typeof value === 'string') row.append(listEditor(key, value.split(/[\s,]+/).filter(Boolean), (next) => (setYamlValue(doc, key, next), save())))
      else row.append(editor(key, value, kind))
      if (dated && smart.enabled()) {
        const hint = dateHint(value, senseOf(key, smart.chosen(key)))
        if (hint) row.append(hintElement(hint, value as string, senseOf(key, smart.chosen(key))))
      }

      // The type and deleting are in the row's menu (a right click, or a click on the icon's menu): the row itself stays clean.
      return row
    })

    const add = el('button', 'props-add', '+ Добавить свойство')
    add.onclick = () => {
      let name = 'свойство'
      for (let i = 2; doc.has(name); i++) name = `свойство ${i}`
      doc.set(name, '')
      save()
      const inputs = root.querySelectorAll<HTMLInputElement>('.props-name')
      // Focused, so that the names to choose from are offered at once.
      inputs[inputs.length - 1]?.focus()
      inputs[inputs.length - 1]?.select()
    }
    root.replaceChildren(el('div', 'props-heading', 'Свойства'), ...rows, add)
  }

  /** Every property name in the vault: how many notes have it, and the kind of value it usually has. */
  const vaultProperties = () => {
    const found = new Map<string, { count: number; kinds: Map<Kind, number> }>()
    for (const note of ctx.app.metadata.notes()) {
      const frontmatter = ctx.app.metadata.get(note)?.frontmatter
      if (!frontmatter) continue
      for (const [name, value] of Object.entries(frontmatter)) {
        const entry = found.get(name) ?? found.set(name, { count: 0, kinds: new Map() }).get(name)!
        entry.count++
        // An empty value says nothing of the kind.
        if (value !== null && value !== '') entry.kinds.set(kindOf(value), (entry.kinds.get(kindOf(value)) ?? 0) + 1)
      }
    }
    return new Map([...found].map(([name, { count, kinds }]) => [name, { count, kind: ([...kinds].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'text') as Kind }]))
  }

  /**
   * Offers, under a property's name, the names properties have in the vault (with the icon of their
   * kind, the commonest first), so a property is named by choosing: the name, and with it the kind
   * of value it takes elsewhere. Opens when the name is clicked into, and narrows as it is typed.
   */
  const suggestNames = (input: HTMLInputElement) => {
    let popup: HTMLElement | null = null
    let shown: string[] = []
    let at = -1
    let typed = false
    const close = () => {
      popup?.remove()
      popup = null
      at = -1
    }
    const light = () => popup?.querySelectorAll('.props-suggest-row').forEach((row, i) => row.classList.toggle('is-active', i === at))
    const pick = (name: string) => {
      close()
      input.value = name
      input.dispatchEvent(new Event('change'))
    }
    const open = () => {
      // This note's own names are not offered, this property's own included: it has it already.
      const have = new Set(Object.keys((doc.toJS() as Record<string, unknown>) ?? {}))
      const wanted = typed ? input.value.trim().toLowerCase() : ''
      const names = [...vaultProperties()]
        .filter(([name]) => !have.has(name) && (!wanted || name.toLowerCase().includes(wanted)))
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .slice(0, 60)
      close()
      shown = names.map(([name]) => name)
      if (!names.length) return
      popup = document.body.appendChild(el('div', 'props-suggest'))
      const box = input.getBoundingClientRect()
      popup.style.left = `${box.left}px`
      popup.style.top = `${box.bottom + 4}px`
      popup.style.minWidth = `${Math.max(260, box.width)}px`
      popup.style.maxHeight = `${Math.max(120, Math.min(SUGGEST_HEIGHT, window.innerHeight - box.bottom - 16))}px`
      for (const [name, { kind }] of names) {
        const row = popup.appendChild(el('button', 'props-suggest-row'))
        const look = ctx.app.icons.look('property', name)
        const label = el('span', 'props-suggest-name', name)
        label.prepend(Object.assign(ctx.app.icons.draw(look?.icon ?? (name === 'tags' ? 'tags' : name === 'aliases' ? 'forward' : KIND_ICONS[kind]), look?.color), { className: 'icon props-suggest-icon' }))
        row.append(label)
        // The field keeps the focus: the choice is made on the press, before the field would lose it.
        row.onmousedown = (event) => {
          event.preventDefault()
          pick(name)
        }
      }
    }
    input.addEventListener('focus', () => ((typed = false), open()))
    input.addEventListener('click', () => !popup && ((typed = false), open()))
    input.addEventListener('input', () => ((typed = true), open()))
    input.addEventListener('blur', close)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') return close()
      if (!popup || !shown.length) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        at = (at + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length
        light()
        popup.querySelectorAll('.props-suggest-row')[at]?.scrollIntoView({ block: 'nearest' })
      } else if (event.key === 'Enter' && at >= 0) {
        event.preventDefault()
        pick(shown[at])
      }
    })
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
      const had = new Set(taken.map((item) => (key === 'tags' ? item.replace(/^#/, '').toLowerCase() : item.trim())))
      for (const note of ctx.app.metadata.notes()) {
        const value = ctx.app.metadata.get(note)?.frontmatter?.[key]
        for (const item of Array.isArray(value) ? value : [value]) {
          if (typeof item !== 'string' && typeof item !== 'number') continue
          const text = String(item).trim()
          // A tag is the same tag with or without its `#`, in any case of letters.
          const same = key === 'tags' ? text.replace(/^#/, '').toLowerCase() : text
          if (same && !had.has(same)) counts.set(key === 'tags' ? same : text, (counts.get(key === 'tags' ? same : text) ?? 0) + 1)
        }
      }
      const typed = input.value.trim().toLowerCase()
      // The notes opened lately come first: those are the ones usually written into. Then the most used.
      const recent = new Map(ctx.app.positions.recent().map((path, i) => [path, i]))
      const lately = (value: string) => {
        const link = /^\[\[([^\]|#]+)/.exec(value)
        const dest = link ? ctx.app.metadata.resolve(link[1], ctx.path) : null
        return (dest ? recent.get(dest) : undefined) ?? Infinity
      }
      const values = [...counts]
        .filter(([value]) => !typed || value.toLowerCase().includes(typed))
        .map(([value, count]) => ({ value, count, lately: lately(value) }))
        .sort((a, b) => a.lately - b.lately || b.count - a.count || a.value.localeCompare(b.value))
        // Before anything is typed, only a few: the list must not cover the note being written.
        .slice(0, typed ? 40 : 7)
        .map(({ value }) => [value])
      close()
      if (!values.length) return
      popup = document.body.appendChild(el('div', 'props-suggest'))
      const box = input.getBoundingClientRect()
      popup.style.left = `${box.left}px`
      popup.style.top = `${box.bottom + 4}px`
      popup.style.minWidth = `${Math.max(260, box.width)}px`
      popup.style.maxHeight = `${Math.max(120, Math.min(SUGGEST_HEIGHT, window.innerHeight - box.bottom - 16))}px`
      for (const [value] of values) {
        const link = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(value)
        const row = popup.appendChild(el('button', 'props-suggest-row'))
        // The icon of the tag, or of the note a link leads to.
        const dest = link ? ctx.app.metadata.resolve(link[1].split('#')[0], ctx.path) : null
        const look = key === 'tags' ? ctx.app.icons.look('tag', value.replace(/^#/, '')) : dest ? ctx.app.icons.look('file', dest) : undefined
        const name = el('span', 'props-suggest-name', link ? (link[2] ?? link[1].split('/').pop()!) : key === 'tags' ? value.replace(/^#/, '') : value)
        if (look?.icon) name.prepend(Object.assign(ctx.app.icons.draw(look.icon, look.color), { className: 'icon props-suggest-icon' }))
        row.append(name)
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
      // What is in the list already is not added a second time.
      const same = (item: unknown) => (key === 'tags' ? String(item).replace(/^#/, '').toLowerCase() : String(item))
      const fresh = [...new Set(input.value.split(',').map((item) => item.trim().replace(key === 'tags' ? /^#/ : /^$/, '')).filter(Boolean))].filter((item) => !items.some((had) => same(had) === same(item)))
      input.value = ''
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
  const offSmart = smart?.watch(() => (typing() ? (stale = true) : render()))
  return {
    update(next) {
      if (next === written) return
      written = next
      render()
    },
    destroy: () => {
      offIcons()
      offSmart?.()
    },
  }
}

/** The hint beside a date: it says the same thing tomorrow in other words, so it is worked out again as the day goes on. */
function hintElement(hint: NonNullable<ReturnType<typeof dateHint>>, value: string, sense: Exclude<DateSense, 'auto'>): HTMLElement {
  const box = el('span', 'props-hint', hint.text)
  if (hint.tone) box.dataset.tone = hint.tone
  box.title = hint.title
  box.dataset.value = value
  box.dataset.sense = sense
  watchHints()
  return box
}

let hintTimer: ReturnType<typeof setInterval> | undefined
/** Once a minute every hint on the page is said anew: past midnight "завтра" becomes "сегодня". */
function watchHints(): void {
  hintTimer ??= setInterval(() => {
    const hints = document.querySelectorAll<HTMLElement>('.props-hint')
    if (!hints.length) return void (clearInterval(hintTimer), (hintTimer = undefined))
    for (const box of hints) {
      const hint = dateHint(box.dataset.value, box.dataset.sense as Exclude<DateSense, 'auto'>)
      if (!hint) continue
      if (box.textContent !== hint.text) box.textContent = hint.text
      box.title = hint.title
      if (hint.tone) box.dataset.tone = hint.tone
      else delete box.dataset.tone
    }
  }, 60_000)
}
