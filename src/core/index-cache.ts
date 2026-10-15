import type { CachedMetadata } from './metadata'

/** A note as the index last saw it. */
export interface StoredNote {
  path: string
  mtime: number
  size: number
  text: string
  meta: CachedMetadata
}

interface Bucket {
  id: number
  notes: Record<string, StoredNote>
}

const STORE = 'buckets'
/** Raised when what is stored changes its form: an older store is then started afresh. */
const VERSION = 2
/** Notes are kept in this many blocks: one record per note made reading thousands of them slow. */
const BUCKETS = 64

function bucketOf(path: string): number {
  let hash = 0
  for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) | 0
  return (hash >>> 0) % BUCKETS
}

/**
 * The note index kept in the browser between visits (IndexedDB, one database
 * per vault). On the next start the index takes every note whose file has not
 * changed straight from here, parsed and all, and asks the server only for
 * the notes that did change: no megabytes of text to fetch and parse each time.
 *
 * The notes are kept in a few dozen blocks rather than one record each: reading
 * a few large records is much faster than reading thousands of small ones, and a
 * change rewrites only the block of the note that changed. Reading starts as soon
 * as the cache is made, so it goes on while the rest of the app is starting.
 *
 * It is only a cache: when the browser will not keep it (a private window, no
 * room), everything works as before, just slower to start.
 */
export class IndexCache {
  private db: Promise<IDBDatabase | null>
  private buckets: Promise<Map<number, Bucket>>
  private pending = new Map<string, StoredNote | null>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(vault: string) {
    this.db = new Promise((resolve) => {
      try {
        const open = indexedDB.open(`flint-index:${vault}`, VERSION)
        open.onupgradeneeded = () => {
          const db = open.result
          for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name)
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => resolve(null)
        open.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    this.buckets = this.db.then(
      (db) =>
        new Promise((resolve) => {
          const empty = () => resolve(new Map())
          if (!db) return empty()
          try {
            const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
            request.onsuccess = () => resolve(new Map((request.result as Bucket[]).map((bucket) => [bucket.id, bucket])))
            request.onerror = empty
          } catch {
            empty()
          }
        }),
    )
  }

  /** Everything stored for this vault, by path. */
  async readAll(): Promise<Map<string, StoredNote>> {
    const all = new Map<string, StoredNote>()
    for (const bucket of (await this.buckets).values()) for (const note of Object.values(bucket.notes)) all.set(note.path, note)
    return all
  }

  /** Remembers a note as it is now; writes are gathered and made together a moment later. */
  put(note: StoredNote): void {
    this.pending.set(note.path, note)
    this.schedule()
  }

  /** Forgets a note (deleted, or renamed: the new name is put separately). */
  remove(path: string): void {
    this.pending.set(path, null)
    this.schedule()
  }

  private schedule(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 1500)
  }

  /** Writes the blocks that changed. */
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    const [db, buckets] = await Promise.all([this.db, this.buckets])
    if (!db || !this.pending.size) return
    const changed = new Set<number>()
    for (const [path, note] of this.pending) {
      const id = bucketOf(path)
      const bucket = buckets.get(id) ?? buckets.set(id, { id, notes: {} }).get(id)!
      if (note) bucket.notes[path] = note
      else delete bucket.notes[path]
      changed.add(id)
    }
    this.pending.clear()
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction(STORE, 'readwrite')
        const store = transaction.objectStore(STORE)
        for (const id of changed) store.put(buckets.get(id)!)
        transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
  }
}
