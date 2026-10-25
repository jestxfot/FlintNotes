import type { VaultEntry } from '../shared/protocol'

interface Tree {
  entries: Map<string, VaultEntry>
  /** When the walk that made it began; 0 for a list kept from the last run, not yet checked against the disk. */
  at: number
}

/** Where the lists of the vaults are kept between runs of the server. */
export interface TreeStore {
  read(dir: string): Promise<VaultEntry[] | null>
  write(dir: string, entries: VaultEntry[]): Promise<void>
}

/** What a check of a kept list against the disk found: files that came or changed, and files that are gone. */
export type TreeChange = { type: 'upsert'; entry: VaultEntry } | { type: 'delete'; path: string }

const same = (a: VaultEntry, b: VaultEntry) => a.kind === b.kind && a.size === b.size && a.mtime === b.mtime

/**
 * The list of a vault's files and folders, kept in memory. Walking a large
 * vault takes seconds (thousands of folders and files to look at), and the app
 * asks for the list at every start, twice: for the files and for the notes.
 * Once the folder is watched, the watcher's events keep the list current, and
 * it is walked again only now and then, in the background, in case an event was
 * missed.
 *
 * The list is also kept on disk (`store`): a server that starts again serves the
 * list of the last run at once, and walks the vault in the background a moment
 * later. What that walk finds different from it reaches the pages as changes
 * (`changed`), as if the watcher had seen them.
 */
export class TreeCache {
  private trees = new Map<string, Tree>()
  /** Vaults whose watcher has finished its first look: only their lists are trusted. */
  private watched = new Set<string>()
  /** Walks under way, so that two requests at once share one. */
  private walking = new Map<string, Promise<VaultEntry[]>>()
  /** Paths the watcher reported while a walk was under way: for them the watcher's word is newer than the walk's. */
  private touched = new Map<string, Set<string>>()
  private reading = new Map<string, Promise<VaultEntry[] | null>>()
  private saving = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private walk: (dir: string) => Promise<VaultEntry[]>,
    private maxAge = 10 * 60_000,
    private store: TreeStore | null = null,
    private changed: (dir: string, change: TreeChange) => void = () => {},
    /** How long a server that has just started waits before it checks a kept list: the page's own first requests go first. */
    private settle = 1500,
  ) {}

  async list(dir: string): Promise<VaultEntry[]> {
    let tree = this.trees.get(dir)
    if (!tree && this.store) {
      if (!this.reading.has(dir)) this.reading.set(dir, this.store.read(dir).catch(() => null))
      const kept = await this.reading.get(dir)!
      tree = this.trees.get(dir)
      if (!tree && kept) {
        this.trees.set(dir, (tree = { entries: new Map(kept.map((entry) => [entry.path, entry])), at: 0 }))
        setTimeout(() => void this.load(dir).catch(() => {}), this.settle)
      }
    }
    if (!tree || (!this.watched.has(dir) && tree.at)) return this.load(dir)
    if (tree.at && Date.now() - tree.at > this.maxAge) void this.load(dir).catch(() => {})
    return [...tree.entries.values()]
  }

  private load(dir: string): Promise<VaultEntry[]> {
    const running = this.walking.get(dir)
    if (running) return running
    const at = Date.now()
    const touched = new Set<string>()
    this.touched.set(dir, touched)
    const walk = this.walk(dir)
      .then((entries) => {
        const tree = this.trees.get(dir)
        if (tree) this.merge(dir, tree, entries, touched)
        // A change that came while walking may or may not be in the result: then the next request walks again.
        else if (!touched.size) this.trees.set(dir, { entries: new Map(entries.map((entry) => [entry.path, entry])), at })
        else return entries
        this.trees.get(dir)!.at = at
        this.keep(dir, 0)
        return [...this.trees.get(dir)!.entries.values()]
      })
      .finally(() => {
        this.walking.delete(dir)
        this.touched.delete(dir)
      })
    this.walking.set(dir, walk)
    return walk
  }

  /** Puts what a walk found into the list, telling what differs; what the watcher reported meanwhile stays as it said. */
  private merge(dir: string, tree: Tree, found: VaultEntry[], touched: Set<string>): void {
    const isTouched = (path: string) => {
      for (let at = path.length; at > 0; at = path.lastIndexOf('/', at - 1)) if (touched.has(path.slice(0, at))) return true
      return false
    }
    const seen = new Set<string>()
    for (const entry of found) {
      seen.add(entry.path)
      if (isTouched(entry.path)) continue
      const known = tree.entries.get(entry.path)
      if (known && same(known, entry)) continue
      tree.entries.set(entry.path, entry)
      this.changed(dir, { type: 'upsert', entry })
    }
    for (const path of [...tree.entries.keys()]) {
      if (seen.has(path) || isTouched(path)) continue
      tree.entries.delete(path)
      this.changed(dir, { type: 'delete', path })
    }
  }

  /** Writes the list down a while after it last changed, so that a burst of changes is written once. */
  private keep(dir: string, delay = 30_000): void {
    if (!this.store) return
    clearTimeout(this.saving.get(dir))
    this.saving.set(
      dir,
      setTimeout(() => {
        this.saving.delete(dir)
        const tree = this.trees.get(dir)
        if (tree) void this.store!.write(dir, [...tree.entries.values()]).catch(() => {})
      }, delay),
    )
  }

  /** Writes down at once the lists that changed since they were last written (the server is stopping). */
  async flush(): Promise<void> {
    const dirs = [...this.saving.keys()]
    for (const dir of dirs) clearTimeout(this.saving.get(dir))
    this.saving.clear()
    await Promise.all(dirs.map((dir) => this.trees.get(dir) && this.store?.write(dir, [...this.trees.get(dir)!.entries.values()]).catch(() => {})))
  }

  private seen(dir: string, path: string): void {
    this.touched.get(dir)?.add(path)
    if (this.trees.has(dir)) this.keep(dir)
  }

  /** The watcher of the vault has looked at everything once; from now on its events keep the list. */
  ready(dir: string): void {
    this.watched.add(dir)
  }

  upsert(dir: string, entry: VaultEntry): void {
    this.seen(dir, entry.path)
    this.trees.get(dir)?.entries.set(entry.path, entry)
  }

  /** A file, or a folder with everything in it, is gone. */
  remove(dir: string, path: string): void {
    this.seen(dir, path)
    const entries = this.trees.get(dir)?.entries
    if (!entries) return
    entries.delete(path)
    for (const key of [...entries.keys()]) if (key.startsWith(`${path}/`)) entries.delete(key)
  }

  /** The vault is no longer watched. */
  forget(dir: string): void {
    this.trees.delete(dir)
    this.watched.delete(dir)
    clearTimeout(this.saving.get(dir))
    this.saving.delete(dir)
  }
}
