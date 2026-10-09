import type { App } from './app'
import type { Off } from './events'
import type { Side } from './panels'
import { basename, extname, stripExt } from './path'

interface Docked {
  /** Stays the same when the note is renamed, so the widget keeps its place. */
  id: string
  path: string
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
      if (typeof note?.id !== 'string' || !app.vault.get(note.path)) continue
      this.next = Math.max(this.next, Number(note.id.slice(PREFIX.length)) + 1 || 1)
      this.notes.push({ id: note.id, path: note.path })
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
  dock(path: string, side: Side, group: number | null = null, at = Infinity): void {
    const { app } = this
    if (this.has(path)) return
    const leaf = app.workspace.leaves.find((l) => l.path === path)
    const note = { id: `${PREFIX}${this.next++}`, path }
    const place = () => {
      this.notes.push(note)
      this.show(note, side)
      app.panels.move(note.id, side, group, at)
      this.save()
    }
    // The tab's unsaved text must be on disk before the widget reads the note.
    if (leaf) void Promise.resolve(leaf.view?.flush?.()).then(() => (app.workspace.close(leaf), place()))
    else place()
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
    if (open) this.app.workspace.openFile(note.path, { newTab: true })
  }

  private show(note: Docked, side: Side = 'right'): void {
    const { app } = this
    this.offs.get(note.id)?.()
    const name = extname(note.path) === 'md' ? stripExt(basename(note.path)) : basename(note.path)
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
