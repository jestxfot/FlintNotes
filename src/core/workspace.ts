import type { EditorView } from '@codemirror/view'
import type { App } from './app'
import { Events, type Off } from './events'
import { errorMessage } from './notice'
import { extname } from './path'

/** What a view of one open file must provide. Everything but `destroy` is optional. */
export interface FileView {
  /** Set by views built on the text editor, so plugins can reach it. */
  editor?: EditorView
  /** The file changed on disk. */
  onExternalChange?(): void
  onRename?(path: string): void
  /** Scroll to a zero-based line and put the cursor there. */
  revealLine?(line: number): void
  /** Write unsaved changes now. `unloading` means the page is closing. */
  flush?(unloading?: boolean): void | Promise<void>
  focus?(): void
  destroy(): void
}

export interface ViewContext {
  app: App
  path: string
  containerEl: HTMLElement
}

export type ViewCreator = (context: ViewContext) => FileView | Promise<FileView>

/** One tab: a file shown by the view registered for its extension. */
export interface Leaf {
  id: number
  /** Vault path of the file, or `view:<type>` for a tab that shows no file (the graph). */
  path: string
  /** Tab title for tabs that show no file. */
  title?: string
  viewType: string
  el: HTMLElement
  view: FileView | null
}

type WorkspaceEvents = {
  /** Tabs were opened, closed or renamed. */
  'layout-change': []
  /** Another tab became active, or the active tab's view finished loading. */
  'active-change': [leaf: Leaf | null]
}

const FALLBACK = 'unsupported'

const VIEW_PREFIX = 'view:'

const unsupportedView: ViewCreator = ({ path, containerEl }) => {
  const message = document.createElement('div')
  message.className = 'leaf-message'
  message.textContent = path.startsWith(VIEW_PREFIX)
    ? 'Плагин этой вкладки выключен'
    : `Нет включённого плагина для просмотра файлов .${extname(path) || '?'}`
  containerEl.append(message)
  return { destroy: () => message.remove() }
}

export class Workspace extends Events<WorkspaceEvents> {
  readonly containerEl = document.createElement('div')
  leaves: Leaf[] = []
  active: Leaf | null = null

  /** The tab whose content is on screen; lags behind `active` while that one loads. */
  private shown: Leaf | null = null
  private mounting = new Set<Leaf>()
  private views = new Map<string, ViewCreator>()
  private extensions = new Map<string, string>()
  private nextId = 1
  /** Views that are shown outside the tabs: notes docked in a sidebar. */
  private embedded = new Set<{ path: string; view: FileView | null }>()
  /** Lets someone else show a file instead of a tab; returns `true` if it did. */
  redirect: ((path: string) => boolean) | null = null
  /** Whether the click or Enter being handled right now asks for a new tab (Ctrl or the middle button). */
  private aside = false

  constructor(private app: App) {
    super()
    this.containerEl.className = 'workspace'
    // Every list, link and menu opens notes through `openFile`, so the modifier
    // is read here once instead of in each of them.
    const note = (event: Event) => {
      const { ctrlKey, metaKey } = event as MouseEvent
      this.aside = ctrlKey || metaKey || (event.type === 'auxclick' && (event as MouseEvent).button === 1)
      setTimeout(() => (this.aside = false))
    }
    for (const type of ['click', 'auxclick']) window.addEventListener(type, note, true)
    window.addEventListener('keydown', (event) => event.key === 'Enter' && note(event), true)
    app.vault.on('rename', (entry, oldPath) => {
      for (const leaf of this.leaves.filter((l) => l.path === oldPath)) {
        leaf.path = entry.path
        leaf.view?.onRename?.(entry.path)
        this.changed()
      }
    })
    app.vault.on('delete', (entry) => {
      this.leaves.filter((l) => l.path === entry.path).forEach((leaf) => this.close(leaf))
    })
    app.vault.on('modify', (entry) => {
      this.leaves.filter((l) => l.path === entry.path).forEach((leaf) => leaf.view?.onExternalChange?.())
      for (const shown of this.embedded) if (shown.path === entry.path) shown.view?.onExternalChange?.()
    })
  }

  /**
   * Shows a file inside `containerEl`, outside the tabs, with the view registered
   * for its type. The returned function saves what was typed and takes the view away.
   */
  embed(path: string, containerEl: HTMLElement): Off {
    const shown: { path: string; view: FileView | null } = { path, view: null }
    let closed = false
    this.embedded.add(shown)
    const creator = this.views.get(this.viewTypeFor(path)) ?? unsupportedView
    void Promise.resolve(creator({ app: this.app, path, containerEl })).then(
      (view) => (closed ? view.destroy() : (shown.view = view)),
      (err) => (containerEl.textContent = `Не удалось открыть файл: ${errorMessage(err)}`),
    )
    return () => {
      closed = true
      this.embedded.delete(shown)
      void Promise.resolve(shown.view?.flush?.()).then(() => shown.view?.destroy())
    }
  }

  /** The text editor of the active tab, if that tab shows one. */
  get activeEditor(): EditorView | null {
    return this.active?.view?.editor ?? null
  }

  /**
   * Registers a view type and the file extensions it opens. Open tabs switch to
   * it right away, and fall back again when the registration is undone.
   */
  registerView(type: string, creator: ViewCreator, extensions: string[]): Off {
    this.views.set(type, creator)
    for (const ext of extensions) this.extensions.set(ext, type)
    this.remountStale()
    return () => {
      this.views.delete(type)
      for (const ext of extensions) if (this.extensions.get(ext) === type) this.extensions.delete(ext)
      this.remountStale()
    }
  }

  /**
   * Opens the file, or switches to its tab if it is open already. It takes the
   * place of the note in the current tab, unless the user holds Ctrl, the
   * "reuse the tab" setting is off, or `newTab` says otherwise. `focus: false`
   * leaves the keyboard focus alone; `line` scrolls to a zero-based line.
   */
  openFile(path: string, { focus = true, line, newTab }: { focus?: boolean; line?: number; newTab?: boolean } = {}): void {
    if (this.redirect?.(path)) return
    const reuse = !(newTab ?? (this.aside || !this.app.settings.get<boolean>('core', 'reuseTab')))
    const leaf = this.open(path, undefined, focus, reuse)
    if (line !== undefined) void leaf.ready.then(() => leaf.view?.revealLine?.(line))
  }

  /** Opens a tab of a registered view type that shows no file, such as the graph. */
  openView(type: string, title: string): void {
    this.open(VIEW_PREFIX + type, title, true)
  }

  private open(path: string, title: string | undefined, focus: boolean, reuse = false): Leaf & { ready: Promise<void> } {
    const existing = this.leaves.find((leaf) => leaf.path === path)
    if (existing) {
      this.setActive(existing)
      return Object.assign(existing, { ready: Promise.resolve() })
    }
    const current = this.active
    if (reuse && current && !current.path.startsWith(VIEW_PREFIX)) {
      void current.view?.flush?.()
      current.path = path
      // It counts as another tab from here on, so that going to a note is a step in the browser's history.
      current.id = this.nextId++
      const ready = this.mount(current, focus)
      this.changed()
      return Object.assign(current, { ready })
    }
    const el = document.createElement('div')
    el.className = 'leaf'
    this.containerEl.append(el)
    const leaf: Leaf = { id: this.nextId++, path, title, viewType: '', el, view: null }
    this.leaves.push(leaf)
    this.setActive(leaf)
    return Object.assign(leaf, { ready: this.mount(leaf, focus) })
  }

  setActive(leaf: Leaf | null): void {
    this.active = leaf
    this.show()
    leaf?.view?.focus?.()
    this.changed()
    this.trigger('active-change', leaf)
  }

  close(leaf: Leaf): void {
    const index = this.leaves.indexOf(leaf)
    if (index < 0) return
    leaf.view?.destroy()
    leaf.view = null
    leaf.el.remove()
    this.leaves.splice(index, 1)
    if (this.active === leaf) this.setActive(this.leaves[index] ?? this.leaves[index - 1] ?? null)
    else this.changed()
  }

  /** Writes unsaved changes of every tab. */
  async flushAll(unloading = false): Promise<void> {
    await Promise.all([...this.leaves, ...this.embedded].map((shown) => shown.view?.flush?.(unloading)))
  }

  /** Reopens the tabs of the previous session. */
  restore(): void {
    const { tabs, active } = this.app.state.get<{ tabs?: { path: string; title?: string }[]; active?: string }>('tabs', {})
    for (const { path, title } of tabs ?? []) {
      if (path.startsWith(VIEW_PREFIX) || this.app.vault.get(path)) this.open(path, title, true)
    }
    const leaf = this.leaves.find((l) => l.path === active)
    if (leaf) this.setActive(leaf)
  }

  private viewTypeFor(path: string): string {
    if (!path.startsWith(VIEW_PREFIX)) return this.extensions.get(extname(path)) ?? FALLBACK
    const type = path.slice(VIEW_PREFIX.length)
    return this.views.has(type) ? type : FALLBACK
  }

  private remountStale(): void {
    for (const leaf of this.leaves) {
      if (leaf.viewType !== this.viewTypeFor(leaf.path)) void this.mount(leaf)
    }
  }

  /**
   * Puts the active tab on screen. While it is still loading, the tab that was
   * shown before stays, so switching never flashes an empty page.
   */
  private show(): void {
    const { active, shown } = this
    const waiting = active && this.mounting.has(active) && shown && shown !== active && this.leaves.includes(shown)
    this.shown = waiting ? shown : active
    for (const leaf of this.leaves) leaf.el.hidden = leaf !== this.shown
  }

  private async mount(leaf: Leaf, focus = false): Promise<void> {
    leaf.view?.destroy()
    leaf.view = null
    leaf.el.replaceChildren()
    const path = leaf.path
    const type = (leaf.viewType = this.viewTypeFor(path))
    const creator = this.views.get(type) ?? unsupportedView
    let view: FileView
    this.mounting.add(leaf)
    this.show()
    try {
      view = await creator({ app: this.app, path: leaf.path, containerEl: leaf.el })
    } catch (err) {
      leaf.el.innerHTML = '<div class="leaf-message"></div>'
      leaf.el.firstElementChild!.textContent = `Не удалось открыть файл: ${errorMessage(err)}`
      return
    } finally {
      this.mounting.delete(leaf)
      this.show()
    }
    // The tab may have been closed, or given another view or note, while this one loaded.
    if (!this.leaves.includes(leaf) || leaf.viewType !== type || leaf.path !== path || leaf.view) {
      view.destroy()
      return
    }
    leaf.view = view
    if (leaf === this.active) {
      if (focus) view.focus?.()
      this.trigger('active-change', leaf)
    }
  }

  private changed(): void {
    this.trigger('layout-change')
    this.app.state.set('tabs', { tabs: this.leaves.map(({ path, title }) => ({ path, title })), active: this.active?.path })
  }
}
