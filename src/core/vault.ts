import type { ExternalPluginInfo, RemoteEvent, VaultEntry, VaultInfo } from '../../shared/protocol'
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

/**
 * The vault this page shows, as the address names it: the first part of the path,
 * `http://localhost:4600/<vault>/Folder/Note`. Empty until it is known (a bare address,
 * or an address from before vaults had names in it): then the vault opened last is used.
 */
let vaultInAddress = ''
try {
  vaultInAddress = decodeURIComponent(location.pathname.split('/')[1] ?? '')
} catch {
  vaultInAddress = ''
}
const named = () => (vaultInAddress ? `&vault=${encodeURIComponent(vaultInAddress)}` : '')
const url = (route: string, path: string) => `/api/${route}?path=${encodeURIComponent(path)}${named()}`

/** The address of a vault's own page. */
export const vaultAddress = (name: string) => `/${encodeURIComponent(name)}/`

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** Thrown when the server did not answer at all: it is not running, or is being restarted. */
export class ServerDown extends Error {
  constructor() {
    super('Сервер FlintNotes не отвечает. Запустите FlintNotes заново')
  }
}

/** Whether the server answers, for everyone who would otherwise each report the same failure. */
export const connection = Object.assign(new Events<{ change: [online: boolean]; build: [build: string] }>(), {
  online: true,
  /** The build of the server answering, and whether a launcher replaces it with each new build (from its greeting). */
  server: null as { build: string; updates: boolean } | null,
})
function setOnline(online: boolean): void {
  if (connection.online === online) return
  connection.online = online
  connection.trigger('change', online)
}

async function request(input: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    // Every request says which vault it is about; a header may only carry plain letters, so the name is encoded.
    const headers = vaultInAddress ? { ...(init?.headers as Record<string, string> | undefined), 'x-flint-vault': encodeURIComponent(vaultInAddress) } : init?.headers
    res = await fetch(input, { ...init, headers })
  } catch {
    // The browser says only "Failed to fetch"; what happened is that nobody is listening.
    setOnline(false)
    throw new ServerDown()
  }
  setOnline(true)
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  return res
}

/** The vault: every file and folder of the notes directory, kept in sync with the disk. */
export class Vault extends Events<VaultEvents> {
  name = ''
  /** The name the vault goes by in addresses. */
  urlName = ''
  /** Absolute path of the vault's folder on disk. */
  path = ''
  /** Obsidian's settings folders found in the vault (`.obsidian`, ...), the most recently used first. */
  obsidianConfigs: string[] = []
  private entries = new Map<string, VaultEntry>()

  /**
   * Finds out which vault the page is for. This comes before everything else: the settings,
   * the layout and the files are all asked of that vault by its name.
   */
  async identify(): Promise<void> {
    const asked = vaultInAddress
    // The first part of the address may not be a vault at all: a bare address, or one from before
    // vaults were named in it (`/Folder/Note`). The server says which vault is meant; then the address is put right.
    vaultInAddress = ''
    const where: { known: boolean; name: string } = await (await request(`/api/where?name=${encodeURIComponent(asked)}`)).json()
    vaultInAddress = where.name
    const info: { name: string; path: string; obsidianConfigs?: string[] } = await (await request('/api/vault')).json()
    vaultInAddress = info.name
    this.urlName = info.name
    if (!where.known) history.replaceState(null, '', `/${encodeURIComponent(info.name)}${asked ? location.pathname : '/'}${location.search}${location.hash}`)
    this.name = info.name
    this.path = info.path
    this.obsidianConfigs = info.obsidianConfigs ?? []
  }

  async load(): Promise<void> {
    await this.sync()
    const source = new EventSource(`/api/events?vault=${encodeURIComponent(this.urlName)}`)
    let connected = false
    source.onopen = () => {
      setOnline(true)
      // Changes made while the connection was down were missed, so re-read the tree.
      if (connected) void this.sync()
      connected = true
    }
    // The stream of changes breaks the moment the server goes away, and comes back by itself.
    source.onerror = () => setOnline(false)
    source.onmessage = (message) => {
      const event: RemoteEvent = JSON.parse(message.data)
      if (event.type === 'hello') {
        connection.server = { build: event.build, updates: !!event.updates }
        connection.trigger('build', event.build)
      }
      else if (event.type === 'upsert') this.upsert(event.entry)
      else this.remove(event.path)
    }
  }

  /** Plugins kept in the vault itself (`.flint/plugins`). */
  async externalPlugins(): Promise<ExternalPluginInfo[]> {
    return (await request('/api/plugins')).json()
  }

  /** The vaults the user has opened before. */
  async vaults(): Promise<VaultInfo[]> {
    return (await request('/api/vaults')).json()
  }

  /** Makes a folder known as a vault (creating it if asked) and tells its name, to go to its address. */
  async openVault(path: string, create = false): Promise<VaultInfo> {
    return (await request('/api/vaults/open', json({ path, create }))).json()
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

  /** Whether the server starts by itself when the user signs in to the computer. */
  async autostart(): Promise<{ supported: boolean; enabled: boolean; file?: string; reason?: string }> {
    return this.answer(await request('/api/autostart'))
  }

  async setAutostart(enabled: boolean): Promise<{ supported: boolean; enabled: boolean; file?: string }> {
    return this.answer(await request('/api/autostart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) }))
  }

  /** The port the server listens on, and whether it was fixed at start (FLINT_PORT) and cannot be changed from here. */
  async port(): Promise<{ port: number; fixed: boolean }> {
    return this.answer(await request('/api/port'))
  }

  /** Stops the server, and with it the launcher that would start it again. */
  async quit(): Promise<void> {
    await this.answer(await request('/api/quit', { method: 'POST' }))
  }

  /** Moves the server to another port; it is remembered for the next starts too. */
  async setPort(port: number): Promise<{ port: number }> {
    return this.answer(await request('/api/port', json({ port })))
  }

  /** The server's answer; a server started before an update does not know newer requests and sends the page instead. */
  private async answer<T>(res: Response): Promise<T> {
    if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error('Сервер FlintNotes запущен в старой версии. Закройте его окно и запустите FlintNotes заново')
    return res.json()
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
    this.writing.set(path, (this.writing.get(path) ?? 0) + 1)
    let entry: VaultEntry
    try {
      const res = await request(url('file', path) + (options.create ? '&create=1' : ''), {
        method: 'PUT',
        body: data,
        keepalive: options.keepalive,
      })
      entry = await res.json()
    } finally {
      const left = (this.writing.get(path) ?? 1) - 1
      if (left) this.writing.set(path, left)
      else this.writing.delete(path)
    }
    if (!path.startsWith('.')) {
      if (typeof data === 'string') {
        // Text this app wrote is no news from outside: the views showing the file get it as it is
        // ('written'), instead of each reading it back from the server as a change made elsewhere.
        const known = this.entries.has(entry.path)
        this.entries.set(entry.path, entry)
        if (!known) this.trigger('create', entry)
        this.trigger('written', entry, data)
      } else this.upsert(entry)
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

  /** Files this app is writing right now: the watcher's word about them is the echo of that write. */
  private writing = new Map<string, number>()

  private upsert(entry: VaultEntry): void {
    const previous = this.entries.get(entry.path)
    this.entries.set(entry.path, entry)
    if (!previous) this.trigger('create', entry)
    else if (this.writing.has(entry.path)) return
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
