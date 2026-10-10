import { errorMessage, expr, path as paths, plural, setProperties, type App } from '../../api'
import { createRecord } from './create'
import { h } from './dom'
import { BaseEngine, groupRule, noteKey, type Row, type ViewResult } from './engine'
import { editBase, parseBase, VIEW_TYPES, viewLabel, viewsOf, type BaseConfig, type FilterNode, type SortRule, type ViewConfig } from './model'
import { board } from './views/board'
import { calendar } from './views/calendar'
import { cards } from './views/cards'
import { list } from './views/list'
import type { ViewContext, ViewRenderer } from './views/shared'
import { table } from './views/table'

const RENDERERS: Record<string, ViewRenderer> = { table, cards, list, board, calendar }
/** A condition the filter panel can show as fields: what is tested, how, and against what. */
interface Condition {
  subject: string
  op: string
  value: string
}

const FILE_OPS: [id: string, label: string][] = [
  ['hasLink', 'ссылается на'],
  ['inFolder', 'в папке'],
  ['hasTag', 'имеет тег'],
  ['hasProperty', 'имеет свойство'],
  ['!hasLink', 'не ссылается на'],
  ['!inFolder', 'не в папке'],
  ['!hasTag', 'не имеет тега'],
  ['!hasProperty', 'не имеет свойства'],
]
const VALUE_OPS: [id: string, label: string][] = [
  ['==', 'равно'],
  ['!=', 'не равно'],
  ['contains', 'содержит'],
  ['!contains', 'не содержит'],
  ['startsWith', 'начинается с'],
  ['endsWith', 'заканчивается на'],
  ['>', 'больше'],
  ['<', 'меньше'],
  ['>=', 'не меньше'],
  ['<=', 'не больше'],
  ['isEmpty', 'пусто'],
  ['!isEmpty', 'не пусто'],
]
const NO_VALUE = new Set(['isEmpty', '!isEmpty'])
const operatorsFor = (subject: string) => (subject === 'file' ? FILE_OPS : VALUE_OPS)

const literal = String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false)`
const name = String.raw`([\p{L}_][\p{L}\p{N}_.-]*)`
const unquote = (text: string) => (/^["']/.test(text) ? text.slice(1, -1).replace(/\\(.)/g, '$1') : text)

/** Reads a condition of one of the plain kinds; `null` for anything richer, which stays an expression. */
function parseCondition(text: string): Condition | null {
  const source = text.trim()
  let m = new RegExp(`^(!?)file\\.(hasLink|inFolder|hasTag|hasProperty)\\(\\s*${literal}?\\s*\\)$`, 'u').exec(source)
  if (m) return { subject: 'file', op: m[1] + m[2], value: m[3] ? unquote(m[3]) : '' }
  m = new RegExp(`^(!?)${name}\\.(contains|startsWith|endsWith)\\(\\s*${literal}\\s*\\)$`, 'u').exec(source)
  if (m && (m[1] === '' || m[3] === 'contains')) return { subject: m[2], op: m[1] + m[3], value: unquote(m[4]) }
  m = new RegExp(`^(!?)${name}\\.isEmpty\\(\\s*\\)$`, 'u').exec(source)
  if (m) return { subject: m[2], op: `${m[1]}isEmpty`, value: '' }
  m = new RegExp(`^${name}\\s*(==|!=|>=|<=|>|<)\\s*${literal}$`, 'u').exec(source)
  if (m && m[1] !== 'file') return { subject: m[1], op: m[2], value: unquote(m[3]) }
  return null
}

/** Writes a condition as an expression of the Bases language. */
function formatCondition({ subject, op, value }: Condition): string {
  const not = op.startsWith('!') && op !== '!=' ? '!' : ''
  const bare = not ? op.slice(1) : op
  const quoted = JSON.stringify(value)
  if (subject === 'file') return `${not}file.${bare}(${quoted})`
  if (bare === 'isEmpty') return `${not}${subject}.isEmpty()`
  if (['contains', 'startsWith', 'endsWith'].includes(bare)) return `${not}${subject}.${bare}(${quoted})`
  // A number or yes/no is compared as such; anything else as text.
  return `${subject} ${bare} ${/^-?\d+(?:\.\d+)?$|^(true|false)$/.test(value.trim()) ? value.trim() : quoted}`
}

const VIEW_ICONS: Record<string, string> = { table: 'table', cards: 'layout-grid', list: 'list', board: 'kanban', calendar: 'calendar-days' }

export interface BaseHost {
  app: App
  /** The note or `.base` file the base lives in. */
  sourcePath: string
  /** Saves the base's YAML. */
  setSource(source: string): void
  /** Name of the view to show first. */
  initialView?: string
  /** Names this showing of the base (which note it is in, which file it is). The view chosen in it is remembered under this name. */
  memory?: string
}

export interface MountedBase {
  update(source: string): void
  destroy(): void
}

/** How many records of a base are drawn at first. */
const PAGE = 120

/** Draws a base (its views, toolbar and settings) into `el` and keeps it current. */
export function mountBase(el: HTMLElement, host: BaseHost, initial: string): MountedBase {
  const { app } = host
  el.classList.add('base')
  let source = initial
  // The view last chosen in this very place comes back; it is kept with the vault's layout, the note is not touched.
  const chosen = () => app.state.get<Record<string, string>>('base-views', {})
  const remembered = host.memory ? chosen()[host.memory] : undefined
  const startAt = (name: string | undefined) => viewsOf(parseBase(initial).config).findIndex((view) => view.name === name)
  let active = Math.max(0, startAt(remembered) >= 0 ? startAt(remembered) : startAt(host.initialView))
  const rememberView = (name: string | undefined) => {
    if (!host.memory || !name) return
    const all = { ...chosen() }
    delete all[host.memory]
    all[host.memory] = name
    // Only the latest few hundred places are kept.
    app.state.set('base-views', Object.fromEntries(Object.entries(all).slice(-300)))
  }
  /** Which panel of the toolbar is open. */
  let open: 'views' | 'view' | 'sort' | 'group' | 'filter' | 'props' | null = null
  let searching = false
  /** Sections of the filter panel that are folded, and conditions the user asked to see as expressions. */
  const folded = new Set<string>()
  const raw = new Set<string>()
  let search = ''
  let stale = false
  let offscreen = false
  /** How many records are drawn. A large base is drawn a part at a time, more as the reader gets near the end. */
  let limit = PAGE
  /** What the limit was counted for: another view or another search starts from the first part again. */
  let limitFor = ''
  /** How long the last drawing took: a heavy base is redrawn less often while notes are changing. */
  let cost = 0
  const more = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    limit *= 2
    draw()
  }, { rootMargin: '600px' })

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
    const started = performance.now()
    more.disconnect()
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
    // Only a part of a long list is drawn; totals and the count still speak of all of it.
    const part = `${active}|${needle}|${view.type}`
    if (part !== limitFor) {
      limitFor = part
      limit = PAGE
    }
    const paged = view.type !== 'calendar' && shown.rows.length > limit
    let left = limit
    ctx.total = shown
    ctx.result = !paged
      ? shown
      : {
          ...shown,
          rows: shown.rows.slice(0, limit),
          groups: shown.groups
            .map((group) => {
              const rows = group.rows.slice(0, Math.max(0, left))
              left -= rows.length
              return { ...group, rows }
            })
            .filter((group) => group.rows.length),
        }

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
        ? h('div', { class: 'base-error' }, `Неизвестный тип представления «${view.type}». Доступны: table, cards, list, board, calendar.`)
        : shown.rows.length
          ? render(ctx)
          : h('div', { class: 'base-empty' }, needle ? 'Ничего не найдено.' : 'Под условия базы не подходит ни одна заметка.'),
    )
    const rest = paged
      ? h(
          'button',
          {
            class: 'base-more',
            onclick: () => {
              limit *= 2
              draw()
            },
          },
          `Показано ${limit} из ${shown.rows.length} · показать ещё`,
        )
      : null
    el.replaceChildren(h('div', { class: 'base-head' }, toolbar), ...(open ? [popover({ ...ctx, result: shown }, config, views)] : []), ...result.errors.map((message) => h('div', { class: 'base-error' }, message)), body, ...(rest ? [rest] : []))
    body.scrollTop = scroll
    placePanel()
    // The next part is drawn by itself when the end of this one comes near.
    if (rest) more.observe(rest)
    cost = performance.now() - started
  }

  /**
   * Puts the open panel under the toolbar. It is fixed to the window rather than
   * laid out inside the base, so a short base (or the edge of the note) cannot cut it off.
   */
  function placePanel(): void {
    const panel = el.querySelector<HTMLElement>('.base-pop')
    const bar = el.querySelector<HTMLElement>('.base-toolbar')
    if (!panel || !bar) return
    const box = bar.getBoundingClientRect()
    const top = box.bottom + 4
    // The toolbar's own right padding (room for the block's button) is not part of its tools.
    const right = box.right - parseFloat(getComputedStyle(bar).paddingRight)
    panel.style.top = `${top}px`
    panel.style.maxHeight = `${Math.max(140, window.innerHeight - top - 12)}px`
    panel.style.maxWidth = `${Math.min(520, window.innerWidth - 24)}px`
    if (panel.classList.contains('right')) panel.style.right = `${Math.max(12, window.innerWidth - right)}px`
    else panel.style.left = `${Math.max(12, box.left)}px`
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
      const add = (type: string) => {
        active = views.length
        open = 'view'
        save(editBase(source, (doc) => doc.addIn(['views'], doc.createNode({ type, name: viewLabel(type) }))))
      }
      const rows = views.map((v, i) =>
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
                rememberView(views[i]?.name)
                open = null
                draw()
              },
            },
            app.icons.draw(VIEW_ICONS[v.type] ?? 'table'),
            v.name ?? viewLabel(v.type),
          ),
          h('a', { class: 'base-view-edit', title: 'Настроить представление', onclick: () => ((active = i), (open = 'view'), draw()) }, '›'),
        ),
      )
      const find = h('input', {
        type: 'text',
        class: 'base-props-search',
        placeholder: 'Введите поисковый запрос…',
        oninput: () => rows.forEach((row, i) => (row.hidden = !(views[i].name ?? viewLabel(views[i].type)).toLowerCase().includes(find.value.trim().toLowerCase()))),
      })
      // The kinds of view appear under the button once it is pressed.
      const kinds = h('div', { class: 'base-add-types', hidden: true }, ...VIEW_TYPES.map(({ type, label }) => h('button', { class: 'base-add-type', onclick: () => add(type) }, app.icons.draw(VIEW_ICONS[type] ?? 'table'), label)))
      const addView = h('button', { class: 'base-pop-add base-add-view', onclick: () => (kinds.hidden = !kinds.hidden) }, app.icons.draw('plus'), 'Добавить представление')
      return pop('left', find, h('div', { class: 'base-tabs', role: 'tablist' }, ...rows), h('div', { class: 'base-pop-line' }), addView, kinds)
    }

    if (open === 'view') {
      const name = h('input', { type: 'text', class: 'base-view-name', value: view.name ?? '', onchange: () => updateView({ name: name.value.trim() }) })
      const type = h('select', { onchange: () => updateView({ type: type.value }) }, ...VIEW_TYPES.map((t) => h('option', { value: t.type, selected: t.type === view.type }, t.label)))
      const limit = h('input', {
        type: 'number',
        min: '1',
        placeholder: 'все',
        value: view.limit ? String(view.limit) : '',
        onchange: () => updateView({ limit: limit.value ? Math.max(1, Number(limit.value)) : undefined }),
      })
      const stacked = (label: string, ...controls: (Node | null)[]) => h('label', { class: 'base-setting stacked' }, h('span', {}, label), ...controls)
      /** A slider with its value beside it; the base is written when the slider is let go. */
      const slider = (value: number, min: number, max: number, step: number, change: (next: number) => void) => {
        const shown = h('span', { class: 'base-slider-value' }, String(value))
        const range = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), oninput: () => (shown.textContent = range.value), onchange: () => change(Number(range.value)) })
        return h('div', { class: 'base-slider' }, shown, range)
      }
      const cardsLike = view.type === 'cards' || view.type === 'board'
      const image = h('select', { onchange: () => updateView({ image: image.value || undefined }) }, ...options(view.image, 'нет'))
      const fit = h(
        'select',
        { onchange: () => updateView({ imageFit: fit.value === 'cover' ? undefined : fit.value }) },
        h('option', { value: 'cover', selected: view.imageFit !== 'contain' }, 'Обложка'),
        h('option', { value: 'contain', selected: view.imageFit === 'contain' }, 'Вместить целиком'),
      )
      const date = h('select', { onchange: () => updateView({ date: date.value || undefined }) }, ...options(view.date, 'сама: первое свойство с датой'))
      const removeView = () => {
        const index = active
        active = Math.max(0, active - 1)
        open = 'views'
        save(editBase(source, (doc) => void doc.deleteIn(['views', index])))
      }
      const more = h(
        'button',
        {
          class: 'base-pop-remove',
          title: 'Ещё',
          onclick: (event: MouseEvent) =>
            app.menus.show(event, 'base-view', view, [
              {
                icon: 'copy',
                title: 'Дублировать представление',
                onClick: () => {
                  open = 'view'
                  active = views.length
                  save(editBase(source, (doc) => doc.addIn(['views'], doc.createNode({ ...view, name: `${view.name ?? viewLabel(view.type)} 2` }))))
                },
              },
              { icon: 'trash', title: 'Удалить представление', danger: true, section: 'danger', disabled: views.length < 2, onClick: removeView },
            ]),
        },
        app.icons.draw('ellipsis-vertical'),
      )
      return pop(
        'left',
        h(
          'div',
          { class: 'base-pop-title' },
          h('a', { class: 'base-view-edit', title: 'К списку представлений', onclick: () => ((open = 'views'), draw()) }, '‹'),
          h('span', { class: 'base-grow' }, 'Настройка представления'),
          more,
          h('button', { class: 'base-pop-remove', title: 'Закрыть', onclick: () => ((open = null), draw()) }, app.icons.draw('x')),
        ),
        name,
        stacked('Расположение', type),
        view.type === 'cards' ? stacked('Размер карты', slider(Number(view.cardSize) || 170, 100, 400, 10, (next) => updateView({ cardSize: next }))) : null,
        cardsLike ? stacked('Свойство изображения', image) : null,
        cardsLike && view.image ? stacked('Подгонка изображения', fit) : null,
        cardsLike && view.image ? stacked('Соотношение сторон изображения', slider(Number(view.imageAspectRatio) || 0.55, 0.25, 2.5, 0.05, (next) => updateView({ imageAspectRatio: next }))) : null,
        view.type === 'calendar' ? stacked('Свойство с датой', date) : null,
        stacked('Лимит записей', limit),
        views.length > 1 ? h('button', { class: 'base-delete', onclick: removeView }, 'Удалить это представление') : null,
      )
    }

    /** A property and a direction joined into one control, with a bin beside it, as in Obsidian. */
    const ruleRow = (rule: SortRule | null, none: string | null, change: (next: SortRule | null) => void) => {
      const property = h('select', { class: 'base-rule-property', onchange: () => change(property.value ? { property: property.value, direction: rule?.direction ?? 'ASC' } : null) }, ...options(rule?.property, none))
      return h(
        'div',
        { class: 'base-setting base-rule' },
        h('div', { class: 'base-joined' }, property, rule ? direction(rule.direction, (d) => change({ ...rule, direction: d })) : null),
        rule ? remove('Убрать', () => change(null)) : null,
      )
    }

    if (open === 'sort') {
      const rules = Array.isArray(view.sort) ? view.sort : []
      const set = (next: SortRule[]) => updateView({ sort: next })
      return pop(
        'right',
        h('div', { class: 'base-pop-title' }, 'Сортировать по'),
        ...rules.map((rule, i) => ruleRow(rule, null, (next) => set(next ? rules.map((r, n) => (n === i ? next : r)) : rules.filter((_, n) => n !== i)))),
        h('div', { class: 'base-pop-line' }),
        h('button', { class: 'base-pop-add', onclick: () => set([...rules, { property: available.find((p) => !rules.some((r) => r.property === p)) ?? available[0], direction: 'ASC' }]) }, app.icons.draw('plus'), 'Добавить сортировку'),
      )
    }

    if (open === 'group') {
      const group = groupRule(view)
      const row = ruleRow(group, 'Свойство', (next) => updateView({ groupBy: next ?? undefined }))
      row.prepend(h('span', { class: 'base-hidden-label' }, 'Группировка'))
      return pop('right', h('div', { class: 'base-pop-title' }, 'Группировать по'), row)
    }

    if (open === 'filter') {
      let hintLists = 0
      const bare = (op: string) => op.replace(/^!/, '')
      const placeholderFor = (condition: Condition) =>
        condition.subject !== 'file' ? 'Нет значения' : bare(condition.op) === 'hasLink' ? 'заметка или База.base#Вид' : bare(condition.op) === 'hasTag' ? 'тег' : bare(condition.op) === 'inFolder' ? 'папка' : 'свойство'
      /** What the value of a condition may be, from what the vault has. */
      const suggestions = (condition: Condition): string[] => {
        const { vault, metadata } = app
        const sorted = (items: Iterable<string>) => [...new Set(items)].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        if (condition.subject === 'file') {
          const kind = bare(condition.op)
          // A note is named as a link names it; a base also by its views, which notes embed one by one.
          if (kind === 'hasLink') return sorted([...vault.files().map((file) => (paths.extname(file.path) === 'md' ? paths.stripExt(paths.basename(file.path)) : paths.basename(file.path))), ...views.map((one) => `${paths.basename(ctx.sourcePath)}#${one.name}`)])
          if (kind === 'hasTag') return sorted(metadata.notes().flatMap((note) => metadata.get(note)?.tags ?? []))
          if (kind === 'inFolder') return sorted(vault.all().filter((entry) => entry.kind === 'folder').map((entry) => entry.path))
          return sorted(available.filter((property) => !property.startsWith('file.') && !property.startsWith('formula.')))
        }
        const values: string[] = []
        for (const row of ctx.result.rows.slice(0, 3000)) {
          const found = engine.value(row, condition.subject)
          for (const item of Array.isArray(found) ? found : [found]) if (!expr.isEmpty(item)) values.push(expr.toText(item))
        }
        return sorted(values).slice(0, 300)
      }
      /** One condition as three fields, or as an expression when it is not of a kind the fields can show. */
      const conditionRow = (text: string, write: (next: string | null) => void) => {
        const parsed = raw.has(text) ? null : parseCondition(text)
        const bin = remove('Убрать фильтр', () => write(null))
        if (!parsed) {
          const input = h('input', { type: 'text', class: 'base-filter-expr', value: text, spellcheck: false, placeholder: 'выражение', onchange: () => write(input.value) })
          const back = h('button', { class: 'base-pop-remove', title: 'Показать полями', disabled: !parseCondition(text), onclick: () => (raw.delete(text), draw()) }, app.icons.draw('wand-sparkles'))
          return h('div', { class: 'base-setting base-condition' }, h('span', {}, 'Где'), h('div', { class: 'base-joined' }, input, back, bin))
        }
        const commit = (next: Condition) => write(formatCondition(next))
        const subject = h(
          'select',
          {
            class: 'base-condition-subject',
            onchange: () => commit({ subject: subject.value, op: operatorsFor(subject.value).some(([id]) => id === parsed.op) ? parsed.op : operatorsFor(subject.value)[0][0], value: parsed.value }),
          },
          h('option', { value: 'file', selected: parsed.subject === 'file' }, 'файл'),
          ...[...new Set([parsed.subject, ...available])].filter((property) => property !== 'file').map((property) => h('option', { value: property, selected: property === parsed.subject }, engine.label(property))),
        )
        const op = h('select', { class: 'base-condition-op', onchange: () => commit({ ...parsed, op: op.value }) }, ...operatorsFor(parsed.subject).map(([id, label]) => h('option', { value: id, selected: id === parsed.op }, label)))
        // What can be meant is offered as it is typed: notes for a link, tags, folders, the values the property has.
        const hints = NO_VALUE.has(parsed.op) ? null : h('datalist', { id: `base-hints-${++hintLists}` }, ...suggestions(parsed).map((text) => h('option', { value: text })))
        const value = NO_VALUE.has(parsed.op)
          ? null
          : h('input', { type: 'text', class: 'base-condition-value', value: parsed.value, placeholder: placeholderFor(parsed), onchange: () => commit({ ...parsed, value: (value as HTMLInputElement).value }) })
        if (value && hints) value.setAttribute('list', hints.id)
        const asText = h('button', { class: 'base-pop-remove', title: 'Показать выражением', onclick: () => (raw.add(text), draw()) }, app.icons.draw('code-xml'))
        return h('div', { class: 'base-setting base-condition' }, h('span', {}, 'Где'), h('div', { class: 'base-joined' }, subject, op, value, asText, bin), hints)
      }

      /** A group of conditions: how they combine, each of them, and groups nested in it. */
      const groupEditor = (node: FilterNode | undefined, write: (next: FilterNode | undefined) => void, nested: boolean): HTMLElement => {
        const mode = typeof node === 'object' && node ? (node.or ? 'or' : node.not ? 'not' : 'and') : 'and'
        const items: FilterNode[] = typeof node === 'string' ? [node] : node ? (node[mode] ?? []) : []
        const commit = (nextMode: string, list: FilterNode[]) => write(list.length || nested ? ({ [nextMode]: list } as FilterNode) : undefined)
        const replace = (i: number, next: FilterNode | null | undefined) => commit(mode, next === null || next === undefined ? items.filter((_, n) => n !== i) : items.map((item, n) => (n === i ? next : item)))
        const how = h(
          'select',
          { class: 'base-filter-mode', onchange: () => commit(how.value, items) },
          h('option', { value: 'and', selected: mode === 'and' }, 'Всё нижеследующее истинно'),
          h('option', { value: 'or', selected: mode === 'or' }, 'Любое из нижеследующего истинно'),
          h('option', { value: 'not', selected: mode === 'not' }, 'Ничто из нижеследующего не истинно'),
        )
        return h(
          'div',
          { class: nested ? 'base-filter-group nested' : 'base-filter-group' },
          items.length || nested ? h('div', { class: 'base-filter-how' }, how, nested ? remove('Убрать группу', () => write(undefined)) : null) : null,
          ...items.map((item, i) => (typeof item === 'string' ? conditionRow(item, (next) => replace(i, next)) : groupEditor(item, (next) => replace(i, next), true))),
          h(
            'div',
            { class: 'base-filter-add' },
            h('button', { class: 'base-pop-add', onclick: () => commit(mode, [...items, 'file.hasTag("")']) }, app.icons.draw('plus'), 'Добавить фильтр'),
            h('button', { class: 'base-pop-add', onclick: () => commit(mode, [...items, { and: ['file.hasTag("")'] }]) }, app.icons.draw('plus'), 'Добавить группу фильтров'),
          ),
        )
      }

      const count = (node: FilterNode | undefined): number => (!node ? 0 : typeof node === 'string' ? 1 : [...(node.and ?? []), ...(node.or ?? []), ...(node.not ?? [])].reduce((n, item) => n + count(item), 0))
      const section = (id: string, title: string, node: FilterNode | undefined, write: (next: FilterNode | undefined) => void) =>
        h(
          'div',
          { class: 'base-filter' },
          h('button', { class: `base-pop-title base-fold${folded.has(id) ? ' folded' : ''}`, onclick: () => ((folded.has(id) ? folded.delete(id) : folded.add(id)), draw()) }, title, count(node) ? h('span', { class: 'base-pop-count' }, String(count(node))) : null),
          folded.has(id) ? null : groupEditor(node, write, false),
        )
      return pop(
        'right',
        section('all', 'Все представления', config.filters, (next) => save(editBase(source, (doc) => void (next ? doc.set('filters', doc.createNode(next)) : doc.delete('filters'))))),
        section('view', 'Текущее представление', view.filters, (next) => updateView({ filters: next })),
      )
    }

    // ---- properties: a searchable checklist, the shown ones first
    const labelOf = (property: string) => engine.label(property)
    const iconOf = (property: string) => (property.startsWith('formula.') ? 'square-function' : property.startsWith('file.') ? 'info' : /tags?$/i.test(property) ? 'tags' : /date|day|due|created|time/i.test(property) ? 'calendar' : 'align-left')
    const ordered = [...columns, ...available.filter((property) => !columns.includes(property)).sort((x, y) => labelOf(x).localeCompare(labelOf(y)))]
    const list = h('div', { class: 'base-checks' })
    const fill = (query: string) => {
      const wanted = query.trim().toLowerCase()
      list.replaceChildren(
        ...ordered
          .filter((property) => !wanted || labelOf(property).toLowerCase().includes(wanted) || property.toLowerCase().includes(wanted))
          .map((property) => {
            const box = h('input', { type: 'checkbox', checked: columns.includes(property) })
            box.onchange = () => updateView({ order: box.checked ? [...columns, property] : columns.filter((c) => c !== property) })
            return h('label', { class: columns.includes(property) ? 'base-check' : 'base-check off' }, box, app.icons.draw(iconOf(property)), h('span', {}, labelOf(property)))
          }),
      )
    }
    fill('')
    const find = h('input', { type: 'text', class: 'base-props-search', placeholder: 'Найти…', oninput: () => fill(find.value) })
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
      return h('label', { class: 'base-summary' }, h('span', {}, labelOf(property)), select)
    })
    const addFormula = () => {
      const name = prompt('Название формулы (латиницей, без пробелов)')?.trim()
      if (!name) return
      const formula = prompt(`Выражение формулы «${name}», например: price * 1.2`)?.trim()
      if (!formula) return
      save(
        editBase(source, (doc) => {
          doc.setIn(['formulas', name], formula)
          doc.setIn(['views', active, 'order'], [...columns, `formula.${name}`])
        }),
      )
    }
    return pop(
      'right',
      find,
      list,
      view.type === 'table' ? h('details', { class: 'base-summaries' }, h('summary', {}, 'Итоги по столбцам'), ...summaries) : null,
      h('div', { class: 'base-pop-line' }),
      h('button', { class: 'base-pop-add', onclick: addFormula }, app.icons.draw('square-function'), 'Добавить формулу'),
      h('button', { class: 'base-pop-add', onclick: () => updateView({ order: columns.slice(0, 1) }) }, app.icons.draw('eye-off'), 'Скрыть все'),
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
    // A base that takes long to draw waits longer for the changes to settle (notes are still being read at startup).
    timer = setTimeout(() => {
      if (busy()) stale = true
      else draw()
    }, Math.min(4000, Math.max(150, cost * 8)))
  }
  const off = app.metadata.on('resolved', refresh)
  // A click anywhere outside the open panel and the toolbar closes the panel.
  const onPointer = (event: PointerEvent) => {
    if (!open || (event.target instanceof Element && event.target.closest('.base-pop, .base-toolbar'))) return
    open = null
    draw()
  }
  document.addEventListener('pointerdown', onPointer, true)
  // The panel is fixed to the window, so it is moved along when the note scrolls under it.
  const onScroll = (event: Event) => open && !(event.target instanceof Element && event.target.closest('.base-pop')) && placePanel()
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', placePanel)
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
      more.disconnect()
      el.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', placePanel)
    },
  }
}
