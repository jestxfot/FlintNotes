import type { RemoteEvent, VaultEntry, VaultInfo } from '../../shared/protocol'
import { Events } from './events'
import { join } from './path'

export type { VaultEntry, VaultInfo }

type VaultEvents = {
  create: [entry: VaultEntry]
  modify: [entry: VaultEntry]
  delete: [entry: VaultEntry]
  /** This app saved text into a file. Reported before `modify`, with the text itself. */
  written: [entry: VaultEntry, text: string]
  /** A file was created by this app just now (not by another program or by sync). */
  'created-here': [entry: VaultEntry]
  rename: [entry: VaultEntry, oldPath: string]
}

const url = (route: string, path: string) => `/api/${route}?path=${encodeURIComponent(path)}`

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function request(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  return res
}

/** The vault: every file and folder of the notes directory, kept in sync with the disk. */
export class Vault extends Events<VaultEvents> {
  name = ''
  /** Absolute path of the vault's folder on disk. */
  path = ''
  /** Obsidian's settings folders found in the vault (`.obsidian`, ...), the most recently used first. */
  obsidianConfigs: string[] = []
  private entries = new Map<string, VaultEntry>()

  async load(): Promise<void> {
    const info = await (await request('/api/vault')).json()
    this.name = info.name
    this.path = info.path
    this.obsidianConfigs = info.obsidianConfigs ?? []
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
      // Another vault was opened (here or in another tab): everything on screen is stale.
      if (event.type === 'vault') return location.reload()
      if (event.type === 'upsert') this.upsert(event.entry)
      else this.remove(event.path)
    }
  }

  /** The vaults the user has opened before. */
  async vaults(): Promise<VaultInfo[]> {
    return (await request('/api/vaults')).json()
  }

  /** Switches the app to another folder; the page reloads when the server has switched. */
  async openVault(path: string, create = false): Promise<void> {
    await request('/api/vaults/open', json({ path, create }))
  }

  /** Removes a vault from the list without touching its folder. */
  async forgetVault(path: string): Promise<VaultInfo[]> {
    return (await request('/api/vaults/forget', json({ path }))).json()
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

  /** Shows a file or folder in the system's file manager; `''` is the vault's own folder. */
  async reveal(path: string): Promise<void> {
    await request(url('reveal', path), { method: 'POST' })
  }

  /** Programs that templates of this vault may run (their names), and the file where they are allowed. */
  async systemCommands(): Promise<{ file: string; vault: string; commands: string[] }> {
    return (await request('/api/system-commands')).json()
  }

  /** Runs an allowed program in the vault's folder; `env` reaches it as environment variables. */
  async exec(name: string, env: Record<string, unknown> = {}): Promise<string> {
    const res = await request('/api/exec', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, env }) })
    return ((await res.json()) as { output: string }).output
  }

  /** Asks the server to make a web request, which a page itself may not make to another site. */
  async requestUrl(options: { url: string; method?: string; headers?: Record<string, string>; body?: string; contentType?: string }): Promise<{ status: number; headers: Record<string, string>; text: string }> {
    return (await request('/api/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options) })).json()
  }

  /** What a web page says about itself: title, description, picture. */
  async unfurl(address: string): Promise<{ url: string; title: string; description: string; image: string; favicon: string }> {
    return (await request(`/api/unfurl?url=${encodeURIComponent(address)}`)).json()
  }

  /** Names of the files in a folder, hidden folders included (`.obsidian/...`); empty if there is no such folder. */
  async list(path: string): Promise<string[]> {
    return (await request(url('list', path))).json()
  }

  /** Reads the text of every note in one request, calling `each` as they arrive. */
  async readNotes(each: (path: string, text: string) => void): Promise<void> {
    const reader = (await request('/api/notes')).body!.getReader()
    const decoder = new TextDecoder()
    let rest = ''
    let sliceStart = performance.now()
    for (;;) {
      const { done, value } = await reader.read()
      const lines = (rest + decoder.decode(value, { stream: !done })).split('\n')
      // The last piece is a line still being received.
      rest = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        const note = JSON.parse(line)
        each(note.path, note.text)
        // Megabytes of notes can arrive at once. Pausing every few milliseconds
        // lets the page answer clicks and typing while they are processed.
        if (performance.now() - sliceStart > 8) {
          await new Promise((resume) => setTimeout(resume))
          sliceStart = performance.now()
        }
      }
      if (done) break
    }
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
    if (!path.startsWith('.')) {
      if (typeof data === 'string') this.trigger('written', entry, data)
      this.upsert(entry)
      // The server refuses `create` for a file that exists, so a success means this
      // app made the file. (The file watcher may already have reported it.)
      if (options.create) this.trigger('created-here', entry)
    }
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
