import type { App } from './app'
import type { Off } from './events'
import type { Side } from './panels'
import { basename, extname, stripExt } from './path'

interface Docked {
  /** Stays the same when the note is renamed, so the widget keeps its place. */
  id: string
  /** A file of the vault, or `view:<type>` for a tab of a plugin (the graph, the task manager). */
  path: string
  /** The tab's title, for a tab that shows no file. */
  title?: string
}

const ICON = 'M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13M6 8.5h5M6 11h5'
const PREFIX = 'note:'

/**
 * Notes shown as sidebar widgets. A tab dragged into a sidebar becomes one: the
 * note stays editable there next to whatever is open in the tabs, and can be
 * moved between sidebars like any other widget.
 */
export class DockedNotes {
  private notes: Docked[] = []
  private offs = new Map<string, Off>()
  private next = 1

  constructor(private app: App) {}

  /** Brings back the notes docked in the previous session. */
  init(): void {
    const { app } = this
    const saved = app.state.get<Docked[]>('docked', [])
    for (const note of Array.isArray(saved) ? saved : []) {
      if (typeof note?.id !== 'string' || !(String(note.path).startsWith('view:') || app.vault.get(note.path))) continue
      this.next = Math.max(this.next, Number(note.id.slice(PREFIX.length)) + 1 || 1)
      this.notes.push({ id: note.id, path: note.path, title: note.title })
      this.show(note)
    }
    // A docked note is not opened in a tab as well: two editors of one file would overwrite each other.
    app.workspace.redirect = (path) => {
      const note = this.notes.find((n) => n.path === path)
      if (note) app.panels.reveal(note.id)
      return !!note
    }
    app.vault.on('rename', (entry, oldPath) => {
      const note = this.notes.find((n) => n.path === oldPath)
      if (!note) return
      note.path = entry.path
      this.show(note)
      this.save()
    })
    app.vault.on('delete', (entry) => {
      const note = this.notes.find((n) => n.path === entry.path)
      if (note) this.undock(note.id)
    })
  }

  has(path: string): boolean {
    return this.notes.some((note) => note.path === path)
  }

  /**
   * Moves a note from the tabs into a sidebar: into the block `group` at
   * position `at`, or with `group: null` into a block of its own before `at`.
   */
  dock(path: string, side: Side, group: number | null = null, at = Infinity, title?: string): void {
    const { app } = this
    if (this.has(path)) return
    const leaf = app.workspace.leaves.find((l) => l.path === path)
    // A widget that was opened as a tab goes back to being the widget it is, not a tab inside a widget.
    const own = /^view:panel-(.+)$/.exec(path)?.[1]
    if (own && app.panels.get(own)) {
      app.panels.setHidden(own, false)
      app.panels.move(own, side, group, at)
      if (leaf) app.workspace.close(leaf, true)
      app.panels.reveal(own)
      return
    }
    const note: Docked = { id: `${PREFIX}${this.next++}`, path, title: leaf?.title ?? title }
    const place = () => {
      this.notes.push(note)
      this.show(note, side)
      app.panels.move(note.id, side, group, at)
      this.save()
    }
    // The tab's unsaved text must be on disk before the widget reads the note.
    if (leaf) void Promise.resolve(leaf.view?.flush?.()).then(() => (app.workspace.close(leaf, true), place(), app.panels.reveal(note.id)))
    else {
      place()
      app.panels.reveal(note.id)
    }
  }

  /** Takes the widget away; `open` shows the note in a tab instead. */
  undock(id: string, open = false): void {
    const note = this.notes.find((n) => n.id === id)
    if (!note) return
    this.notes = this.notes.filter((n) => n !== note)
    this.offs.get(id)?.()
    this.offs.delete(id)
    this.app.panels.forget(id)
    this.save()
    if (open && note.path.startsWith('view:')) this.app.workspace.openView(note.path.slice(5), note.title ?? '')
    else if (open) this.app.workspace.openFile(note.path, { newTab: true })
  }

  private show(note: Docked, side: Side = 'right'): void {
    const { app } = this
    this.offs.get(note.id)?.()
    const name = note.path.startsWith('view:') ? note.title || note.path.slice(5) : extname(note.path) === 'md' ? stripExt(basename(note.path)) : basename(note.path)
    const off = app.panels.add({
      id: note.id,
      title: name,
      side,
      icon: ICON,
      mount: (el) => {
        const head = el.appendChild(document.createElement('div'))
        head.className = 'docked-head'
        const title = head.appendChild(document.createElement('span'))
        title.textContent = name
        title.title = note.path
        const button = (label: string, hint: string, action: () => void) => {
          const node = head.appendChild(document.createElement('button'))
          node.textContent = label
          node.title = hint
          node.setAttribute('aria-label', hint)
          node.onclick = action
        }
        button('↗', 'Открыть во вкладке', () => this.undock(note.id, true))
        button('×', 'Убрать из боковой панели', () => this.undock(note.id))
        const body = el.appendChild(document.createElement('div'))
        body.className = 'docked-body'
        const close = app.workspace.embed(note.path, body)
        return () => {
          close()
          el.replaceChildren()
        }
      },
    })
    this.offs.set(note.id, off)
  }

  private save(): void {
    this.app.state.set('docked', this.notes)
  }
}
