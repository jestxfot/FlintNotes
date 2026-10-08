import type { RemoteEvent, VaultEntry } from '../../shared/protocol'
import { Events } from './events'
import { join } from './path'

export type { VaultEntry }

type VaultEvents = {
  create: [entry: VaultEntry]
  modify: [entry: VaultEntry]
  delete: [entry: VaultEntry]
  rename: [entry: VaultEntry, oldPath: string]
}

const url = (route: string, path: string) => `/api/${route}?path=${encodeURIComponent(path)}`

async function request(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  return res
}

/** The vault: every file and folder of the notes directory, kept in sync with the disk. */
export class Vault extends Events<VaultEvents> {
  name = ''
  private entries = new Map<string, VaultEntry>()

  async load(): Promise<void> {
    this.name = (await (await request('/api/vault')).json()).name
    await this.sync()
    const source = new EventSource('/api/events')
    let connected = false
    source.onopen = () => {
      // Changes made while the connection was down were missed, so re-read the tree.
      if (connected) void this.sync()
      connected = true
    }
    source.onmessage = (message) => {
      const event: RemoteEvent = JSON.parse(message.data)
      if (event.type === 'upsert') this.upsert(event.entry)
      else this.remove(event.path)
    }
  }

  get(path: string): VaultEntry | undefined {
    return this.entries.get(path)
  }

  all(): VaultEntry[] {
    return [...this.entries.values()]
  }

  files(): VaultEntry[] {
    return this.all().filter((entry) => entry.kind === 'file')
  }

  /** URL the browser can load the file from, e.g. for `<img src>`. */
  url(path: string): string {
    return url('file', path)
  }

  async read(path: string): Promise<string> {
    return (await request(url('file', path))).text()
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    return (await request(url('file', path))).arrayBuffer()
  }

  /** Reads a file that may not exist, such as a config file under `.flint`. */
  async readOptional(path: string): Promise<string | null> {
    const res = await request(`${url('file', path)}&optional=1`)
    return res.status === 204 ? null : res.text()
  }

  async write(
    path: string,
    data: string | ArrayBuffer,
    options: { create?: boolean; keepalive?: boolean } = {},
  ): Promise<VaultEntry> {
    const res = await request(url('file', path) + (options.create ? '&create=1' : ''), {
      method: 'PUT',
      body: data,
      keepalive: options.keepalive,
    })
    const entry: VaultEntry = await res.json()
    if (!path.startsWith('.')) this.upsert(entry)
    return entry
  }

  /** Creates a new file, failing if one already exists at `path`. */
  create(path: string, data = ''): Promise<VaultEntry> {
    return this.write(path, data, { create: true })
  }

  async createFolder(path: string): Promise<VaultEntry> {
    const entry: VaultEntry = await (await request(url('folder', path), { method: 'POST' })).json()
    this.upsert(entry)
    return entry
  }

  /** First free path of the form `folder/base.ext`, `folder/base 1.ext`, ... */
  uniquePath(folder: string, base: string, ext = ''): string {
    const suffix = ext ? `.${ext}` : ''
    let path = join(folder, base + suffix)
    for (let i = 1; this.entries.has(path); i++) path = join(folder, `${base} ${i}${suffix}`)
    return path
  }

  // Rename and trash update the local state before the server answers. The file
  // watcher may report the change first, and applying it late would look like an
  // unrelated delete to listeners (closing the open tab, for instance).
  async rename(from: string, to: string): Promise<void> {
    for (const entry of this.within(from)) {
      const moved = { ...entry, path: to + entry.path.slice(from.length) }
      this.entries.delete(entry.path)
      this.entries.set(moved.path, moved)
      this.trigger('rename', moved, entry.path)
    }
    await this.orResync(
      request('/api/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to }),
      }),
    )
  }

  /** Moves a file or folder to the vault's `.trash`. */
  async trash(path: string): Promise<void> {
    this.remove(path)
    await this.orResync(request(url('file', path), { method: 'DELETE' }))
  }

  private async orResync(action: Promise<unknown>): Promise<void> {
    try {
      await action
    } catch (err) {
      await this.sync()
      throw err
    }
  }

  private async sync(): Promise<void> {
    const list: VaultEntry[] = await (await request('/api/tree')).json()
    const present = new Set(list.map((entry) => entry.path))
    for (const entry of this.all()) {
      if (!present.has(entry.path) && this.entries.delete(entry.path)) this.trigger('delete', entry)
    }
    for (const entry of list) this.upsert(entry)
  }

  private upsert(entry: VaultEntry): void {
    const previous = this.entries.get(entry.path)
    this.entries.set(entry.path, entry)
    if (!previous) this.trigger('create', entry)
    else if (entry.kind === 'file' && (previous.mtime !== entry.mtime || previous.size !== entry.size)) {
      this.trigger('modify', entry)
    }
  }

  private remove(path: string): void {
    for (const entry of this.within(path)) {
      this.entries.delete(entry.path)
      this.trigger('delete', entry)
    }
  }

  /** The entry at `path` plus everything inside it. */
  private within(path: string): VaultEntry[] {
    return this.all().filter((entry) => entry.path === path || entry.path.startsWith(`${path}/`))
  }
}
