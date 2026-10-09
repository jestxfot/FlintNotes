import { errorMessage, expr, plural, setProperties, type App } from '../../api'
import { createRecord } from './create'
import { h } from './dom'
import { BaseEngine, groupRule, noteKey, type Row, type ViewResult } from './engine'
import { editBase, parseBase, VIEW_TYPES, viewLabel, viewsOf, type BaseConfig, type FilterNode, type SortRule, type ViewConfig } from './model'
import { board } from './views/board'
import { cards } from './views/cards'
import { list } from './views/list'
import type { ViewContext, ViewRenderer } from './views/shared'
import { table } from './views/table'

const RENDERERS: Record<string, ViewRenderer> = { table, cards, list, board }
const VIEW_ICONS: Record<string, string> = { table: 'table', cards: 'layout-grid', list: 'list', board: 'kanban' }

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
  /** Which panel of the toolbar is open. */
  let open: 'views' | 'view' | 'sort' | 'group' | 'filter' | 'props' | null = null
  let searching = false
  let search = ''
  let stale = false
  let offscreen = false

  const save = (next: string) => {
    source = next
    host.setSource(next)
    draw()
  }

  function draw(): void {
    // Nothing is worked out for a base that is not on screen; it catches up when it is.
    if (!el.isConnected || el.offsetParent === null) {
      offscreen = true
      return
    }
    offscreen = false
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

    // ---- what the search field leaves
    const needle = search.trim().toLowerCase()
    const matches = (row: Row) => row.file.basename.toLowerCase().includes(needle) || columns.some((property) => expr.toText(engine.value(row, property)).toLowerCase().includes(needle))
    const shown: ViewResult = needle ? { ...result, rows: result.rows.filter(matches), groups: result.groups.map((group) => ({ ...group, rows: group.rows.filter(matches) })).filter((group) => group.rows.length) } : result
    ctx.result = shown

    const icon = (name: string) => app.icons.draw(name)
    const tool = (id: Exclude<typeof open, null>, glyph: string, label: string, on = false) =>
      h('button', { class: `base-tool${open === id ? ' active' : ''}${on ? ' on' : ''}`, title: label, onclick: () => ((open = open === id ? null : id), draw()) }, icon(glyph), label)
    const searchBox = h('input', {
      class: 'base-search',
      type: 'search',
      placeholder: 'Поиск…',
      value: search,
      oninput: () => {
        search = searchBox.value
        draw()
        // The field is drawn anew with the rest; the cursor goes back into it.
        const again = el.querySelector<HTMLInputElement>('.base-search')
        again?.focus()
        again?.setSelectionRange(search.length, search.length)
      },
    })

    const toolbar = h(
      'div',
      { class: 'base-toolbar' },
      h('button', { class: `base-view-switch${open === 'views' || open === 'view' ? ' active' : ''}`, title: 'Представления', onclick: () => ((open = open === 'views' ? null : 'views'), draw()) }, icon(VIEW_ICONS[view.type] ?? 'table'), h('b', {}, view.name ?? viewLabel(view.type)), h('span', { class: 'base-chevrons' }, '⌄')),
      h('span', { class: 'base-count' }, plural(shown.rows.length, ['запись', 'записи', 'записей'])),
      h('span', { class: 'base-spacer' }),
      tool('sort', 'arrow-up-down', 'Сортировка', Array.isArray(view.sort) && view.sort.length > 0),
      tool('group', 'rows-3', 'Группа', !!groupRule(view)),
      tool('filter', 'list-filter', 'Фильтр', !!view.filters || !!config.filters),
      tool('props', 'list', 'Свойства'),
      searching || search ? searchBox : h('button', { class: 'base-tool', title: 'Поиск', onclick: () => ((searching = true), draw(), el.querySelector<HTMLInputElement>('.base-search')?.focus()) }, icon('search'), 'Поиск'),
      h(
        'button',
        {
          class: 'base-tool',
          title: 'Создать заметку, которая попадёт в эту базу',
          onclick: () => {
            // On a board, a new note should land in a column rather than outside the board.
            const group = view.type === 'board' ? groupRule(view) : null
            const key = group ? noteKey(group.property) : null
            const first = result.groups.find((g) => g.key !== null && g.key !== undefined)?.key
            void createRecord(app, [config.filters, view.filters], key && first !== undefined ? { [key]: first } : {})
          },
        },
        icon('plus'),
        'Создать',
      ),
    )

    const render = RENDERERS[view.type]
    const body = h(
      'div',
      { class: 'base-body' },
      !render
        ? h('div', { class: 'base-error' }, `Неизвестный тип представления «${view.type}». Доступны: table, cards, list, board.`)
        : shown.rows.length
          ? render(ctx)
          : h('div', { class: 'base-empty' }, needle ? 'Ничего не найдено.' : 'Под условия базы не подходит ни одна заметка.'),
    )
    el.replaceChildren(toolbar, ...(open ? [popover(ctx, config, views)] : []), ...result.errors.map((message) => h('div', { class: 'base-error' }, message)), body)
    body.scrollTop = scroll
  }

  /** The panel under the toolbar for whichever of its buttons is pressed. */
  function popover(ctx: ViewContext, config: BaseConfig, views: ViewConfig[]): HTMLElement {
    const { view, engine, columns, updateView } = ctx
    const available = [...new Set([...columns, ...engine.available(ctx.result.rows)])]
    const options = (selected: string | undefined, none: string | null) => [
      ...(none === null ? [] : [h('option', { value: '', selected: !selected }, none)]),
      ...available.map((property) => h('option', { value: property, selected: property === selected }, engine.label(property))),
    ]
    const direction = (current: string | undefined, onchange: (value: string) => void) => {
      const select = h(
        'select',
        { onchange: () => onchange(select.value) },
        h('option', { value: 'ASC', selected: current?.toUpperCase() !== 'DESC' }, 'От А до Я'),
        h('option', { value: 'DESC', selected: current?.toUpperCase() === 'DESC' }, 'От Я до А'),
      )
      return select
    }
    const field = (label: string, ...controls: (Node | null)[]) => h('label', { class: 'base-setting' }, h('span', {}, label), ...controls)
    const remove = (title: string, onclick: () => void) => h('button', { class: 'base-pop-remove', title, onclick }, app.icons.draw('trash'))
    const pop = (side: 'left' | 'right', ...children: (Node | null)[]) => h('div', { class: `base-pop ${side}` }, ...children)

    if (open === 'views') {
      const addView = h(
        'select',
        {
          class: 'base-add-view',
          title: 'Добавить представление',
          onchange: () => {
            const type = addView.value
            active = views.length
            open = 'view'
            save(editBase(source, (doc) => doc.addIn(['views'], doc.createNode({ type, name: viewLabel(type) }))))
          },
        },
        h('option', { value: '', hidden: true, selected: true }, '+ Добавить представление'),
        ...VIEW_TYPES.map(({ type, label }) => h('option', { value: type }, label)),
      )
      return pop(
        'left',
        h(
          'div',
          { class: 'base-tabs', role: 'tablist' },
          ...views.map((v, i) =>
            h(
              'div',
              { class: 'base-view-row' },
              h(
                'button',
                {
                  class: i === active ? 'active' : '',
                  role: 'tab',
                  onclick: () => {
                    active = i
                    open = null
                    draw()
                  },
                },
                app.icons.draw(VIEW_ICONS[v.type] ?? 'table'),
                v.name ?? viewLabel(v.type),
              ),
              h('a', { class: 'base-view-edit', title: 'Настроить представление', onclick: () => ((active = i), (open = 'view'), draw()) }, '›'),
            ),
          ),
        ),
        addView,
      )
    }

    if (open === 'view') {
      const name = h('input', { type: 'text', value: view.name ?? '', onchange: () => updateView({ name: name.value.trim() }) })
      const type = h('select', { onchange: () => updateView({ type: type.value }) }, ...VIEW_TYPES.map((t) => h('option', { value: t.type, selected: t.type === view.type }, t.label)))
      const limit = h('input', {
        type: 'number',
        min: '1',
        placeholder: 'все',
        value: view.limit ? String(view.limit) : '',
        onchange: () => updateView({ limit: limit.value ? Math.max(1, Number(limit.value)) : undefined }),
      })
      const image = h('select', { onchange: () => updateView({ image: image.value || undefined }) }, ...options(view.image, 'нет'))
      return pop(
        'left',
        h('div', { class: 'base-pop-title' }, h('a', { class: 'base-view-edit', onclick: () => ((open = 'views'), draw()) }, '‹'), 'Представление'),
        field('Название', name),
        field('Вид', type),
        field('Лимит', limit),
        view.type === 'cards' || view.type === 'board' ? field('Обложка', image) : null,
        views.length > 1
          ? h(
              'button',
              {
                class: 'base-delete',
                onclick: () => {
                  const index = active
                  active = Math.max(0, active - 1)
                  open = 'views'
                  save(editBase(source, (doc) => void doc.deleteIn(['views', index])))
                },
              },
              'Удалить это представление',
            )
          : null,
      )
    }

    if (open === 'sort') {
      const rules = Array.isArray(view.sort) ? view.sort : []
      const set = (next: SortRule[]) => updateView({ sort: next })
      return pop(
        'right',
        h('div', { class: 'base-pop-title' }, 'Сортировать по'),
        ...rules.map((rule, i) => {
          const property = h('select', { onchange: () => set(rules.map((r, n) => (n === i ? { ...r, property: property.value } : r))) }, ...options(rule.property, null))
          return h('div', { class: 'base-setting' }, property, direction(rule.direction, (d) => set(rules.map((r, n) => (n === i ? { ...r, direction: d } : r)))), remove('Убрать', () => set(rules.filter((_, n) => n !== i))))
        }),
        h('button', { class: 'base-pop-add', onclick: () => set([...rules, { property: available.find((p) => !rules.some((r) => r.property === p)) ?? available[0], direction: 'ASC' }]) }, '+ Добавить сортировку'),
      )
    }

    if (open === 'group') {
      const group = groupRule(view)
      const groupBy = h('select', { onchange: () => updateView({ groupBy: groupBy.value ? { property: groupBy.value, direction: group?.direction ?? 'ASC' } : undefined }) }, ...options(group?.property, 'нет'))
      return pop('right', h('div', { class: 'base-pop-title' }, 'Группировать по'), field('Группировка', groupBy, group ? direction(group.direction, (d) => updateView({ groupBy: { property: group.property, direction: d } })) : null))
    }

    if (open === 'filter') {
      /** One level of conditions as a list: how they combine, and each as text. */
      const filterEditor = (title: string, node: FilterNode | undefined, write: (next: FilterNode | undefined) => void) => {
        const mode = typeof node === 'object' && node ? (node.or ? 'or' : node.not ? 'not' : 'and') : 'and'
        const items = (typeof node === 'string' ? [node] : node ? (node[mode] ?? []) : []).map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
        const commit = (nextMode: string, list: string[]) => {
          // A nested group is kept as written; it is edited in the base's text.
          const parsed = list.map((text) => text.trim()).filter(Boolean).map((text): FilterNode => (text.startsWith('{') ? (JSON.parse(text) as FilterNode) : text))
          write(parsed.length ? ({ [nextMode]: parsed } as FilterNode) : undefined)
        }
        const how = h(
          'select',
          { onchange: () => commit(how.value, items) },
          h('option', { value: 'and', selected: mode === 'and' }, 'Всё нижеследующее истинно'),
          h('option', { value: 'or', selected: mode === 'or' }, 'Любое из нижеследующего истинно'),
          h('option', { value: 'not', selected: mode === 'not' }, 'Ничто из нижеследующего не истинно'),
        )
        return h(
          'div',
          { class: 'base-filter' },
          h('div', { class: 'base-pop-title' }, title, items.length ? h('span', { class: 'base-pop-count' }, String(items.length)) : null),
          items.length ? how : null,
          ...items.map((text, i) => {
            const input = h('input', { type: 'text', class: 'base-filter-expr', value: text, spellcheck: false, onchange: () => commit(mode, items.map((item, n) => (n === i ? input.value : item))) })
            return h('div', { class: 'base-setting' }, h('span', {}, 'Где'), input, remove('Убрать фильтр', () => commit(mode, items.filter((_, n) => n !== i))))
          }),
          h(
            'button',
            {
              class: 'base-pop-add',
              onclick: () => {
                commit(mode, [...items, 'file.name != ""'])
                const inputs = el.querySelectorAll<HTMLInputElement>('.base-filter-expr')
                inputs[inputs.length - 1]?.select()
              },
            },
            '+ Добавить фильтр',
          ),
        )
      }
      return pop(
        'right',
        filterEditor('Все представления', config.filters, (next) => save(editBase(source, (doc) => void (next ? doc.set('filters', doc.createNode(next)) : doc.delete('filters'))))),
        filterEditor('Текущее представление', view.filters, (next) => updateView({ filters: next })),
        h('p', { class: 'base-hint' }, 'Условие — выражение: file.hasTag("book"), rating >= 4, file.inFolder("Books").'),
      )
    }

    const toggles = available.map((property) => {
      const box = h('input', { type: 'checkbox', checked: columns.includes(property) })
      box.onchange = () => updateView({ order: box.checked ? [...columns, property] : columns.filter((c) => c !== property) })
      return h('label', { class: 'base-check' }, box, engine.label(property))
    })
    const summaries = columns.map((property) => {
      const current = view.summaries?.[property] ?? ''
      const select = h(
        'select',
        {
          onchange: () => {
            const next = { ...(view.summaries ?? {}) }
            if (select.value) next[property] = select.value
            else delete next[property]
            updateView({ summaries: Object.keys(next).length ? next : undefined })
          },
        },
        h('option', { value: '', selected: !current }, '—'),
        ...engine.summaryNames().map((n) => h('option', { value: n, selected: n === current }, n)),
      )
      return h('label', { class: 'base-check' }, engine.label(property), select)
    })
    return pop(
      'right',
      h('div', { class: 'base-pop-title' }, 'Свойства'),
      h('div', { class: 'base-checks' }, ...toggles),
      view.type === 'table' ? h('div', { class: 'base-pop-title' }, 'Итоги по столбцам') : null,
      view.type === 'table' ? h('div', { class: 'base-checks' }, ...summaries) : null,
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
  // A click anywhere outside the open panel and the toolbar closes the panel.
  const onPointer = (event: PointerEvent) => {
    if (!open || (event.target instanceof Element && event.target.closest('.base-pop, .base-toolbar'))) return
    open = null
    draw()
  }
  document.addEventListener('pointerdown', onPointer, true)
  const onFocusOut = () => {
    if (!stale) return
    stale = false
    refresh()
  }
  el.addEventListener('focusout', onFocusOut)
  const visible = new IntersectionObserver((entries) => {
    if (offscreen && entries.some((entry) => entry.isIntersecting)) draw()
  })
  visible.observe(el)

  // The element is not in the page yet while the block is being created.
  requestAnimationFrame(draw)
  return {
    update(next) {
      if (next === source) return
      source = next
      draw()
    },
    destroy() {
      clearTimeout(timer)
      off()
      visible.disconnect()
      el.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('pointerdown', onPointer, true)
    },
  }
}
