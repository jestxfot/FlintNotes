import type { App } from './app'
import type { Off } from './events'
import type { Side } from './panels'
import { basename, extname, stripExt } from './path'

interface Item {
  id: string
  side: Side
  /** What the button shows: `view:panel-<id>` a widget, `view:<type>` a plugin's tab, or a file of the vault. */
  path: string
  title: string
}

/** Icons for what is known by name; anything else gets a plain one. */
const ICONS: Record<string, string> = {
  'panel-files': 'folder',
  'panel-search': 'search',
  'panel-tags': 'tags',
  'panel-calendar': 'calendar',
  'panel-outline': 'list',
  'panel-backlinks': 'link',
  'panel-tasks': 'list-checks',
  'panel-reminders': 'bell',
  'panel-day-planner': 'clock',
  graph: 'git-fork',
  'tasks-manager': 'list-todo',
  home: 'house',
}

/**
 * Buttons on the strips along the edges of the window that the user makes by
 * dragging: a tab (of a plugin or of a note) or a widget's icon dropped on a
 * strip becomes a button there. The button shows the thing where it belongs
 * without making a tab for it: a widget in its sidebar, a plugin's tab as a
 * widget of the sidebar on that side, a note in the tabs.
 */
export class RibbonItems {
  private items: Item[] = []
  private offs = new Map<string, Off>()

  constructor(private app: App) {}

  init(): void {
    const saved = this.app.state.get<Item[]>('ribbon-items', [])
    this.items = (Array.isArray(saved) ? saved : []).filter((item) => typeof item?.id === 'string' && typeof item.path === 'string')
    for (const item of this.items) this.show(item)
    this.app.menus.register('toolbar', (target: { button?: string }, add) => {
      const item = this.items.find((one) => one.id === target?.button)
      if (item) add({ icon: 'x', title: 'Убрать кнопку', onClick: () => this.remove(item.id) })
    })
  }

  /** Makes a button for a tab or a widget on the strip of `side`, and shows the thing in its place at once. */
  add(path: string, side: Side, title?: string): void {
    const { app } = this
    const leaf = app.workspace.leaves.find((one) => one.path === path)
    const panel = /^view:panel-(.+)$/.exec(path)?.[1]
    const name = title ?? leaf?.title ?? (panel ? app.panels.get(panel)?.title : undefined) ?? (path.startsWith('view:') ? path.slice(5) : extname(path) === 'md' ? stripExt(basename(path)) : basename(path))
    let item = this.items.find((one) => one.path === path && one.side === side)
    if (!item) {
      item = { id: `ribbon-item:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, side, path, title: name }
      this.items.push(item)
      this.save()
      this.show(item)
    }
    // A plugin's tab that became a button does not stay a tab as well.
    if (path.startsWith('view:')) this.activate(item)
  }

  remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id)
    this.offs.get(id)?.()
    this.offs.delete(id)
    this.save()
  }

  private save(): void {
    this.app.state.set('ribbon-items', this.items)
  }

  private show(item: Item): void {
    const { app } = this
    const look = item.path.startsWith('view:') ? undefined : app.icons.look('file', item.path)
    const icon = look?.icon ?? (item.path.startsWith('view:') ? (ICONS[item.path.slice(5)] ?? 'panel-left') : 'file-text')
    this.offs.set(
      item.id,
      app.toolbars.add(item.side === 'left' ? 'left-ribbon' : 'right-ribbon', { id: item.id, icon, title: item.title, color: look?.color, onClick: () => this.activate(item) }),
    )
  }

  /** Shows what the button stands for. */
  private activate(item: Item): void {
    const { app } = this
    const panel = /^view:panel-(.+)$/.exec(item.path)?.[1]
    if (panel) {
      if (!app.panels.get(panel)) return app.notice(`Панель «${item.title}» сейчас недоступна: её плагин выключен`)
      const leaf = app.workspace.leaves.find((one) => one.path === item.path)
      if (leaf) app.workspace.close(leaf, true)
      app.panels.setHidden(panel, false)
      app.panels.reveal(panel)
    } else if (item.path.startsWith('view:')) {
      // In the sidebar on the button's side, as a widget; it is put there the first time and found there afterwards.
      if (!app.docked.has(item.path)) app.docked.dock(item.path, item.side, null, Infinity, item.title)
      else app.workspace.openView(item.path.slice(5), item.title)
    } else if (app.vault.get(item.path)) app.workspace.openFile(item.path)
    else app.notice(`Файла «${item.title}» больше нет`)
  }
}
