import { errorMessage, path as paths, Plugin, ServerDown, type VaultEntry } from '../../api'
import './style.css'

type PatternType = 'STRICT' | 'WILDCARD' | 'REGEX'
interface PathFilter {
  name: string
  active: boolean
  type: 'FILES' | 'DIRECTORIES' | 'FILES_AND_DIRECTORIES'
  pattern: string
  patternType: PatternType
}
interface TagFilter {
  name: string
  active: boolean
  pattern: string
  patternType: PatternType
}
interface Filters {
  active: boolean
  tags: TagFilter[]
  paths: PathFilter[]
  frontMatter?: unknown[]
}
/** The data of the File Explorer++ plugin; what this plugin does not use is kept as it is. */
interface Data extends Record<string, unknown> {
  hideStrictPathFilters?: boolean
  pinFilters: Filters
  hideFilters: Filters
}
type Kind = 'pinFilters' | 'hideFilters'

const empty = (): Filters => ({ active: true, tags: [], paths: [] })

function matcher(pattern: string, type: PatternType): (text: string) => boolean {
  if (!pattern) return () => false
  if (type === 'STRICT') return (text) => text === pattern
  try {
    // A wildcard: `*` stands for any run of characters, the rest is as written.
    const regex = type === 'REGEX' ? new RegExp(pattern) : new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
    return (text) => regex.test(text)
  } catch {
    return () => false
  }
}

/**
 * Hides and pins files and folders in the list of files, as the File Explorer++
 * plugin for Obsidian does, and from the same data: filters on the path or
 * name (exact, wildcard or regular expression) and on the tags of a note.
 * Pinned entries stand first in their folder; hidden ones are not listed.
 */
export default class ExplorerPlus extends Plugin {
  private data: Data = { pinFilters: empty(), hideFilters: empty() }
  private raw = ''
  /** Answers already worked out, by kind and path; thrown away when the filters or the notes change. */
  private cache = new Map<string, boolean>()
  private redraw: (() => void) | null = null

  private get file(): string {
    return `${this.app.obsidianConfig ?? '.obsidian'}/plugins/file-explorer-plus/data.json`
  }

  async onload() {
    const { app } = this
    await this.read()
    const changed = () => {
      this.cache.clear()
      app.explorer.refresh()
      this.redraw?.()
    }
    this.addSettings([
      { key: 'hide', section: 'Скрытые', name: 'Что скрывать в списке файлов', desc: 'Путь или имя файла либо папки. Шаблон: * — любые символы (например *.canvas или attachments). Скрытое остаётся в хранилище и находится поиском', type: 'custom', render: (el) => this.editor(el, 'hideFilters', changed) },
      { key: 'pin', section: 'Закреплённые', name: 'Что закреплять наверху своей папки', type: 'custom', render: (el) => this.editor(el, 'pinFilters', changed) },
    ])

    this.register(app.explorer.hide((entry) => this.matches('hideFilters', entry)))
    this.register(app.explorer.pin((entry) => this.matches('pinFilters', entry)))
    this.register(app.explorer.decorate((entry) => (this.matches('pinFilters', entry) ? 'xp-pinned' : undefined)))
    // Tags decide too, and they change with the notes.
    let later: ReturnType<typeof setTimeout> | undefined
    this.register(
      app.metadata.on('resolved', () => {
        if (![...this.data.hideFilters.tags, ...this.data.pinFilters.tags].some((filter) => filter.active && filter.pattern)) return
        clearTimeout(later)
        later = setTimeout(changed, 800)
      }),
    )
    this.register(() => clearTimeout(later))
    for (const event of ['create', 'delete', 'rename'] as const) this.register(app.vault.on(event, () => this.cache.clear()))
    const onFocus = () => void this.read().then((fresh) => fresh && changed())
    window.addEventListener('focus', onFocus)
    this.register(() => window.removeEventListener('focus', onFocus))

    /** Adds or removes the exact filter for one entry. */
    const toggle = async (kind: Kind, entry: VaultEntry) => {
      await this.read()
      const list = this.data[kind].paths
      const at = list.findIndex((filter) => filter.patternType === 'STRICT' && filter.pattern === entry.path)
      if (at >= 0) list.splice(at, 1)
      else list.push({ name: '', active: true, type: entry.kind === 'folder' ? 'DIRECTORIES' : 'FILES', pattern: entry.path, patternType: 'STRICT' })
      this.data[kind].active = true
      await this.save()
      changed()
    }
    this.registerMenu('file', (entry: VaultEntry | null, add) => {
      if (!entry) return
      const pinned = this.matches('pinFilters', entry)
      add({ icon: pinned ? 'pin-off' : 'pin', title: pinned ? 'Открепить' : 'Закрепить наверху', command: 'explorer-plus:pin-active', onClick: () => void toggle('pinFilters', entry) })
      add({ icon: 'eye-off', title: 'Скрыть в списке файлов', command: 'explorer-plus:hide-active', onClick: () => void toggle('hideFilters', entry) })
    })

    const flip = (kind: Kind, name: string) => async () => {
      await this.read()
      this.data[kind].active = !this.data[kind].active
      await this.save()
      changed()
      app.notice(`${name}: ${this.data[kind].active ? 'включено' : 'выключено'}`)
    }
    this.addCommand({ id: 'toggle-hide', name: 'Показать или скрыть скрытые файлы', icon: 'eye', scope: 'sidebar', callback: () => void flip('hideFilters', 'Скрытие файлов')() })
    this.addCommand({ id: 'toggle-pin', name: 'Включить или выключить закрепление файлов', icon: 'pin', scope: 'sidebar', callback: () => void flip('pinFilters', 'Закрепление файлов')() })
    const active = (kind: Kind) => () => {
      const path = app.workspace.active?.path
      const entry = path && !path.startsWith('view:') ? app.vault.get(path) : null
      if (entry) void toggle(kind, entry)
    }
    this.addCommand({ id: 'pin-active', name: 'Закрепить или открепить эту заметку в списке файлов', icon: 'pin', scope: 'note', callback: active('pinFilters') })
    this.addCommand({ id: 'hide-active', name: 'Скрыть эту заметку в списке файлов', icon: 'eye-off', scope: 'note', callback: active('hideFilters') })
  }

  private matches(kind: Kind, entry: VaultEntry): boolean {
    const filters = this.data[kind]
    if (!filters?.active) return false
    const key = `${kind}\n${entry.path}`
    const known = this.cache.get(key)
    if (known !== undefined) return known
    const name = paths.basename(entry.path)
    let result = filters.paths.some((filter) => {
      if (!filter.active || !filter.pattern) return false
      if (filter.type === 'FILES' && entry.kind !== 'file') return false
      if (filter.type === 'DIRECTORIES' && entry.kind !== 'folder') return false
      const test = matcher(filter.pattern, filter.patternType)
      // A pattern with no slash in it is about the name; with one, about the whole path. A note may be named without `.md`.
      return filter.pattern.includes('/') ? test(entry.path) || test(entry.path.replace(/\.md$/, '')) : test(name) || test(name.replace(/\.md$/, '')) || test(entry.path)
    })
    if (!result && entry.kind === 'file') {
      const tags = this.app.metadata.get(entry.path)?.tags ?? []
      result = tags.length > 0 && filters.tags.some((filter) => filter.active && !!filter.pattern && tags.some(matcher(filter.pattern.replace(/^#/, ''), filter.patternType)))
    }
    this.cache.set(key, result)
    return result
  }

  /** The list of filters of one kind, in the settings. */
  private editor(el: HTMLElement, kind: Kind, changed: () => void): () => void {
    const box = el.appendChild(document.createElement('div'))
    box.className = 'xp-filters'
    const commit = () => void this.save().then(changed)
    const draw = () => {
      box.replaceChildren()
      const filters = this.data[kind]
      const on = box.appendChild(document.createElement('label'))
      on.className = 'xp-filter'
      const all = on.appendChild(document.createElement('input'))
      all.type = 'checkbox'
      all.checked = filters.active
      all.onchange = () => ((filters.active = all.checked), commit())
      on.append(kind === 'hideFilters' ? ' Скрытие включено' : ' Закрепление включено')
      const row = <T extends PathFilter | TagFilter>(list: T[], filter: T, tag: boolean) => {
        const line = box.appendChild(document.createElement('div'))
        line.className = 'xp-filter'
        const active = line.appendChild(document.createElement('input'))
        active.type = 'checkbox'
        active.checked = filter.active
        active.title = 'Фильтр действует'
        active.onchange = () => ((filter.active = active.checked), commit())
        const pattern = line.appendChild(document.createElement('input'))
        pattern.type = 'text'
        pattern.value = filter.pattern
        pattern.placeholder = tag ? 'тег, например archive' : 'имя или путь, например attachments или *.canvas'
        pattern.onchange = () => ((filter.pattern = pattern.value.trim()), commit())
        if (!tag) {
          const what = line.appendChild(document.createElement('select'))
          for (const [value, label] of [['FILES_AND_DIRECTORIES', 'файлы и папки'], ['FILES', 'файлы'], ['DIRECTORIES', 'папки']]) what.add(new Option(label, value))
          what.value = (filter as PathFilter).type
          what.onchange = () => (((filter as PathFilter).type = what.value as PathFilter['type']), commit())
        } else line.append('тег')
        const how = line.appendChild(document.createElement('select'))
        for (const [value, label] of [['STRICT', 'точно'], ['WILDCARD', 'шаблон *'], ['REGEX', 'выражение']]) how.add(new Option(label, value))
        how.value = filter.patternType
        how.onchange = () => ((filter.patternType = how.value as PatternType), commit())
        const remove = line.appendChild(document.createElement('button'))
        remove.textContent = '×'
        remove.title = 'Убрать фильтр'
        remove.onclick = () => (list.splice(list.indexOf(filter), 1), commit())
      }
      // Empty rows that File Explorer++ keeps as placeholders are not shown.
      const shownPaths = filters.paths.filter((filter) => filter.pattern)
      const shownTags = filters.tags.filter((filter) => filter.pattern)
      for (const filter of shownPaths) row(filters.paths, filter, false)
      for (const filter of shownTags) row(filters.tags, filter, true)
      if (!shownPaths.length && !shownTags.length) Object.assign(box.appendChild(document.createElement('div')), { className: 'xp-none', textContent: 'Фильтров нет. Их можно добавить и правым щелчком по файлу или папке' })
      const add = (label: string, make: () => void) => {
        const button = box.appendChild(document.createElement('button'))
        button.className = 'xp-add'
        button.textContent = label
        button.onclick = () => {
          make()
          draw()
          box.querySelector<HTMLInputElement>('.xp-filter:last-of-type input[type=text]')?.focus()
        }
      }
      add('+ По имени или пути', () => {
        filters.paths.push({ name: '', active: true, type: 'FILES_AND_DIRECTORIES', pattern: ' ', patternType: 'WILDCARD' })
        filters.paths[filters.paths.length - 1].pattern = '*'
      })
      add('+ По тегу', () => filters.tags.push({ name: '', active: true, pattern: 'tag', patternType: 'STRICT' }))
    }
    draw()
    this.redraw = draw
    return () => {
      if (this.redraw === draw) this.redraw = null
      box.remove()
    }
  }

  /** Reads the data again; `true` if it has changed since the last reading. */
  private async read(): Promise<boolean> {
    try {
      const text = (await this.app.vault.readOptional(this.file)) ?? ''
      if (text === this.raw) return false
      this.raw = text
      const parsed = text.trim() ? (JSON.parse(text) as Partial<Data>) : {}
      const filters = (value: Filters | undefined): Filters => ({ ...empty(), ...value, tags: [...(value?.tags ?? [])], paths: [...(value?.paths ?? [])] })
      this.data = { ...parsed, pinFilters: filters(parsed.pinFilters), hideFilters: filters(parsed.hideFilters) }
      this.cache.clear()
      return true
    } catch (err) {
      if (!(err instanceof ServerDown)) this.app.notice(`Проводник++: не удалось прочитать ${this.file}: ${errorMessage(err)}`)
      return false
    }
  }

  private async save(): Promise<void> {
    try {
      this.raw = JSON.stringify(this.data, null, 2)
      await this.app.vault.write(this.file, this.raw)
    } catch (err) {
      this.app.notice(`Проводник++: не удалось сохранить: ${errorMessage(err)}`)
    }
  }
}
