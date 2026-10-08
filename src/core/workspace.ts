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
const STORAGE_KEY = 'flint:tabs'

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

  private views = new Map<string, ViewCreator>()
  private extensions = new Map<string, string>()
  private nextId = 1

  constructor(private app: App) {
    super()
    this.containerEl.className = 'workspace'
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
    })
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
   * Opens the file in a tab, or switches to its tab. `focus: false` leaves the
   * keyboard focus alone; `line` scrolls to a zero-based line.
   */
  openFile(path: string, { focus = true, line }: { focus?: boolean; line?: number } = {}): void {
    const leaf = this.open(path, undefined, focus)
    if (line !== undefined) void leaf.ready.then(() => leaf.view?.revealLine?.(line))
  }

  /** Opens a tab of a registered view type that shows no file, such as the graph. */
  openView(type: string, title: string): void {
    this.open(VIEW_PREFIX + type, title, true)
  }

  private open(path: string, title: string | undefined, focus: boolean): Leaf & { ready: Promise<void> } {
    const existing = this.leaves.find((leaf) => leaf.path === path)
    if (existing) {
      this.setActive(existing)
      return Object.assign(existing, { ready: Promise.resolve() })
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
    for (const l of this.leaves) l.el.hidden = l !== leaf
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
    await Promise.all(this.leaves.map((leaf) => leaf.view?.flush?.(unloading)))
  }

  /** Reopens the tabs of the previous session. */
  restore(): void {
    try {
      const { tabs, active } = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      for (const { path, title } of tabs ?? []) {
        if (path.startsWith(VIEW_PREFIX) || this.app.vault.get(path)) this.open(path, title, true)
      }
      const leaf = this.leaves.find((l) => l.path === active)
      if (leaf) this.setActive(leaf)
    } catch {
      // Remembered tabs are a convenience; start empty without them.
    }
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

  private async mount(leaf: Leaf, focus = false): Promise<void> {
    leaf.view?.destroy()
    leaf.view = null
    leaf.el.replaceChildren()
    const type = (leaf.viewType = this.viewTypeFor(leaf.path))
    const creator = this.views.get(type) ?? unsupportedView
    let view: FileView
    try {
      view = await creator({ app: this.app, path: leaf.path, containerEl: leaf.el })
    } catch (err) {
      leaf.el.innerHTML = '<div class="leaf-message"></div>'
      leaf.el.firstElementChild!.textContent = `Не удалось открыть файл: ${errorMessage(err)}`
      return
    }
    // The tab may have been closed or switched to another view while this one loaded.
    if (!this.leaves.includes(leaf) || leaf.viewType !== type || leaf.view) {
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
    try {
      const state = { tabs: this.leaves.map(({ path, title }) => ({ path, title })), active: this.active?.path }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Storage can be unavailable (private window); tabs just won't be remembered.
    }
  }
}
