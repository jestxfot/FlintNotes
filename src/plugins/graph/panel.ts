import { DEFAULTS, hexColor, type GraphSettings } from './settings'

type Key = keyof GraphSettings

/**
 * The graph's settings panel, laid out like Obsidian's: filters, groups,
 * display, forces. `changed` is called with the name of every setting that
 * was changed, so the graph can redo only what depends on it.
 */
export function buildPanel(host: HTMLElement, settings: GraphSettings, changed: (key: Key) => void, animate: () => void, stats: () => string): () => void {
  const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = '') => {
    const node = parent.appendChild(document.createElement(tag))
    if (className) node.className = className
    if (text) node.textContent = text
    return node
  }
  const set = <K extends Key>(key: K, value: GraphSettings[K]) => {
    settings[key] = value
    changed(key)
  }

  const open = el(host, 'button', 'graph-open')
  open.title = 'Настройки графа'
  open.setAttribute('aria-label', 'Настройки графа')
  open.textContent = '⚙'
  const panel = el(host, 'div', 'graph-panel')

  const draw = () => {
    panel.replaceChildren()
    panel.hidden = settings.close
    open.hidden = !settings.close

    const section = (title: string, collapse: Key, tools?: (head: HTMLElement) => void) => {
      const box = el(panel, 'section', 'graph-section')
      const head = el(box, 'div', 'graph-section-head')
      const toggle = el(head, 'button', 'graph-section-title', title)
      toggle.classList.toggle('folded', !!settings[collapse])
      toggle.onclick = () => {
        set(collapse, !settings[collapse] as never)
        draw()
      }
      tools?.(head)
      const body = el(box, 'div', 'graph-section-body')
      body.hidden = !!settings[collapse]
      return body
    }
    const toggle = (parent: HTMLElement, label: string, key: Key, invert = false) => {
      const row = el(parent, 'label', 'graph-row')
      el(row, 'span', '', label)
      const box = el(row, 'input', 'switch')
      box.type = 'checkbox'
      box.checked = !!settings[key] !== invert
      box.onchange = () => set(key, (box.checked !== invert) as never)
    }
    const slider = (parent: HTMLElement, label: string, key: Key, min: number, max: number, step: number) => {
      const row = el(parent, 'label', 'graph-slider')
      el(row, 'span', '', label)
      const line = el(row, 'div', 'graph-slider-line')
      const value = el(line, 'span', 'graph-slider-value')
      const range = el(line, 'input')
      range.type = 'range'
      Object.assign(range, { min: String(min), max: String(max), step: String(step), value: String(settings[key]) })
      const show = () => (value.textContent = step >= 1 ? String(Math.round(Number(range.value))) : Number(range.value).toFixed(2))
      show()
      range.oninput = () => {
        show()
        set(key, Number(range.value) as never)
      }
    }

    // ---- filters
    const filters = section('Фильтры', 'collapse-filter', (head) => {
      const reset = el(head, 'button', 'graph-tool', '↺')
      reset.title = 'Сбросить настройки'
      reset.onclick = () => {
        Object.assign(settings, DEFAULTS, { close: false })
        changed('search')
        changed('centerStrength')
        draw()
      }
      const close = el(head, 'button', 'graph-tool', '×')
      close.title = 'Закрыть'
      close.onclick = () => {
        set('close', true)
        draw()
      }
    })
    const search = el(filters, 'input', 'graph-search')
    search.placeholder = 'Искать в…  (path: file: tag:)'
    search.value = settings.search
    search.oninput = () => set('search', search.value)
    toggle(filters, 'Теги', 'showTags')
    toggle(filters, 'Вложения', 'showAttachments')
    toggle(filters, 'Только созданные заметки', 'hideUnresolved')
    toggle(filters, 'Объекты без связей', 'showOrphans')

    // ---- groups
    const groups = section('Группировка', 'collapse-color-groups')
    settings.colorGroups.forEach((group, i) => {
      const row = el(groups, 'div', 'graph-group')
      const query = el(row, 'input')
      query.placeholder = 'Запрос…'
      query.value = group.query
      query.oninput = () => {
        group.query = query.value
        changed('colorGroups')
      }
      const color = el(row, 'input')
      color.type = 'color'
      color.value = hexColor(group.color)
      color.oninput = () => {
        group.color = { a: 1, rgb: parseInt(color.value.slice(1), 16) }
        changed('colorGroups')
      }
      const remove = el(row, 'button', 'graph-tool', '×')
      remove.title = 'Убрать группу'
      remove.onclick = () => {
        settings.colorGroups.splice(i, 1)
        changed('colorGroups')
        draw()
      }
    })
    const add = el(groups, 'button', 'graph-button', 'Новая группа')
    add.onclick = () => {
      settings.colorGroups.push({ query: '', color: { a: 1, rgb: [0x7852ee, 0xe93147, 0x08b94e, 0xec7500, 0x086ddd, 0x00bfbc][settings.colorGroups.length % 6] } })
      changed('colorGroups')
      draw()
      panel.querySelector<HTMLInputElement>('.graph-group:last-of-type input')?.focus()
    }
    toggle(groups, 'Цвета по папкам', 'colorFolders')

    // ---- display
    const display = section('Отображение', 'collapse-display')
    toggle(display, 'Направление связей', 'showArrow')
    const names = el(display, 'label', 'graph-row')
    el(names, 'span', '', 'Подписи')
    const mode = el(names, 'select', 'graph-select')
    for (const [value, label] of [['smart', 'умные, без наложений'], ['all', 'все'], ['hover', 'только под указателем']]) {
      const option = el(mode, 'option', '', label)
      option.value = value
      option.selected = settings.labelMode === value
    }
    mode.onchange = () => set('labelMode', mode.value as GraphSettings['labelMode'])
    slider(display, 'Порог исчезания текста', 'textFadeMultiplier', -3, 3, 0.1)
    slider(display, 'Размер текста', 'labelSize', 0.6, 2.5, 0.05)
    slider(display, 'Подписей не больше', 'labelLimit', 10, 600, 10)
    slider(display, 'Размер узла', 'nodeSizeMultiplier', 0.1, 5, 0.01)
    slider(display, 'Толщина линий', 'lineSizeMultiplier', 0.1, 5, 0.01)
    el(display, 'button', 'graph-button', 'Запустить анимацию').onclick = animate

    // ---- forces
    const forces = section('Силы', 'collapse-forces')
    slider(forces, 'Сила притяжения', 'centerStrength', 0, 1, 0.01)
    slider(forces, 'Сила отталкивания', 'repelStrength', 0, 20, 0.1)
    slider(forces, 'Сила связи', 'linkStrength', 0, 1, 0.01)
    slider(forces, 'Расстояние между узлами', 'linkDistance', 30, 500, 1)
    slider(forces, 'Кучкование групп', 'clusterStrength', 0, 1, 0.01)
    const where = el(forces, 'label', 'graph-row')
    el(where, 'span', '', 'Расчёт раскладки')
    const gpu = el(where, 'select', 'graph-select')
    for (const [value, label] of [['auto', 'авто'], ['on', 'видеокарта'], ['off', 'процессор']]) {
      const option = el(gpu, 'option', '', label)
      option.value = value
      option.selected = settings.gpuLayout === value
    }
    gpu.onchange = () => set('gpuLayout', gpu.value as GraphSettings['gpuLayout'])
    el(forces, 'div', 'graph-stats', stats())
  }

  open.onclick = () => {
    set('close', false)
    draw()
  }
  // Clicks and the wheel in the panel are the panel's, not the graph's.
  for (const type of ['pointerdown', 'wheel', 'dblclick'] as const) panel.addEventListener(type, (event) => event.stopPropagation())
  draw()
  // What the graph is busy with, in numbers: how big it is, who lays it out, how long a step and a frame take.
  const meter = setInterval(() => {
    const line = panel.querySelector('.graph-stats')
    if (line && !panel.hidden) line.textContent = stats()
  }, 500)
  return () => {
    clearInterval(meter)
    open.remove()
    panel.remove()
  }
}
