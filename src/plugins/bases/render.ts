import { errorMessage, plural, setProperties, type App } from '../../api'
import { createRecord } from './create'
import { h } from './dom'
import { BaseEngine, groupRule, noteKey } from './engine'
import { editBase, parseBase, VIEW_TYPES, viewLabel, viewsOf, type ViewConfig } from './model'
import { board } from './views/board'
import { cards } from './views/cards'
import { list } from './views/list'
import type { ViewContext, ViewRenderer } from './views/shared'
import { table } from './views/table'

const RENDERERS: Record<string, ViewRenderer> = { table, cards, list, board }

export interface BaseHost {
  app: App
  /** The note or `.base` file the base lives in. */
  sourcePath: string
  /** Saves the base's YAML. */
  setSource(source: string): void
  /** Name of the view to show first. */
  initialView?: string
}

export interface MountedBase {
  update(source: string): void
  destroy(): void
}

/** Draws a base (its views, toolbar and settings) into `el` and keeps it current. */
export function mountBase(el: HTMLElement, host: BaseHost, initial: string): MountedBase {
  const { app } = host
  el.classList.add('base')
  let source = initial
  let active = Math.max(0, viewsOf(parseBase(initial).config).findIndex((view) => view.name === host.initialView))
  let settingsOpen = false
  let stale = false

  const save = (next: string) => {
    source = next
    host.setSource(next)
    draw()
  }

  function draw(): void {
    const scroll = el.querySelector('.base-body')?.scrollTop ?? 0
    const { config, error } = parseBase(source)
    if (error) {
      el.replaceChildren(h('div', { class: 'base-error' }, error))
      return
    }
    const views = viewsOf(config)
    active = Math.min(active, views.length - 1)
    const view = views[active]
    const engine = new BaseEngine(app, config, host.sourcePath)
    const result = engine.query(view)
    const columns = engine.columns(view, result.rows)

    /** Sets or clears keys of the current view in the YAML. */
    const updateView = (changes: Partial<ViewConfig>) =>
      save(
        editBase(source, (doc) => {
          for (const [key, value] of Object.entries(changes)) {
            const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)
            if (empty) doc.deleteIn(['views', active, key])
            else doc.setIn(['views', active, key], value)
          }
        }),
      )

    const ctx: ViewContext = {
      app,
      engine,
      view,
      result,
      columns,
      sourcePath: host.sourcePath,
      updateView,
      setProperty: (row, key, value) =>
        void setProperties(app, row.path, { [key]: value }).catch((err) =>
          app.notice(`Не удалось сохранить «${key}»: ${errorMessage(err)}`),
        ),
    }

    const addView = h(
      'select',
      {
        class: 'base-add-view',
        title: 'Добавить представление',
        onchange: () => {
          const type = addView.value
          active = views.length
          save(editBase(source, (doc) => doc.addIn(['views'], doc.createNode({ type, name: viewLabel(type) }))))
        },
      },
      h('option', { value: '', hidden: true, selected: true }, '+'),
      ...VIEW_TYPES.map(({ type, label }) => h('option', { value: type }, label)),
    )

    const toolbar = h(
      'div',
      { class: 'base-toolbar' },
      h(
        'div',
        { class: 'base-tabs', role: 'tablist' },
        ...views.map((v, i) =>
          h(
            'button',
            {
              class: i === active ? 'active' : '',
              role: 'tab',
              onclick: () => {
                active = i
                draw()
              },
            },
            v.name ?? viewLabel(v.type),
          ),
        ),
        addView,
      ),
      h('span', { class: 'base-count' }, plural(result.rows.length, ['запись', 'записи', 'записей'])),
      h('button', { title: 'Настройки представления', class: settingsOpen ? 'active' : '', onclick: () => ((settingsOpen = !settingsOpen), draw()) }, '⚙'),
      h(
        'button',
        {
          title: 'Создать заметку, которая попадёт в эту базу',
          onclick: () => {
            // On a board, a new note should land in a column rather than outside the board.
            const group = view.type === 'board' ? groupRule(view) : null
            const key = group ? noteKey(group.property) : null
            const first = result.groups.find((g) => g.key !== null && g.key !== undefined)?.key
            void createRecord(app, [config.filters, view.filters], key && first !== undefined ? { [key]: first } : {})
          },
        },
        '+ Запись',
      ),
    )

    const render = RENDERERS[view.type]
    const body = h(
      'div',
      { class: 'base-body' },
      !render
        ? h('div', { class: 'base-error' }, `Неизвестный тип представления «${view.type}». Доступны: table, cards, list, board.`)
        : result.rows.length
          ? render(ctx)
          : h('div', { class: 'base-empty' }, 'Под условия базы не подходит ни одна заметка.'),
    )
    el.replaceChildren(
      toolbar,
      ...result.errors.map((message) => h('div', { class: 'base-error' }, message)),
      ...(settingsOpen ? [settings(ctx, views.length)] : []),
      body,
    )
    body.scrollTop = scroll
  }

  /** The panel behind ⚙: everything about the current view that can be set without editing YAML. */
  function settings(ctx: ViewContext, viewCount: number): HTMLElement {
    const { view, engine, columns, updateView } = ctx
    const available = [...new Set([...columns, ...engine.available(ctx.result.rows)])]
    const options = (selected: string | undefined, none: string) => [
      h('option', { value: '', selected: !selected }, none),
      ...available.map((property) => h('option', { value: property, selected: property === selected }, engine.label(property))),
    ]
    const direction = (current: string | undefined, onchange: (value: string) => void) => {
      const el = h(
        'select',
        { onchange: () => onchange(el.value) },
        h('option', { value: 'ASC', selected: current?.toUpperCase() !== 'DESC' }, 'по возрастанию'),
        h('option', { value: 'DESC', selected: current?.toUpperCase() === 'DESC' }, 'по убыванию'),
      )
      return el
    }
    const field = (label: string, ...controls: (Node | null)[]) => h('label', { class: 'base-setting' }, h('span', {}, label), ...controls)

    const name = h('input', { type: 'text', value: view.name ?? '', onchange: () => updateView({ name: name.value.trim() }) })
    const type = h(
      'select',
      { onchange: () => updateView({ type: type.value }) },
      ...VIEW_TYPES.map((t) => h('option', { value: t.type, selected: t.type === view.type }, t.label)),
    )
    const group = groupRule(view)
    const groupBy = h(
      'select',
      { onchange: () => updateView({ groupBy: groupBy.value ? { property: groupBy.value, direction: group?.direction ?? 'ASC' } : undefined }) },
      ...options(group?.property, 'нет'),
    )
    const sort = Array.isArray(view.sort) ? view.sort[0] : undefined
    const sortBy = h(
      'select',
      { onchange: () => updateView({ sort: sortBy.value ? [{ property: sortBy.value, direction: sort?.direction ?? 'ASC' }] : [] }) },
      ...options(sort?.property, 'по имени'),
    )
    const limit = h('input', {
      type: 'number',
      min: '1',
      placeholder: 'все',
      value: view.limit ? String(view.limit) : '',
      onchange: () => updateView({ limit: limit.value ? Math.max(1, Number(limit.value)) : undefined }),
    })
    const image = h('select', { onchange: () => updateView({ image: image.value || undefined }) }, ...options(view.image, 'нет'))

    const toggles = available.map((property) => {
      const box = h('input', { type: 'checkbox', checked: columns.includes(property) })
      box.onchange = () => updateView({ order: box.checked ? [...columns, property] : columns.filter((c) => c !== property) })
      return h('label', { class: 'base-check' }, box, engine.label(property))
    })

    const summaries = columns.map((property) => {
      const current = view.summaries?.[property] ?? ''
      const names = engine.summaryNames()
      const el = h(
        'select',
        {
          onchange: () => {
            const next = { ...(view.summaries ?? {}) }
            if (el.value) next[property] = el.value
            else delete next[property]
            updateView({ summaries: Object.keys(next).length ? next : undefined })
          },
        },
        h('option', { value: '', selected: !current }, '—'),
        ...names.map((n) => h('option', { value: n, selected: n === current }, n)),
      )
      return h('label', { class: 'base-check' }, engine.label(property), el)
    })

    return h(
      'div',
      { class: 'base-settings' },
      h('div', { class: 'base-settings-row' }, field('Название', name), field('Вид', type), field('Лимит', limit)),
      h(
        'div',
        { class: 'base-settings-row' },
        field('Группировка', groupBy, group ? direction(group.direction, (d) => updateView({ groupBy: { property: group.property, direction: d } })) : null),
        field('Сортировка', sortBy, sort ? direction(sort.direction, (d) => updateView({ sort: [{ property: sort.property, direction: d }] })) : null),
        view.type === 'cards' || view.type === 'board' ? field('Обложка', image) : null,
      ),
      h('div', { class: 'base-settings-title' }, 'Свойства'),
      h('div', { class: 'base-checks' }, ...toggles),
      view.type === 'table' ? h('div', { class: 'base-settings-title' }, 'Итоги по столбцам') : null,
      view.type === 'table' ? h('div', { class: 'base-checks' }, ...summaries) : null,
      viewCount > 1
        ? h(
            'button',
            {
              class: 'base-delete',
              onclick: () => {
                const index = active
                active = Math.max(0, active - 1)
                save(editBase(source, (doc) => void doc.deleteIn(['views', index])))
              },
            },
            'Удалить это представление',
          )
        : null,
      h('p', { class: 'base-hint' }, 'Фильтры и формулы задаются в тексте базы: кнопка </> в углу блока.'),
    )
  }

  // The base shows live data: it is redrawn when notes change, but never under the user's hands.
  const busy = () => {
    const focused = document.activeElement
    return !!focused && el.contains(focused) && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (busy()) stale = true
      else draw()
    }, 150)
  }
  const off = app.metadata.on('resolved', refresh)
  const onFocusOut = () => {
    if (!stale) return
    stale = false
    refresh()
  }
  el.addEventListener('focusout', onFocusOut)

  draw()
  return {
    update(next) {
      if (next === source) return
      source = next
      draw()
    },
    destroy() {
      clearTimeout(timer)
      off()
      el.removeEventListener('focusout', onFocusOut)
    },
  }
}
