import type { App } from '../../api'

// What the user chose in the switcher, and for what they typed: a file chosen often and lately comes up first,
// and one chosen for these very letters before comes up first for them again. Kept in the vault's own folder of
// FlintNotes, not in Obsidian's: `.flint/quick-switcher.json`.

const FILE = '.flint/quick-switcher.json'
/** A choice counts half after two weeks, a quarter after four. */
const HALF_LIFE = 14 * 24 * 3600_000
const MAX_FILES = 600
const MAX_QUERIES = 400

/** How often and when last. */
interface Use {
  n: number
  at: number
}

interface Data {
  /** Files chosen, whatever was typed. */
  files: Record<string, Use>
  /** What was typed (lowercased) -> the files chosen for it. */
  queries: Record<string, Record<string, Use>>
}

const weight = (use: Use | undefined, now: number) => (use ? use.n * 0.5 ** ((now - use.at) / HALF_LIFE) : 0)

/** Keeps the `limit` entries used last. */
function trim<T extends Use | Record<string, Use>>(record: Record<string, T>, limit: number, at: (value: T) => number): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= limit) return record
  return Object.fromEntries(keys.sort((a, b) => at(record[b]) - at(record[a])).slice(0, limit).map((key) => [key, record[key]]))
}

export class SwitcherMemory {
  private data: Data = { files: {}, queries: {} }
  private saving: ReturnType<typeof setTimeout> | undefined

  constructor(private app: App) {}

  async load(): Promise<void> {
    try {
      const text = await this.app.vault.readOptional(FILE)
      const read = text ? JSON.parse(text) : null
      if (read && typeof read === 'object') this.data = { files: read.files ?? {}, queries: read.queries ?? {} }
    } catch {
      // A broken file is started anew.
    }
  }

  /** `path` was chosen with `typed` in the field. */
  chose(path: string, typed: string): void {
    const now = Date.now()
    const bump = (record: Record<string, Use>) => {
      const use = record[path]
      // The old count fades as it would have by now, then the new choice is added.
      record[path] = { n: weight(use, now) + 1, at: now }
    }
    bump(this.data.files)
    const query = typed.trim().toLowerCase()
    if (query) bump((this.data.queries[query] ??= {}))
    this.data.files = trim(this.data.files, MAX_FILES, (use) => use.at)
    this.data.queries = trim(this.data.queries, MAX_QUERIES, (uses) => Math.max(0, ...Object.values(uses).map((use) => use.at)))
    this.save()
  }

  /**
   * How much the memory lifts each file for what is typed now: the files chosen for these letters, and less
   * for letters that begin with them or that they begin with ("her" and "hero"), on a scale of their own.
   */
  forQuery(typed: string): Map<string, number> {
    const query = typed.trim().toLowerCase()
    const lift = new Map<string, number>()
    if (!query) return lift
    const now = Date.now()
    for (const [past, uses] of Object.entries(this.data.queries)) {
      const kin = past === query ? 1 : past.startsWith(query) || query.startsWith(past) ? 0.5 : 0
      if (!kin) continue
      for (const [path, use] of Object.entries(uses)) lift.set(path, (lift.get(path) ?? 0) + kin * weight(use, now))
    }
    return lift
  }

  /** How much a file was chosen lately, whatever was typed. */
  usage(path: string): number {
    return weight(this.data.files[path], Date.now())
  }

  /** The files chosen most, for a field with nothing typed. */
  favourites(): string[] {
    const now = Date.now()
    return Object.keys(this.data.files).sort((a, b) => weight(this.data.files[b], now) - weight(this.data.files[a], now))
  }

  /** A file renamed or moved keeps what it earned; one deleted is forgotten. */
  moved(from: string, to: string | null): void {
    let changed = false
    // A folder takes the files inside it along.
    const move = (record: Record<string, Use>) => {
      for (const key of Object.keys(record)) {
        if (key !== from && !key.startsWith(`${from}/`)) continue
        if (to) record[to + key.slice(from.length)] = record[key]
        delete record[key]
        changed = true
      }
    }
    move(this.data.files)
    for (const uses of Object.values(this.data.queries)) move(uses)
    if (changed) this.save()
  }

  private save(): void {
    clearTimeout(this.saving)
    this.saving = setTimeout(() => void this.app.vault.write(FILE, JSON.stringify(this.data)).catch(() => {}), 600)
  }

  /** Writes what waits to be written, when the plugin is turned off. */
  flush(): void {
    if (this.saving === undefined) return
    clearTimeout(this.saving)
    this.saving = undefined
    void this.app.vault.write(FILE, JSON.stringify(this.data)).catch(() => {})
  }
}
