import type { App } from './app'
import { basename, extname, stripExt } from './path'

const VIEW = 'view:'
// A vault folder with one of these names would collide with the server's own addresses.
const RESERVED = /^(api|assets)(\/|$)/

/**
 * Keeps the browser's address in step with the open note, so that every note
 * has an address of its own and the browser's Back and Forward buttons move
 * between the notes that were visited.
 *
 *   /Projects/Plan          the note Projects/Plan.md (".md" is left out)
 *   /Files/scan.pdf         any other file, with its extension
 *   /~graph                 a tab that shows no file
 */
export class Router {
  /** Set while the address itself is driving the app, so that it is not written back. */
  private following = false
  private started = false
  /** The tab the address was last written for. */
  private lastTab: number | undefined

  constructor(private app: App) {}

  /** The address of a note or view. */
  url(path: string): string {
    if (path.startsWith(VIEW)) return `/~${encodeURIComponent(path.slice(VIEW.length))}`
    const shown = extname(path) === 'md' ? path.slice(0, -3) : path
    return `/${RESERVED.test(shown) ? '-/' : ''}${shown.split('/').map(encodeURIComponent).join('/')}`
  }

  /** The note or view an address stands for, if it exists. */
  private resolve(pathname: string): string | null {
    let path: string
    try {
      path = decodeURIComponent(pathname).replace(/^\/(-\/)?/, '')
    } catch {
      return null
    }
    if (!path) return null
    if (path.startsWith('~')) return VIEW + path.slice(1)
    const { vault } = this.app
    return [path, `${path}.md`].find((candidate) => vault.get(candidate)?.kind === 'file') ?? null
  }

  start(): void {
    const { workspace } = this.app
    this.open(location.pathname)
    this.started = true
    this.write()

    workspace.on('active-change', () => this.write())
    workspace.on('layout-change', () => this.write())
    window.addEventListener('popstate', () => {
      this.open(location.pathname)
      this.lastTab = workspace.active?.id
      this.setTitle()
    })
  }

  private open(pathname: string): void {
    const { workspace } = this.app
    const path = this.resolve(pathname)
    this.following = true
    try {
      if (!path) return
      if (path.startsWith(VIEW)) workspace.openView(path.slice(VIEW.length), workspace.leaves.find((leaf) => leaf.path === path)?.title ?? '')
      else workspace.openFile(path)
    } finally {
      this.following = false
    }
  }

  /**
   * Puts the open note into the address bar. Moving to another tab is a new
   * step in history; the same tab getting another address (its note was
   * renamed) only corrects the current step.
   */
  private write(): void {
    if (this.following || !this.started) return
    const active = this.app.workspace.active
    const moved = this.lastTab !== undefined && active?.id !== this.lastTab
    this.lastTab = active?.id
    const url = active ? this.url(active.path) : '/'
    this.setTitle()
    if (url === location.pathname) return
    if (moved) history.pushState(null, '', url)
    else history.replaceState(null, '', url)
  }

  private setTitle(): void {
    const active = this.app.workspace.active
    const name = active ? (active.title ?? stripExt(basename(active.path))) : ''
    document.title = name ? `${name} — FlintNotes` : 'FlintNotes'
  }
}
