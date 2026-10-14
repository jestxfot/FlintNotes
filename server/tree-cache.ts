import type { VaultEntry } from '../shared/protocol'

interface Tree {
  entries: Map<string, VaultEntry>
  /** When the walk that made it began. */
  at: number
}

/**
 * The list of a vault's files and folders, kept in memory. Walking a large
 * vault takes seconds (thousands of folders and files to look at), and the app
 * asks for the list at every start, twice: for the files and for the notes.
 * Once the folder is watched, the watcher's events keep the list current, and
 * it is walked again only now and then, in the background, in case an event was
 * missed.
 */
export class TreeCache {
  private trees = new Map<string, Tree>()
  /** Vaults whose watcher has finished its first look: only their lists are trusted. */
  private watched = new Set<string>()
  /** Walks under way, so that two requests at once share one. */
  private walking = new Map<string, Promise<VaultEntry[]>>()
  /** Events seen per vault: a walk that saw some arrive meanwhile may have missed them. */
  private events = new Map<string, number>()

  constructor(
    private walk: (dir: string) => Promise<VaultEntry[]>,
    private maxAge = 10 * 60_000,
  ) {}

  async list(dir: string): Promise<VaultEntry[]> {
    const tree = this.trees.get(dir)
    if (!tree || !this.watched.has(dir)) return this.load(dir)
    if (Date.now() - tree.at > this.maxAge) void this.load(dir).catch(() => {})
    return [...tree.entries.values()]
  }

  private load(dir: string): Promise<VaultEntry[]> {
    const running = this.walking.get(dir)
    if (running) return running
    const at = Date.now()
    const before = this.events.get(dir) ?? 0
    const walk = this.walk(dir)
      .then((entries) => {
        // A change that came while walking may or may not be in the result: then the next request walks again.
        if ((this.events.get(dir) ?? 0) === before) this.trees.set(dir, { entries: new Map(entries.map((entry) => [entry.path, entry])), at })
        else this.trees.delete(dir)
        return entries
      })
      .finally(() => this.walking.delete(dir))
    this.walking.set(dir, walk)
    return walk
  }

  private seen(dir: string): void {
    this.events.set(dir, (this.events.get(dir) ?? 0) + 1)
  }

  /** The watcher of the vault has looked at everything once; from now on its events keep the list. */
  ready(dir: string): void {
    this.watched.add(dir)
  }

  upsert(dir: string, entry: VaultEntry): void {
    this.seen(dir)
    this.trees.get(dir)?.entries.set(entry.path, entry)
  }

  /** A file, or a folder with everything in it, is gone. */
  remove(dir: string, path: string): void {
    this.seen(dir)
    const entries = this.trees.get(dir)?.entries
    if (!entries) return
    entries.delete(path)
    for (const key of [...entries.keys()]) if (key.startsWith(`${path}/`)) entries.delete(key)
  }

  /** The vault is no longer watched. */
  forget(dir: string): void {
    this.trees.delete(dir)
    this.watched.delete(dir)
  }
}
