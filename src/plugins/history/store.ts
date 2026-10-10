import type { App } from '../../api'

/** A change from the version before: lines `at .. at+del` are replaced by `ins`. The first version holds the whole text. */
export interface Version {
  /** When the note was saved, in milliseconds. */
  t: number
  /** Who saved it: this app, or something else (Obsidian, a script, a sync). */
  by: 'here' | 'outside'
  at: number
  del: number
  ins: string[]
  /** Lines added and removed against the version before, for the list. */
  plus: number
  minus: number
}

export interface History {
  path: string
  /** When the note was created, as the file system tells it at the first sight of the note. */
  created: number
  /** Names the note has had, with the time of each renaming. */
  renames?: { from: string; to: string; t: number }[]
  /** When the note was deleted, if it was. */
  deleted?: number
  versions: Version[]
}

const DIR = '.flint/history'
const INDEX = `${DIR}/index.json`

const lines = (text: string) => text.replace(/\r\n/g, '\n').split('\n')

/** The one run of lines that differs between two texts: everything before and after it is the same. */
export function change(before: string[], after: string[]): { at: number; del: number; ins: string[] } {
  let at = 0
  const shortest = Math.min(before.length, after.length)
  while (at < shortest && before[at] === after[at]) at++
  let end = 0
  while (end < shortest - at && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  return { at, del: before.length - at - end, ins: after.slice(at, after.length - end) }
}

/** The text of a note as it was at version `index`. */
export function textAt(history: History, index: number): string {
  let text: string[] = []
  for (let i = 0; i <= index && i < history.versions.length; i++) {
    const { at, del, ins } = history.versions[i]
    text = [...text.slice(0, at), ...ins, ...text.slice(at + del)]
  }
  return text.join('\n')
}

async function pack(value: unknown): Promise<ArrayBuffer> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

async function unpack<T>(data: ArrayBuffer): Promise<T> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text()) as T
}

/**
 * The histories of notes, kept in the vault under `.flint/history`: one small
 * compressed file a note, and an index that says which file is whose. A
 * version is stored as the lines that changed since the version before, so a
 * long note edited a hundred times costs about its own size, not a hundred
 * times that.
 */
export class HistoryStore {
  /** Path of a note -> the name of its history file. */
  private index: Record<string, string> = {}
  private loaded = new Map<string, History>()
  private saving: Promise<void> = Promise.resolve()

  constructor(private app: App) {}

  async load(): Promise<void> {
    try {
      this.index = JSON.parse((await this.app.vault.readOptional(INDEX)) ?? '{}')
    } catch {
      this.index = {}
    }
  }

  /** Paths that have a history, those of deleted notes too. */
  paths(): string[] {
    return Object.keys(this.index)
  }

  async get(path: string): Promise<History | null> {
    const id = this.index[path]
    if (!id) return null
    const known = this.loaded.get(id)
    if (known) return known
    try {
      const history = await unpack<History>(await this.app.vault.readBinary(`${DIR}/${id}.gz`))
      this.loaded.set(id, history)
      return history
    } catch {
      return null
    }
  }

  /** How much room a note's history takes on disk, in bytes. */
  size(path: string): number {
    const id = this.index[path]
    return id ? (this.sizes.get(id) ?? 0) : 0
  }
  private sizes = new Map<string, number>()

  /** Writes are done one after another: two saves of one history must not cross. */
  private write(id: string, history: History): Promise<void> {
    this.loaded.set(id, history)
    this.saving = this.saving
      .then(async () => {
        const data = await pack(history)
        this.sizes.set(id, data.byteLength)
        await this.app.vault.write(`${DIR}/${id}.gz`, data)
      })
      .catch(() => {})
    return this.saving
  }

  private writeIndex(): Promise<void> {
    this.saving = this.saving.then(() => this.app.vault.write(INDEX, JSON.stringify(this.index)).then(() => {})).catch(() => {})
    return this.saving
  }

  /**
   * Takes in the text of a note as a new version, if it differs from the last one.
   * `merge` says how close in time two saves by this app may be to count as one
   * version (typing saves every moment; a version for each save would be noise).
   */
  record(path: string, text: string, when: number, by: Version['by'], options: { created: number; merge: number; keep: number }): Promise<void> {
    // One at a time: a version is made from the one before it, so two must not be made at once.
    this.recording = this.recording.then(() => this.take(path, text, when, by, options)).catch(() => {})
    return this.recording
  }
  private recording: Promise<void> = Promise.resolve()

  private async take(path: string, text: string, when: number, by: Version['by'], options: { created: number; merge: number; keep: number }): Promise<void> {
    let id = this.index[path]
    let history = id ? await this.get(path) : null
    if (!id || !history) {
      id = this.index[path] = id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
      history = { path, created: options.created || when, versions: [] }
      void this.writeIndex()
    }
    delete history.deleted
    const versions = history.versions
    const last = versions.length - 1
    const current = lines(text)
    const before = last >= 0 ? lines(textAt(history, last)) : []
    const diff = change(before, current)
    if (last >= 0 && !diff.del && !diff.ins.length) return
    const previous = versions[last]
    // Saves by this app that follow one another closely are one sitting: the last version is replaced, not added to.
    if (last > 0 && by === 'here' && previous.by === 'here' && when - previous.t < options.merge) {
      const base = lines(textAt(history, last - 1))
      const merged = change(base, current)
      versions[last] = { t: when, by, ...merged, plus: merged.ins.length, minus: merged.del }
    } else versions.push({ t: when, by, ...diff, plus: diff.ins.length, minus: diff.del })
    // The oldest versions give way when there are too many: the two oldest become one.
    while (versions.length > Math.max(2, options.keep)) {
      const text1 = lines(textAt(history, 1))
      versions.splice(0, 2, { ...versions[1], at: 0, del: 0, ins: text1, plus: text1.length, minus: 0 })
    }
    await this.write(id, history)
  }

  async renamed(from: string, to: string): Promise<void> {
    const id = this.index[from]
    if (!id) return
    delete this.index[from]
    this.index[to] = id
    const history = await this.get(to)
    if (history) {
      history.path = to
      ;(history.renames ??= []).push({ from, to, t: Date.now() })
      void this.write(id, history)
    }
    await this.writeIndex()
  }

  async deleted(path: string): Promise<void> {
    const history = await this.get(path)
    if (!history) return
    history.deleted = Date.now()
    await this.write(this.index[path], history)
  }

  /** Forgets a note's history for good. */
  async forget(path: string): Promise<void> {
    const id = this.index[path]
    if (!id) return
    delete this.index[path]
    this.loaded.delete(id)
    await this.writeIndex()
    await this.app.vault.trash(`${DIR}/${id}.gz`).catch(() => {})
  }
}

/** A line-by-line comparison of two texts: what stayed, what went, what came. */
export function compare(before: string, after: string): { kind: 'same' | 'gone' | 'new'; text: string }[] {
  const a = lines(before)
  const b = lines(after)
  const { at, del, ins } = change(a, b)
  const out: { kind: 'same' | 'gone' | 'new'; text: string }[] = a.slice(0, at).map((text) => ({ kind: 'same' as const, text }))
  const gone = a.slice(at, at + del)
  // Inside the changed run the lines are matched one by one where the run is small enough to do so.
  if (gone.length * ins.length <= 400_000) {
    const table = Array.from({ length: gone.length + 1 }, () => new Uint16Array(ins.length + 1))
    for (let i = gone.length - 1; i >= 0; i--) for (let j = ins.length - 1; j >= 0; j--) table[i][j] = gone[i] === ins[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    let i = 0
    let j = 0
    while (i < gone.length && j < ins.length) {
      if (gone[i] === ins[j]) out.push({ kind: 'same', text: gone[i++] }), j++
      else if (table[i + 1][j] >= table[i][j + 1]) out.push({ kind: 'gone', text: gone[i++] })
      else out.push({ kind: 'new', text: ins[j++] })
    }
    while (i < gone.length) out.push({ kind: 'gone', text: gone[i++] })
    while (j < ins.length) out.push({ kind: 'new', text: ins[j++] })
  } else out.push(...gone.map((text) => ({ kind: 'gone' as const, text })), ...ins.map((text) => ({ kind: 'new' as const, text })))
  out.push(...a.slice(at + del).map((text) => ({ kind: 'same' as const, text })))
  return out
}
