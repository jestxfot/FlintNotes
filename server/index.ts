import { serve } from '@hono/node-server'
import chokidar from 'chokidar'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { stream, streamSSE } from 'hono/streaming'
import { AsyncLocalStorage } from 'node:async_hooks'
import { exec } from 'node:child_process'
import crypto from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createReadStream, createWriteStream, existsSync, readFileSync, watch as fsWatch, type Stats } from 'node:fs'
import fs from 'node:fs/promises'
import type { Server } from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { PROTOCOL, type BuildInfo, type DirListing, type ExternalPluginInfo, type RemoteEvent, type Tier, type VaultEntry, type VaultInfo } from '../shared/protocol'
import { checkWay, chooseProxy, computerProxy, describe, parseProxy, telegramName, viaProxy, webFetch, webGet, youtubeVideo } from './web'
import { decide } from './policy'
import { keptTrees, limiter } from './kept'
import { TreeCache } from './tree-cache'

// The vaults the user has opened are remembered between runs, outside any vault.
const CONFIG = process.env.FLINT_CONFIG ?? path.join(os.homedir(), '.flintnotes.json')

interface Config {
  vaults: string[]
  current?: string
  /** The port the server listens on; chosen in the settings. */
  port?: number
  /** How the server reaches the web: `system` (the computer's proxy), `off`, or a proxy's address; chosen in the settings. */
  proxy?: string
  /** Programs that templates of a vault may run, by vault folder; see `/system-commands`. */
  systemCommands?: Record<string, SystemCommands>
  /** FlintNotes for the phones of the home network; see «a phone on the home network». */
  phone?: { on?: boolean; port?: number; key?: string; /** The address to listen on; every network card of the computer when not given (FLINT_BIND wins). */ host?: string }
  /** The key of the Windows shell (the service's network listener has it beside the phones' key; see «who may ask»). */
  shell?: { key?: string }
}

interface SystemCommands {
  /** Name -> command line. */
  commands: Record<string, string>
  /** Seconds a command may run. */
  timeout?: number
}

async function readConfig(): Promise<Config> {
  try {
    const data = JSON.parse(await fs.readFile(CONFIG, 'utf8'))
    return {
      vaults: Array.isArray(data.vaults) ? data.vaults.filter((v: unknown) => typeof v === 'string') : [],
      current: data.current,
      port: validPort(data.port) ? data.port : undefined,
      proxy: typeof data.proxy === 'string' ? data.proxy : undefined,
      systemCommands: data.systemCommands && typeof data.systemCommands === 'object' ? data.systemCommands : undefined,
      phone: data.phone && typeof data.phone === 'object' ? { on: data.phone.on === true, port: validPort(data.phone.port) ? data.phone.port : undefined, key: typeof data.phone.key === 'string' && data.phone.key.length >= 16 ? data.phone.key : undefined, host: typeof data.phone.host === 'string' && net.isIP(data.phone.host) ? data.phone.host : undefined } : undefined,
      shell: data.shell && typeof data.shell === 'object' && typeof data.shell.key === 'string' && data.shell.key.length >= 16 ? { key: data.shell.key } : undefined,
    }
  } catch {
    return { vaults: [] }
  }
}

const DEFAULT_PORT = 4600
const validPort = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65535

const config = await readConfig()
/**
 * Run as a service on the Debian computer (service/flintnotes, FLINT_SERVICE=1): the notes are for the Windows shell and
 * the phones of the network, so the listener for them is on whenever a key exists; the shell's is made at the first start
 * (`service/flintnotes pair` shows it). Its config, caches and own vaults are under STATE_DIR.
 */
const SERVICE = process.env.FLINT_SERVICE === '1'
const STATE_DIR = process.env.FLINT_STATE_DIR
const newKey = () => crypto.randomBytes(18).toString('base64url')
if (SERVICE && !config.shell?.key) config.shell = { key: newKey() }
chooseProxy(config.proxy ?? 'system')
// FLINT_PORT (tests, development) wins over the port chosen in the settings; then that port can not be changed from the app.
const fixedPort = process.env.FLINT_PORT ? Number(process.env.FLINT_PORT) : undefined
let port = fixedPort ?? config.port ?? DEFAULT_PORT
// A vault named on the command line wins over the one used last time. The first start of all has `vault`
// next to the program, or the place the service's unit file gives (FLINT_FIRST_VAULT).
let defaultRoot = path.resolve(process.argv[2] ?? process.env.FLINT_VAULT ?? config.current ?? process.env.FLINT_FIRST_VAULT ?? 'vault')
/**
 * The server serves every known vault at once: each request says which vault it
 * is about, and each page keeps to its own. Inside a request `root()` is that
 * vault's folder; a request that names none means the vault opened last.
 */
const scope = new AsyncLocalStorage<string>()
const root = () => scope.getStore() ?? defaultRoot

const MIME: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json',
  js: 'text/javascript',
  css: 'text/css',
  html: 'text/html; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mjs: 'text/javascript',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  map: 'application/json',
  webmanifest: 'application/manifest+json',
}

const toRel = (abs: string, base = root()) => path.relative(base, abs).split(path.sep).join('/')

const toEntry = (abs: string, stat: Stats, base = root()): VaultEntry => ({
  path: toRel(abs, base),
  kind: stat.isDirectory() ? 'folder' : 'file',
  size: stat.isDirectory() ? 0 : stat.size,
  mtime: stat.mtimeMs,
  // Some filesystems (a network disk) do not report a creation time;
  // the earliest time known for the file stands in for it.
  ctime: stat.birthtimeMs || Math.min(stat.mtimeMs, stat.ctimeMs),
})

/**
 * Whether `abs` lies inside `base` (`base` itself only when `allowRoot`). Asked through path.relative, never by comparing
 * text: a root that ends in a separator (`/`, a share's top folder) would otherwise match nothing.
 */
export function isInside(base: string, abs: string, allowRoot = false): boolean {
  const rel = path.relative(base, abs)
  if (rel === '') return allowRoot
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
}

/** Resolves a vault-relative path, refusing anything that escapes the vault. */
function resolveInVault(rel: string | undefined, allowRoot = false): string {
  if (rel === undefined) throw new HTTPException(400, { message: 'Missing path' })
  const abs = path.resolve(root(), rel)
  if (!isInside(root(), abs, allowRoot)) throw new HTTPException(400, { message: 'Path is outside the vault' })
  return abs
}

const target = (c: Context) => resolveInVault(c.req.query('path'))

/** The lists of the vaults' files, kept current by their watchers, and on disk for the next start. */
const trees = new TreeCache(
  (dir) => walk(dir),
  undefined,
  process.env.FLINT_KEEP_TREES === '0' ? null : keptTrees,
  // What the walk after a start finds different from the kept list reaches the pages as the watcher's news would.
  (dir, change) => broadcast(dir, change.type === 'upsert' ? change : { type: 'delete', path: change.path }),
)
/** The disk is asked about a few files at a time: requests of the page get their turn while a large vault is walked. */
const disk = limiter(24)

/**
 * Every file and folder under `dir`, with paths relative to the vault `base`. What the system will
 * not let us read (a protected folder, a file held open by another program, a cloud placeholder)
 * is left out instead of failing the whole vault; only the vault's own folder must be readable.
 */
async function walk(dir: string, base = dir): Promise<VaultEntry[]> {
  const listed = await disk(() => fs.readdir(dir, { withFileTypes: true })).catch((err) => {
    if (dir === base) throw err
    return []
  })
  const dirents = listed.filter((d) => !d.name.startsWith('.') && (d.isDirectory() || d.isFile()))
  const nested = await Promise.all(
    dirents.map(async (d) => {
      const abs = path.join(dir, d.name)
      const stat = await disk(() => fs.stat(abs)).catch(() => null)
      if (!stat) return []
      const self = toEntry(abs, stat, base)
      return d.isDirectory() ? [self, ...(await walk(abs, base))] : [self]
    }),
  )
  return nested.flat()
}

/** Makes sure the folder exists; a new one gets a note explaining the basics. */
async function ensureVault(dir: string): Promise<void> {
  if (existsSync(dir)) return
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, 'Добро пожаловать.md'),
    '# Добро пожаловать в FlintNotes\n\nЭто ваше хранилище: обычная папка с Markdown-файлами.\n\n- `Ctrl+P` открывает палитру команд\n- `Ctrl+,` открывает настройки, там же включаются плагины\n- `Alt+N` создаёт новую заметку\n',
  )
}

async function remember(): Promise<void> {
  // Commands allowed by hand while the server runs must survive this rewrite.
  config.systemCommands = (await readConfig()).systemCommands
  config.current = defaultRoot
  if (!config.vaults.includes(defaultRoot)) config.vaults.push(defaultRoot)
  await fs.writeFile(CONFIG, JSON.stringify(config, null, 2)).catch((err) => console.error(`Не удалось записать ${CONFIG}`, err))
}

await ensureVault(defaultRoot)
await remember()

const api = new Hono()

// The server can write to disk, so only the local app may talk to it. A request
// must be addressed to this machine (a foreign Host header means DNS rebinding)
// and, if a page sent it, that page must be served from this machine too. The
// port may differ: in development the page comes from the Vite server.
const LOCAL = ['localhost', '127.0.0.1', '[::1]']
const isLocal = (url: string) => {
  try {
    return LOCAL.includes(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * The name a vault goes by in addresses: its folder's name. Two folders of one name are told
 * apart by a number; a name the server needs for itself gets a tail.
 */
const RESERVED = new Set(['api', 'assets'])
function vaultName(dir: string): string {
  const base = path.basename(dir) || 'vault'
  const same = config.vaults.filter((one) => path.basename(one) === base)
  const at = same.indexOf(dir)
  const name = at > 0 ? `${base}-${at + 1}` : base
  return RESERVED.has(name.toLowerCase()) ? `${name}-vault` : name
}
const vaultByName = (name: string) => config.vaults.find((dir) => vaultName(dir) === name)

/**
 * The folders in which a client of the network (the Windows shell) may open new vaults: FLINT_VAULT_ROOTS (absolute
 * folders, separated by colons), or, as a service, the service's own `vaults` folder. A request on the server's own
 * computer is asked nothing; with no roots and no service the network gets only the vaults already known.
 */
const vaultRoots = (): string[] => {
  const given = (process.env.FLINT_VAULT_ROOTS ?? '')
    .split(':')
    .map((one) => one.trim())
    .filter((one) => path.isAbsolute(one))
  if (given.length) return given.map((one) => path.resolve(one))
  return SERVICE && STATE_DIR ? [path.join(STATE_DIR, 'vaults')] : []
}
/** The real place of a path, links followed; for one that does not exist yet, its nearest existing parent's real place with the rest after it. */
async function realPlace(dir: string): Promise<string> {
  const rest: string[] = []
  for (let here = path.resolve(dir); ; here = path.dirname(here)) {
    try {
      return path.join(await fs.realpath(here), ...rest.reverse())
    } catch {
      if (here === path.dirname(here)) return path.resolve(dir)
      rest.push(path.basename(here))
    }
  }
}
/** Whether `dir` lies in a root (a root itself only when `allowRoot`), by where it really is: a link inside a root that leads out of it does not count. */
async function insideRoots(dir: string, allowRoot = false): Promise<boolean> {
  const real = await realPlace(dir)
  for (const one of vaultRoots()) if (isInside(await realPlace(one), real, allowRoot)) return true
  return false
}

api.use(async (c, next) => {
  // A client of the network (the Windows shell, a phone) has shown its key already (see `lanFetch`); its page comes from the server's address.
  const tier = tierOf(c)
  const remote = tier !== 'admin'
  if (!remote && !isLocal(`http://${c.req.header('host') ?? ''}`)) throw new HTTPException(403, { message: 'Forbidden host' })
  const origin = c.req.header('origin')
  if (origin && (remote ? hostOf(origin) !== c.req.header('host') : !isLocal(origin))) throw new HTTPException(403, { message: 'Forbidden origin' })
  // What each tier may ask for is one list (policy.ts); what depends on the data (the vault roots) is checked by the route.
  const verdict = decide(tier, c.req.method, c.req.path)
  if (!verdict.allowed) throw new HTTPException(403, { message: verdict.message })
  // Which vault the request is about: named in a header (requests of the app) or in the address
  // (pictures, the stream of changes). None named: the vault opened last.
  // A page that is only finding out which vault its address means names none yet.
  if (c.req.path.endsWith('/where')) return next()
  const header = c.req.header('x-flint-vault')
  const named = header !== undefined ? decodeURIComponent(header) : c.req.query('vault')
  if (!named) return next()
  const dir = vaultByName(named)
  if (!dir) throw new HTTPException(404, { message: `Нет хранилища «${named}»` })
  if (!existsSync(dir)) throw new HTTPException(404, { message: `Папки хранилища «${named}» больше нет: ${dir}` })
  watch(dir)
  return scope.run(dir, next)
})

/**
 * Obsidian keeps its settings in a dot-folder of the vault (`.obsidian`, or
 * another name the user chose). Plugins read them to work the same way as
 * Obsidian does on the same notes. The most recently used folder comes first.
 */
async function obsidianConfigs(): Promise<string[]> {
  const dirs = (await fs.readdir(root(), { withFileTypes: true })).filter((d) => d.isDirectory() && d.name.startsWith('.'))
  const found = await Promise.all(
    dirs.map(async (d) => {
      const app = await fs.stat(path.join(root(), d.name, 'app.json')).catch(() => null)
      const used = await fs.stat(path.join(root(), d.name, 'workspace.json')).catch(() => null)
      return app ? { name: d.name, used: (used ?? app).mtimeMs } : null
    }),
  )
  return found.filter((f) => f !== null).sort((a, b) => b.used - a.used).map((f) => f.name)
}

// Which vault an address means: the one its first part names, or, if that is not a vault's name
// (a bare address, or one from before vaults were named in addresses), the vault opened last.
api.get('/where', (c) => {
  const dir = vaultByName(c.req.query('name') ?? '')
  const known = !!dir && existsSync(dir)
  return c.json({ known, name: vaultName(known ? dir : defaultRoot) })
})

api.get('/vault', async (c) => {
  // A page asks this once, when it opens. The vault opened last is the one a bare address leads to.
  if (root() !== defaultRoot) {
    defaultRoot = root()
    void remember()
  }
  return c.json({ name: vaultName(root()), path: root(), tier: tierOf(c), obsidianConfigs: await obsidianConfigs() })
})

const vaultInfo = (dir: string): VaultInfo => ({ path: dir, name: vaultName(dir), current: dir === root(), exists: existsSync(dir) })

api.get('/vaults', (c) => c.json(config.vaults.map(vaultInfo)))

// Makes a folder known as a vault. Pages already open stay on their own vaults; the page that asked goes to the new one by its address.
api.post('/vaults/open', async (c) => {
  const body = await c.req.json<{ path: string; create?: boolean }>()
  if (!body.path?.trim() || !path.isAbsolute(body.path.trim())) {
    throw new HTTPException(400, { message: 'Укажите полный путь к папке, например /var/lib/flintnotes/vaults/Заметки' })
  }
  const dir = path.resolve(body.path.trim())
  const tier = tierOf(c)
  if (tier === 'phone' && !config.vaults.includes(dir)) throw new HTTPException(403, { message: 'С телефона открываются только хранилища, уже открытые на компьютере' })
  if (tier === 'shell' && !config.vaults.includes(dir) && !(await insideRoots(dir))) throw new HTTPException(403, { message: `Новые хранилища открываются только в ${vaultRoots().join(', ') || 'уже известных папках'}` })
  const stat = await fs.stat(dir).catch(() => null)
  if (stat && !stat.isDirectory()) throw new HTTPException(400, { message: 'Это файл, а нужна папка' })
  if (!stat && !body.create) throw new HTTPException(404, { message: 'Такой папки нет' })
  await ensureVault(dir)
  // The vault opened last is the one a bare address (and the next start) leads to.
  defaultRoot = dir
  await remember()
  watch(dir)
  return c.json(vaultInfo(dir))
})

// Removes a vault from the list. Its folder and notes are not touched.
api.post('/vaults/forget', async (c) => {
  const { path: dir } = await c.req.json<{ path: string }>()
  if (dir === root()) throw new HTTPException(400, { message: 'Это хранилище сейчас открыто' })
  if (dir === defaultRoot) throw new HTTPException(400, { message: 'Это хранилище открывается при запуске; сначала откройте другое' })
  config.vaults = config.vaults.filter((v) => v !== dir)
  void watchers.get(dir)?.close()
  watchers.delete(dir)
  trees.forget(dir)
  await remember()
  return c.json(config.vaults.map(vaultInfo))
})

// The folders under one folder, for choosing a vault where the server's disk is: the shell sees only what lies in the roots.
api.get('/dirs', async (c) => {
  const tier = tierOf(c)
  const roots = tier === 'admin' ? [] : vaultRoots()
  // The network gets to see folders only where roots say so; with none there is nothing to show.
  if (tier !== 'admin' && !roots.length) throw new HTTPException(403, { message: 'На этом сервере нет папок для новых хранилищ (FLINT_VAULT_ROOTS)' })
  const asked = c.req.query('path')
  const entry = (dir: string) => ({ name: path.basename(dir) || dir, path: dir, vault: config.vaults.includes(dir) || existsSync(path.join(dir, '.obsidian')) || existsSync(path.join(dir, '.flint')) })
  // No place named: the roots to choose among (or, on the server's own computer, its home folder).
  if (!asked) {
    if (roots.length) return c.json({ path: null, parent: null, roots, dirs: roots.map(entry) })
    return c.json(await listDirs(os.homedir(), tier === 'admin'))
  }
  if (!path.isAbsolute(asked)) throw new HTTPException(400, { message: 'Нужен полный путь' })
  const dir = path.resolve(asked)
  // A root itself may be looked into; a vault is opened inside it, never as the root itself.
  if (roots.length && !(await insideRoots(dir, true))) throw new HTTPException(403, { message: 'Сюда нельзя: только внутри ' + roots.join(', ') })
  return c.json(await listDirs(dir, tier === 'admin'))

  async function listDirs(at: string, unrestricted: boolean) {
    const stat = await fs.stat(at).catch(() => null)
    if (!stat?.isDirectory()) throw new HTTPException(404, { message: 'Такой папки нет' })
    const names = await fs.readdir(at, { withFileTypes: true }).catch(() => [])
    const found: ReturnType<typeof entry>[] = []
    for (const one of names) {
      if (one.name.startsWith('.') || found.length >= 1000) continue
      const sub = path.join(at, one.name)
      // A link to a folder counts as one, if it does not lead out of the roots.
      const isDir = one.isDirectory() || (one.isSymbolicLink() && (await fs.stat(sub).catch(() => null))?.isDirectory())
      if (isDir && (unrestricted || !roots.length || (await insideRoots(sub)))) found.push(entry(sub))
    }
    found.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    const atRoot = roots.some((one) => path.resolve(one) === at)
    return { path: at, parent: atRoot || at === path.dirname(at) ? null : path.dirname(at), roots, dirs: found }
  }
})

// The list of a big vault is megabytes of paths (12.8 MB for 75 000 files), which the window fetches at each start and each
// reconnect over the network: gzipped it is about an eighth. Done once per state of the tree, not per request.
let gzippedTree: { text: string; zipped: Uint8Array<ArrayBuffer> } | null = null
api.get('/tree', async (c) => {
  const text = await trees.json(root())
  const headers = { 'content-type': 'application/json; charset=utf-8', vary: 'accept-encoding' }
  if (text.length < 64 * 1024 || !/\bgzip\b/.test(c.req.header('accept-encoding') ?? '')) return c.body(text, 200, headers)
  if (gzippedTree?.text !== text) gzippedTree = { text, zipped: Uint8Array.from(await promisify(gzip)(text, { level: 4 })) }
  return c.body(gzippedTree.zipped, 200, { ...headers, 'content-encoding': 'gzip' })
})

// Every note's text in one response, one JSON object per line. The app reads
// this once at start to build its index; a request per note would be far slower.
api.get('/notes', async (c) => {
  const notes = (await trees.list(root())).filter((entry) => entry.kind === 'file' && entry.path.toLowerCase().endsWith('.md'))
  c.header('content-type', 'application/x-ndjson; charset=utf-8')
  c.header('cache-control', 'no-store')
  return stream(c, async (out) => {
    for (let i = 0; i < notes.length; i += 32) {
      const lines = await Promise.all(
        notes.slice(i, i + 32).map(async ({ path: file }) => {
          // A note deleted since the listing is simply left out.
          const text = await fs.readFile(path.join(root(), file), 'utf8').catch(() => null)
          return text === null ? '' : `${JSON.stringify({ path: file, text })}\n`
        }),
      )
      await out.write(lines.join(''))
    }
  })
})

api.get('/file', async (c) => {
  const abs = target(c)
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat?.isFile()) {
    // `optional` reads (config files that may not exist yet) get an empty answer
    // instead of an error, which keeps the browser console clean.
    if (c.req.query('optional')) return c.body(null, 204)
    throw new HTTPException(404, { message: 'File not found' })
  }
  const ext = path.extname(abs).slice(1).toLowerCase()
  // An address that names the file's version (`v`, its time and size) always means the same bytes:
  // the browser keeps them and asks no more. A changed file gets another address.
  const version = c.req.query('v')
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': version && version === `${Math.round(stat.mtimeMs)}-${stat.size}` ? 'private, max-age=31536000, immutable' : 'no-store',
    // A video or a long recording is played from where it is asked for, over a network that may be slow.
    'accept-ranges': 'bytes',
  }
  const range = parseRange(c.req.header('range'), stat.size)
  if (range === 'bad') return c.body(null, 416, { 'content-range': `bytes */${stat.size}` })
  const [start, end] = range ?? [0, stat.size - 1]
  headers['content-length'] = String(stat.size ? end - start + 1 : 0)
  if (range) headers['content-range'] = `bytes ${start}-${end}/${stat.size}`
  // Sent as it is read, not read whole first: a large file takes no more memory than a small one.
  const status = range ? 206 : 200
  if (!stat.size) return c.body(null, status, headers)
  return c.body(Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream, status, headers)
})

/** One range of `Range: bytes=a-b`, `a-` or `-n` for a file `size` long, start and end both included; null if there is none (the whole file), 'bad' if it lies outside the file. */
function parseRange(header: string | undefined, size: number): [number, number] | 'bad' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    const last = Number(match[2])
    return last === 0 || size === 0 ? 'bad' : [Math.max(0, size - last), size - 1]
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  return start >= size || start > end ? 'bad' : [start, end]
}

// Files are written in place rather than via temp file + rename: a replaced file
// would lose its creation time, which notes expose as `file.ctime`. (Only a large file, which is not a note, is
// received into a file of its own first.)
/** What one file may weigh, and from what size it is received as a stream rather than taken whole. */
const MAX_UPLOAD = Number(process.env.FLINT_MAX_UPLOAD) || 4 * 1024 ** 3
const STREAM_FROM = 8 * 1024 ** 2
api.put('/file', async (c) => {
  const abs = target(c)
  if (c.req.query('create') && existsSync(abs)) {
    throw new HTTPException(409, { message: 'Already exists' })
  }
  const length = Number(c.req.header('content-length') ?? NaN)
  if (length > MAX_UPLOAD) throw new HTTPException(413, { message: 'Файл слишком большой' })
  await fs.mkdir(path.dirname(abs), { recursive: true })
  if (length <= STREAM_FROM) {
    // A note or a small file: taken whole first, so a save cut off half way leaves what was there.
    await fs.writeFile(abs, new Uint8Array(await c.req.arrayBuffer()))
  } else {
    // A large file (a picture, a recording) goes to a hidden file beside it as it arrives and takes its place at the end;
    // it never sits whole in memory, and a transfer cut off leaves the old file alone.
    const part = path.join(path.dirname(abs), `.${path.basename(abs)}.flint-part`)
    let received = 0
    const counted = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length
        done(received > MAX_UPLOAD ? new HTTPException(413, { message: 'Файл слишком большой' }) : null, chunk)
      },
    })
    try {
      await pipeline(c.req.raw.body ? Readable.fromWeb(c.req.raw.body as never) : Readable.from([]), counted, createWriteStream(part))
      await fs.rename(part, abs)
    } catch (err) {
      await fs.rm(part, { force: true })
      throw err
    }
  }
  return c.json(toEntry(abs, await fs.stat(abs)))
})

api.post('/folder', async (c) => {
  const abs = target(c)
  if (existsSync(abs)) throw new HTTPException(409, { message: 'Already exists' })
  await fs.mkdir(abs, { recursive: true })
  return c.json(toEntry(abs, await fs.stat(abs)))
})

api.post('/rename', async (c) => {
  const body = await c.req.json<{ from: string; to: string }>()
  const from = resolveInVault(body.from)
  const to = resolveInVault(body.to)
  if (!existsSync(from)) throw new HTTPException(404, { message: 'File not found' })
  if (existsSync(to)) throw new HTTPException(409, { message: 'Already exists' })
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.rename(from, to)
  return c.json(toEntry(to, await fs.stat(to)))
})

// Deleting moves to `.trash` inside the vault, so nothing is lost by a misclick.
api.delete('/file', async (c) => {
  const abs = target(c)
  if (!existsSync(abs)) throw new HTTPException(404, { message: 'File not found' })
  let dest = path.join(root(), '.trash', toRel(abs))
  if (existsSync(dest)) {
    const ext = path.extname(dest)
    dest = `${dest.slice(0, dest.length - ext.length)} ${Date.now()}${ext}`
  }
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.rename(abs, dest)
  return c.body(null, 204)
})

// Names of the files in one folder of the vault, hidden folders included: the
// tree leaves those out, but plugins read Obsidian's own files (its custom icons).
api.get('/list', async (c) => {
  const dirents = await fs.readdir(resolveInVault(c.req.query('path') ?? '', true), { withFileTypes: true }).catch(() => [])
  return c.json(dirents.filter((d) => d.isFile()).map((d) => d.name))
})

// ---- programs run by templates
//
// Templater lets a template call a program of the operating system
// (`tp.user.name()`). Running programs is far more than the rest of this API
// can do, and notes may carry scripts that run in the app's page, so nothing
// that comes over HTTP decides what is run: the allowed command lines are
// written by hand into this user's config file, outside every vault,
//
//   "systemCommands": { "<vault folder>": { "commands": { "name": "command line" }, "timeout": 5 } }
//
// and a request can only name one of them. The template's arguments reach the
// program as environment variables, as in Templater.
api.get('/system-commands', async (c) => c.json({ file: CONFIG, vault: root(), commands: Object.keys((await readConfig()).systemCommands?.[root()]?.commands ?? {}) }))

api.post('/exec', async (c) => {
  const origin = c.req.header('origin')
  if (!origin || new URL(origin).host !== c.req.header('host')) throw new HTTPException(403, { message: 'Только со страницы самого приложения' })
  const { name, env } = (await c.req.json()) as { name: string; env?: Record<string, unknown> }
  // The file is read anew, so a command added by hand works without a restart.
  const allowed = (await readConfig()).systemCommands?.[root()]
  const command = allowed && Object.hasOwn(allowed.commands ?? {}, name) ? allowed.commands[name] : undefined
  if (typeof command !== 'string' || !command.trim()) throw new HTTPException(403, { message: `Команда «${name}» не разрешена в ${CONFIG}` })
  const variables = Object.fromEntries(Object.entries(env ?? {}).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]))
  const timeout = Math.min(600, Math.max(1, Number(allowed?.timeout) || 5)) * 1000
  const output = await new Promise<string>((resolve, reject) => {
    exec(command, { cwd: root(), timeout, env: { ...process.env, ...variables }, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new HTTPException(500, { message: (stderr || err.message).trim().slice(0, 500) }))
      else resolve(stdout)
    })
  })
  return c.json({ output: output.trimEnd() })
})

// ---- who may ask: the server's own computer, the Windows shell, a phone
//
// The server answers three kinds of askers, which the listener they came through tells apart:
//   admin   a request on 127.0.0.1 (the computer's own browser, `flintnotes`): it needs no key and may do everything;
//   shell   the Windows app, over the network, with the shell's key: the notes and their vaults (new ones only inside the
//           roots, `vaultRoots`) and the programs the owner allowed (`exec`), but nothing that belongs to the server itself;
//   phone   a phone (a tablet, another computer) with the phones' key: the same, except opening vaults the computer has
//           not already opened, and forgetting them.
// The network listener sits on a port of its own. Such a request comes from another machine, so it must show it may: the
// address that `flintnotes pair` (or the settings' QR code) gives carries a key, and the page it opens keeps the key as a
// cookie. Without one there is only a page saying where to get it. A new key shuts out everything let in with the old.
const PHONE_PORT = 4620
/** The cookie each key is kept in: a browser holds both when it is the shell and has also opened a phone's link. */
const COOKIES = { shell: 'flint-shell', phone: 'flint-key' } as const
let phoneServer: Server | null = null
let phoneError: string | null = null
/** Whether the network listener is on: as a service whenever a key exists; otherwise when the settings turned the phones' access on. */
const phoneOn = () => (SERVICE ? !!(config.shell?.key || config.phone?.key) : !!config.phone?.key && !!config.phone.on)
const phonePort = () => config.phone?.port ?? PHONE_PORT
/** FLINT_BIND (a service's unit file) wins over the config; an address that is none falls back to every card. */
const phoneHost = () => (process.env.FLINT_BIND && net.isIP(process.env.FLINT_BIND) ? process.env.FLINT_BIND : config.phone?.host ?? '0.0.0.0')
const tierOf = (c: Context): Tier => (c.env as { tier?: Tier } | undefined)?.tier ?? 'admin'
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
const sameKey = (given: string, key: string) => given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))
/** The key of a tier, when it has one (a phone's counts only when phones are let in). */
const keyOf = (tier: 'shell' | 'phone'): string | undefined => (tier === 'shell' ? config.shell?.key : config.phone?.key && (SERVICE || config.phone.on) ? config.phone.key : undefined)

/** The addresses of this computer in the home network: the usual home ranges first, the virtual adapters of containers, VPNs and virtual machines last. */
function homeAddresses(): string[] {
  const VIRTUAL = /VirtualBox|VMware|docker|br-|veth|virbr|tun|tap|wg|zt|Tailscale|VPN/i
  // A virtual machine's adapter may be named like a real one: its maker's MAC prefix, or the subnet its program
  // gives by default (VirtualBox 192.168.56.*, Docker Machine 192.168.99.*), tells it apart from the real network.
  const VIRTUAL_MAC = /^(0a:00:27|08:00:27|00:50:56|00:0c:29|00:05:69|00:1c:14|00:15:5d|02:42:)/i
  const VIRTUAL_NET = /^192\.168\.(56|99)\./
  const virtual = (name: string, ip: string, mac: string) => VIRTUAL.test(name) || VIRTUAL_MAC.test(mac) || VIRTUAL_NET.test(ip)
  const rank = (name: string, ip: string, mac: string) => (virtual(name, ip, mac) ? 10 : 0) + (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3)
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).filter((one) => one.family === 'IPv4' && !one.internal && !one.address.startsWith('169.254.')).map((one) => ({ ip: one.address, rank: rank(name, one.address, one.mac) })))
    .sort((a, b) => a.rank - b.rank)
    .map((one) => one.ip)
}

const LOCKED_PAGE = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FlintNotes</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;font:16px/1.5 system-ui,sans-serif;color:#333;background:#fafafa;text-align:center">
<div style="max-width:340px;padding:24px">
<h1 style="font-size:22px;margin:0 0 12px">Нужен ключ</h1>
<p>Ссылку с ключом показывает команда <code>flintnotes pair</code> на сервере (или Настройки → Программа → «Телефон» в FlintNotes на самом компьютере): откройте её или наведите камеру на QR-код.</p></div></body></html>`

/**
 * Askers who showed a wrong key lately, by address: a key is not to be guessed at, however fast the network is. Guessing
 * means trying different keys, so each wrong one counts once: a browser that keeps showing the same stale cookie (the key
 * was changed) is not shut out for it, and a request that shows no key at all counts for nothing.
 */
const failures = new Map<string, { count: number; since: number; seen: Set<string> }>()
const FAILURE_LIMIT = 10
const FAILURE_WINDOW = 60_000
const tooMany = (who: string) => {
  const seen = failures.get(who)
  if (seen && Date.now() - seen.since > FAILURE_WINDOW) failures.delete(who)
  return (failures.get(who)?.count ?? 0) >= FAILURE_LIMIT
}
const failed = (who: string, shown: string) => {
  const seen = failures.get(who)
  if (seen && Date.now() - seen.since <= FAILURE_WINDOW) {
    if (seen.seen.has(shown) || seen.seen.size > 100) return
    seen.seen.add(shown)
    seen.count++
  } else {
    if (failures.size > 5000) failures.clear()
    failures.set(who, { count: 1, since: Date.now(), seen: new Set([shown]) })
  }
}

/** What a network client's request goes through before the app's own handling: the key, from the address or a cookie. */
function lanFetch(req: Request, env: object): Response | Promise<Response> {
  if (!phoneOn()) return new Response('FlintNotes: доступ по сети выключен', { status: 503 })
  const url = new URL(req.url)
  // Which program and protocol this is: told to anyone, so that a client can see what it has reached before it asks for the key.
  if (req.method === 'GET' && url.pathname === '/api/build') return app.fetch(req, { ...env, tier: 'phone' })
  const who = (env as { incoming?: { socket?: { remoteAddress?: string } } }).incoming?.socket?.remoteAddress ?? '?'
  const locked = (shown = '') => {
    if (shown) failed(who, shown)
    return new Response(LOCKED_PAGE, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  if (tooMany(who)) return new Response('Слишком много неверных ключей: подождите минуту', { status: 429, headers: { 'retry-after': '60' } })
  const tiers = ['shell', 'phone'] as const
  const given = url.searchParams.get('key')
  if (given !== null) {
    const tier = tiers.find((one) => keyOf(one) && sameKey(given, keyOf(one)!))
    if (!tier) return locked(given)
    // The key leaves the address (and the history of the browser) for a cookie.
    url.searchParams.delete('key')
    return new Response(null, { status: 302, headers: { location: url.pathname + url.search, 'set-cookie': `${COOKIES[tier]}=${keyOf(tier)}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Strict`, 'cache-control': 'no-store' } })
  }
  const cookies = req.headers.get('cookie') ?? ''
  const shown = (one: 'shell' | 'phone') => new RegExp(`(?:^|;\\s*)${COOKIES[one]}=([^;]*)`).exec(cookies)?.[1] ?? ''
  const tier = tiers.find((one) => {
    const key = keyOf(one)
    return key && sameKey(shown(one), key)
  })
  return tier ? app.fetch(req, { ...env, tier }) : locked(shown('shell') || shown('phone'))
}

/** Starts, moves or stops the network listener as the settings say; done once it listens or has failed. */
async function listenPhone(): Promise<void> {
  const old = phoneServer
  phoneServer = null
  phoneError = null
  if (old) await new Promise<void>((done) => (old.close(() => done()), old.closeAllConnections()))
  if (!phoneOn()) return
  const wanted = phonePort()
  await new Promise<void>((done) => {
    const server = serve({ fetch: lanFetch, port: wanted, hostname: phoneHost() }, () => {
      console.log(`Для телефона и приложения: ${phoneAddresses(wanted).join(', ') || `порт ${wanted}`}`)
      done()
    }) as Server
    server.on('error', (err: NodeJS.ErrnoException) => {
      phoneError = err.code === 'EADDRINUSE' ? `Порт ${wanted} занят другой программой` : err.message
      console.error(`Доступ по сети: ${phoneError}`)
      if (phoneServer === server) phoneServer = null
      done()
    })
    phoneServer = server
  })
}

/** The addresses a client can open: bound to one address, only that one; bound to every card, the computer's own. */
const phoneAddresses = (on: number) => (phoneHost() === '0.0.0.0' ? homeAddresses() : [phoneHost()]).map((ip) => `http://${ip}:${on}`)
const phoneInfo = () => ({ on: phoneOn(), port: phonePort(), error: phoneError, key: config.phone?.key ?? null, addresses: phoneAddresses(phonePort()) })

api.get('/phone', (c) => c.json(phoneInfo()))

const sameOrigin = (c: Context) => {
  const origin = c.req.header('origin')
  if (!origin || hostOf(origin) !== c.req.header('host')) throw new HTTPException(403, { message: 'Только со страницы самого приложения' })
}

api.post('/phone', async (c) => {
  sameOrigin(c)
  const body = (await c.req.json()) as { on?: unknown; port?: unknown; newKey?: unknown }
  const next = { ...config.phone }
  if (body.port !== undefined) {
    const wanted = Number(body.port)
    if (!validPort(wanted)) throw new HTTPException(400, { message: 'Порт — целое число от 1024 до 65535' })
    if (wanted === port) throw new HTTPException(400, { message: 'Этот порт у FlintNotes на компьютере; для телефона нужен другой' })
    next.port = wanted
  }
  if (typeof body.on === 'boolean') next.on = body.on
  if (body.newKey === true || !next.key) next.key = newKey()
  config.phone = next
  await remember()
  await listenPhone()
  return c.json(phoneInfo())
})

// The shell's key: read, or made anew (which shuts out every shell let in before), at the server itself by `flintnotes pair`.
api.get('/shell', (c) => c.json({ ...phoneInfo(), key: config.shell?.key ?? null }))

api.post('/shell', async (c) => {
  sameOrigin(c)
  const body = (await c.req.json().catch(() => ({}))) as { newKey?: unknown }
  if (body.newKey === true || !config.shell?.key) config.shell = { key: newKey() }
  await remember()
  await listenPhone()
  return c.json({ ...phoneInfo(), key: config.shell.key })
})

// ---- the way to the web: the computer's proxy, none, or one given here; kept in the config with the vaults
api.get('/proxy', async (c) => {
  const computer = await computerProxy().catch(() => null)
  return c.json({ proxy: config.proxy ?? 'system', computer: computer ? `${computer.protocol}//${computer.host}` : null })
})

api.post('/proxy', async (c) => {
  const origin = c.req.header('origin')
  if (!origin || new URL(origin).host !== c.req.header('host')) throw new HTTPException(403, { message: 'Только со страницы самого приложения' })
  const wanted = String(((await c.req.json()) as { proxy?: unknown }).proxy ?? '').trim()
  if (wanted !== 'system' && wanted !== 'off' && !parseProxy(wanted)) throw new HTTPException(400, { message: 'Адрес прокси — например http://127.0.0.1:8080 или socks5://127.0.0.1:1080 (с именем и паролем: socks5://имя:пароль@адрес:порт)' })
  config.proxy = wanted
  chooseProxy(wanted)
  await remember()
  return c.json({ proxy: wanted })
})

// ---- what a web page says about itself, for link cards
const PRIVATE = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|f[cd]|fe80)/i

// A request to the open web made for the page, which the browser would not let it make itself
// (Obsidian's `requestUrl`, used by templates). Only for the app's own page, never to this machine or the local network.
api.post('/request', async (c) => {
  const origin = c.req.header('origin')
  if (!origin || new URL(origin).host !== c.req.header('host')) throw new HTTPException(403, { message: 'Только со страницы самого приложения' })
  const { url: address, method, headers, body, contentType } = (await c.req.json()) as { url: string; method?: string; headers?: Record<string, string>; body?: string; contentType?: string }
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new HTTPException(400, { message: 'Это не адрес страницы' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HTTPException(400, { message: 'Нужен адрес http или https' })
  await openWeb(url)
  try {
    // Through the proxy chosen in the settings, as everything the server asks of the web.
    const res = await webFetch(url.href, { method: method ?? 'GET', headers: { ...(contentType ? { 'content-type': contentType } : {}), ...headers }, body, timeout: 20_000, limit: 20_000_000 })
    return c.json({ status: res.status, headers: res.headers, text: res.bytes.toString('utf8') })
  } catch {
    throw new HTTPException(502, { message: 'Адрес не ответил' })
  }
})

/**
 * Whether an address is of the open web, which the server may ask: never this machine or the local
 * network. Through a proxy the proxy finds the site, and a name this machine cannot resolve is no sign of a local one.
 */
async function openWeb(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HTTPException(400, { message: 'Нужен адрес http или https' })
  const addresses = await lookup(url.hostname, { all: true }).catch(() => [])
  if (addresses.some((a) => PRIVATE.test(a.address)) || /^(localhost|.*\.local)$/i.test(url.hostname)) throw new HTTPException(400, { message: 'Адрес недоступен' })
  if (!addresses.length && !(await viaProxy())) throw new HTTPException(400, { message: 'Адрес недоступен' })
}

/** Pictures of the web asked for lately, kept a while: a note scrolled up and down asks for the same ones again. */
const webFiles = new Map<string, { at: number; type: string; bytes: Buffer }>()
let webFilesSize = 0
const WEB_FILES_LIMIT = 64_000_000

// A file of the web (a card's picture, a picture in a note) for the page, through the way the server reaches
// the web: where a proxy is set, the browser gets pictures through it too, not only the text of pages.
api.get('/web', async (c) => {
  let url: URL
  try {
    url = new URL(c.req.query('url') ?? '')
  } catch {
    throw new HTTPException(400, { message: 'Это не адрес' })
  }
  const kept = webFiles.get(url.href)
  if (kept && Date.now() - kept.at < 3_600_000) return c.body(new Uint8Array(kept.bytes), 200, { 'content-type': kept.type, 'cache-control': 'private, max-age=86400' })
  await openWeb(url)
  let res
  try {
    // Up to a minute and 100 MB: a GIF of the web may be that large, and the page makes its light copy from it (plugin animations).
    res = await webFetch(url.href, { timeout: 60_000, limit: 100_000_000, headers: { accept: c.req.header('accept') ?? 'image/avif,image/webp,image/*,*/*;q=0.8' } })
  } catch (err) {
    throw new HTTPException(502, { message: `Не ответил: ${describe(err)}` })
  }
  const type = res.headers['content-type'] ?? 'application/octet-stream'
  if (res.status === 200 && res.bytes.length < 8_000_000) {
    webFiles.delete(url.href)
    webFiles.set(url.href, { at: Date.now(), type, bytes: res.bytes })
    webFilesSize += res.bytes.length
    // The oldest go first.
    for (const [key, file] of webFiles) {
      if (webFilesSize <= WEB_FILES_LIMIT) break
      webFiles.delete(key)
      webFilesSize -= file.bytes.length
    }
  }
  return c.body(new Uint8Array(res.bytes), res.status as 200, { 'content-type': type, 'cache-control': res.status === 200 ? 'private, max-age=86400' : 'no-store' })
})

api.get('/unfurl', async (c) => {
  let url: URL
  try {
    url = new URL(c.req.query('url') ?? '')
  } catch {
    throw new HTTPException(400, { message: 'Это не адрес страницы' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HTTPException(400, { message: 'Нужен адрес http или https' })
  // The server fetches pages of the open web only, never of this machine or the local network.
  // Through a proxy the proxy finds the site, and a name this machine cannot resolve is no sign of a local one.
  const addresses = await lookup(url.hostname, { all: true }).catch(() => [])
  if (addresses.some((a) => PRIVATE.test(a.address)) || /^(localhost|.*\.local)$/i.test(url.hostname)) throw new HTTPException(400, { message: 'Страница недоступна' })
  if (!addresses.length && !(await viaProxy())) throw new HTTPException(400, { message: 'Страница недоступна' })
  let html = ''
  let final = url.href
  // A video: its title, channel and frame, and the description under it, which its page keeps.
  if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(url.hostname)) {
    const video = await youtubeVideo(url.href).catch((err) => (console.error(`Карточка ссылки: видео ${url.href}: ${describe(err)}`), null))
    if (video?.problem) console.error(`Карточка ссылки: описание видео ${url.href} не получено: ${video.problem}`)
    if (video) return c.json({ url: url.href, title: video.title, description: video.description, author: video.author, image: video.image, favicon: 'https://www.youtube.com/favicon.ico', ...(video.problem ? { problem: video.problem } : {}) })
  }
  // Telegram answers by two names; where one is closed to this computer, the other may be open.
  const telegram = /^(www\.)?(t\.me|telegram\.me|telegram\.dog)$/i.test(url.hostname)
  const ways = [url.href]
  if (telegram) for (const host of ['t.me', 'telegram.me']) if (host !== url.hostname.replace(/^www\./, '')) ways.push(Object.assign(new URL(url.href), { hostname: host }).href)
  // Pages are asked the way a browser asks, through the computer's proxy if it has one. A slow site gets a second, longer try.
  try {
    const ask = async () => {
      let failed: unknown
      for (const way of ways) {
        try {
          return await webGet(way, { timeout: 8000 })
        } catch (err) {
          failed ??= err
        }
      }
      throw failed
    }
    const page = await ask().catch(() => webGet(url.href, { timeout: 20_000 }))
    final = page.url || url.href
    html = page.text
  } catch (err) {
    // Why exactly, in the answer and in the log: a page that opens in the browser and not here is a matter of the network.
    console.error(`Карточка ссылки: ${url.href} не ответила: ${describe(err)}`)
    throw new HTTPException(502, { message: `Страница не ответила серверу FlintNotes (${describe(err)})` })
  }
  const decode = (text: string) =>
    text.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
      const lower = code.toLowerCase()
      if (Object.hasOwn(named, lower)) return named[lower]
      const point = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10)
      return Number.isFinite(point) ? String.fromCodePoint(point) : all
    })
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined)
  const meta = new Map<string, string>()
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase()
    const content = attr(tag, 'content')
    if (key && content && !meta.has(key)) meta.set(key, decode(content).trim())
  }
  const absolute = (href: string | undefined) => {
    try {
      return href ? new URL(decode(href), final).href : ''
    } catch {
      return ''
    }
  }
  const icons = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => tag).filter((tag) => /\bicon\b/i.test(attr(tag, 'rel') ?? ''))
  let image = absolute(meta.get('og:image') ?? meta.get('twitter:image'))
  // The picture of a channel, a group or a person on Telegram, by an address that stays: the one its page
  // names is signed for a while and goes stale. A post keeps its own picture.
  const channel = telegram ? telegramName(url.pathname) : null
  if (channel && !channel.post && /(^|\.)telesco\.pe$/i.test(new URL(image || 'x:').hostname)) image = `https://t.me/i/userpic/320/${channel.name}.jpg`
  return c.json({
    url: url.href,
    title: meta.get('og:title') ?? meta.get('twitter:title') ?? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim(),
    description: (meta.get('og:description') ?? meta.get('description') ?? meta.get('twitter:description') ?? '').replace(/\s+/g, ' ').trim(),
    image,
    favicon: absolute(icons.length ? attr(icons[0], 'href') : '/favicon.ico'),
  })
})

// Why a page does not open for the server: every way to it tried, each with what came of it.
api.get('/net-check', async (c) => {
  let url: URL
  try {
    url = new URL(c.req.query('url') ?? '')
  } catch {
    throw new HTTPException(400, { message: 'Это не адрес страницы' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HTTPException(400, { message: 'Нужен адрес http или https' })
  const addresses = await lookup(url.hostname, { all: true }).catch(() => [])
  if (addresses.some((a) => PRIVATE.test(a.address))) throw new HTTPException(400, { message: 'Страница недоступна' })
  return c.json({ build: BUILD, platform: `${process.platform} ${process.arch}, Node ${process.version}`, steps: await checkWay(url.href) })
})

api.get('/plugins', async (c) => {
  const dir = path.join(root(), '.flint', 'plugins')
  const ids = await fs.readdir(dir).catch(() => [] as string[])
  const plugins: ExternalPluginInfo[] = []
  for (const id of ids) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(dir, id, 'manifest.json'), 'utf8'))
      plugins.push({ ...manifest, id })
    } catch {
      // A folder without a readable manifest is not a plugin.
    }
  }
  return c.json(plugins)
})

/** The pages that follow each vault. */
const clients = new Map<string, Set<(event: RemoteEvent) => void>>()

api.get('/events', (c) => {
  const dir = root()
  return streamSSE(c, async (stream) => {
    // What waits to be sent to this page, by the file it is about. A page that reads slowly (a tab in
    // the background, a connection gone quiet) gets the last word on each file, not a pile of every
    // change: unread events kept one by one once filled the server's memory to the last byte while
    // other programs kept writing into the vault. Past a limit the page is told to read the list anew.
    const waiting = new Map<string, RemoteEvent>()
    let behind = false
    let sending = false
    const pump = async () => {
      if (sending) return
      sending = true
      try {
        while (!stream.aborted && !stream.closed && (waiting.size || behind)) {
          if (behind) {
            behind = false
            waiting.clear()
            await stream.writeSSE({ data: JSON.stringify({ type: 'resync' } satisfies RemoteEvent) })
            continue
          }
          const batch = [...waiting.values()]
          waiting.clear()
          // Each write waits until the page has taken the one before.
          for (const event of batch) await stream.writeSSE({ data: JSON.stringify(event) })
        }
      } catch {
        // The page went away; its listener is taken off below.
      } finally {
        sending = false
      }
    }
    const send = (event: RemoteEvent) => {
      const key = event.type === 'upsert' ? event.entry.path : event.type === 'delete' ? event.path : `:${event.type}`
      waiting.delete(key)
      waiting.set(key, event)
      if (waiting.size > 5000) {
        waiting.clear()
        behind = true
      }
      void pump()
    }
    const listeners = clients.get(dir) ?? clients.set(dir, new Set()).get(dir)!
    listeners.add(send)
    stream.onAbort(() => void listeners.delete(send))
    // Which build answers: a page made by an older one reloads itself (see the launcher).
    send({ type: 'hello', build: BUILD, updates: !!process.env.FLINT_LAUNCHER })
    while (!stream.aborted && !stream.closed) {
      await stream.sleep(30_000)
      await stream.writeSSE({ event: 'ping', data: '' })
    }
    listeners.delete(send)
  })
})

const broadcast = (dir: string, event: RemoteEvent) => clients.get(dir)?.forEach((send) => send(event))

// A vault on a network disk (SMB, NFS) delivers no file events: FLINT_POLL=1 looks for changes by polling.
const needsPolling = () => !!process.env.FLINT_POLL && process.env.FLINT_POLL !== '0'

const watchers = new Map<string, { close(): unknown }>()

const isHiddenIn = (dir: string, abs: string) =>
  path
    .relative(dir, abs)
    .split(path.sep)
    .some((part) => part.startsWith('.'))

/** Follows changes in a vault's folder, from the first time the vault is asked for. */
function watch(dir: string): void {
  if (watchers.has(dir)) return
  // The system watches the whole tree (inotify, one watch per folder); only a disk that gives no events (FLINT_POLL) is polled.
  watchers.set(dir, needsPolling() ? watchByPolling(dir) : watchNatively(dir))
}

const upsert = (dir: string, entry: VaultEntry) => {
  trees.upsert(dir, entry)
  broadcast(dir, { type: 'upsert', entry })
}
const remove = (dir: string, rel: string) => {
  trees.remove(dir, rel)
  broadcast(dir, { type: 'delete', path: rel })
}

// A folder that cannot be watched (no access, or a watched folder being deleted)
// only loses its live updates. Unhandled, this error would stop the whole server.
const watchFailed = (dir: string) => (err: unknown) => {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'ENOENT') return
  console.error(`Слежение за папкой ${dir}:`, err)
}

/**
 * The system watches a whole tree by itself: one watch per folder, ready at once. Chokidar sets a watch on every
 * file: on a vault of 75 000 files (5 000 folders) that was 67 000 watches, the whole per-user allowance
 * (fs.inotify.max_user_watches), a first tree after 17 s instead of 5 and half the memory.
 */
function watchNatively(dir: string): { close(): unknown } {
  // The system reports a write several times over; each path is looked at once things settle.
  const pending = new Map<string, NodeJS.Timeout>()
  const look = async (abs: string) => {
    pending.delete(abs)
    const rel = toRel(abs, dir)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat) return remove(dir, rel)
    upsert(dir, toEntry(abs, stat, dir))
    // A folder moved in from elsewhere comes as one event, without its contents.
    if (stat.isDirectory()) for (const entry of await walk(abs, dir)) upsert(dir, entry)
  }
  const watcher = fsWatch(dir, { recursive: true }, (_event, name) => {
    if (!name) return
    const abs = path.join(dir, name.toString())
    if (isHiddenIn(dir, abs)) return
    clearTimeout(pending.get(abs))
    pending.set(abs, setTimeout(() => void look(abs).catch(watchFailed(dir)), 100))
  })
  watcher.on('error', watchFailed(dir))
  // There is no first look to wait for: the list of files is walked once, when first asked for.
  trees.ready(dir)
  return watcher
}

/** A vault on a network disk (SMB, NFS) gives no events: FLINT_POLL=1 has chokidar look at every file, every second or three. */
function watchByPolling(dir: string): { close(): unknown } {
  return chokidar
    .watch(dir, { ignored: (abs: string) => isHiddenIn(dir, abs), ignoreInitial: true, usePolling: true, interval: 1000, binaryInterval: 3000 })
    .on('all', async (event, abs) => {
      if (abs === dir) return
      if (event === 'unlink' || event === 'unlinkDir') return remove(dir, toRel(abs, dir))
      const stat = await fs.stat(abs).catch(() => null)
      if (stat) upsert(dir, toEntry(abs, stat, dir))
    })
    .on('ready', () => trees.ready(dir))
    .on('error', watchFailed(dir))
}

watch(defaultRoot)

const app = new Hono()

/** Requests that change something, still being answered: a server stepping aside lets them finish. */
let writes = 0
app.use(async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next()
  writes++
  try {
    await next()
  } finally {
    writes--
  }
})

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.text(err.message, err.status)
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') return c.text('File not found', 404)
  // The page went away while sending (a tab closed or reloaded mid-save; a browser may drop the
  // connection outright). Nobody is left to answer, and the server is fine.
  if (c.req.raw.signal.aborted || (err as NodeJS.ErrnoException).code === 'ECONNRESET') return c.body(null, 499 as 400)
  console.error(err)
  return c.text(err.message, 500)
})

// What this server is (the shell reads it before it shows the key; see `lanFetch`). Before `app.route`, which copies the routes it has.
api.get('/build', (c) => c.json({ version: VERSION, protocol: PROTOCOL, build: BUILD } satisfies BuildInfo))

app.route('/api', api)

// The built app: next to this file in a release, in `dist` when run from the sources.
const here = path.dirname(fileURLToPath(import.meta.url))
/** The build this server belongs to: `npm run release` writes it next to the server last. From the sources, `dev`. */
const buildFile: { id?: string; version?: string } = (() => {
  try {
    return JSON.parse(readFileSync(path.join(here, 'build.json'), 'utf8'))
  } catch {
    return {}
  }
})()
const BUILD: string = buildFile.id ?? 'dev'
const VERSION: string = buildFile.version ?? 'dev'
// FLINT_STATIC points at another build, e.g. an unminified one for profiling.
const staticDir = [process.env.FLINT_STATIC ?? '', path.join(here, 'public'), path.resolve('dist')].find((dir) => dir && existsSync(path.join(dir, 'index.html')))

app.get('*', async (c) => {
  if (!staticDir) return c.text('Приложение не собрано: выполните `npm run build`.', 404)
  const wanted = path.join(staticDir, decodeURIComponent(new URL(c.req.url).pathname))
  const inside = isInside(staticDir, wanted)
  const isFile = inside && (await fs.stat(wanted).catch(() => null))?.isFile()
  // Any other address is a place inside the app, which the app itself resolves.
  const file = isFile ? wanted : path.join(staticDir, 'index.html')
  const ext = path.extname(file).slice(1).toLowerCase()
  return c.body(new Uint8Array(await fs.readFile(file)), 200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Files under /assets carry a hash of their content in the name, so they never change.
    'cache-control': isFile && wanted.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
})

const started = (where: string) => () => {
  console.log(`FlintNotes: ${where}`)
  console.log(`Хранилище: ${defaultRoot}${needsPolling() ? ' (опрос изменений)' : ''}`)
  if (!staticDir) console.log('Приложение не собрано: выполните `npm run build` или запустите `npm run dev`.')
}

// This one answers the server's own computer only (the browser there, `flintnotes`); the network's listener is below.
const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, started(`http://localhost:${port}`)) as Server
void listenPhone()

// The port is taken: most likely FlintNotes is running already (a second start). Then there is nothing to do; the one
// that runs serves the notes.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err
  const url = `http://localhost:${port}`
  void fetch(`${url}/api/build`, { signal: AbortSignal.timeout(3000) })
    .then((res) => res.json())
    .then((answer: { protocol?: unknown }) => {
      if (typeof answer?.protocol !== 'number') throw new Error('not FlintNotes')
      console.log(`FlintNotes уже запущен: ${url}`)
      setTimeout(() => process.exit(0), 300)
    })
    .catch(() => {
      console.error(`Порт ${port} занят другой программой. Укажите другой в ${CONFIG}: "port": 4601`)
      process.exit(1)
    })
})

// ---- stepping aside: the launcher (release/launcher.mjs) asks for it when a new build is ready
let stopping = false
async function stop(): Promise<void> {
  // A second word to stop (a signal on top of the launcher's message) must not run the same drain twice.
  if (stopping) return
  stopping = true
  server.close()
  phoneServer?.close()
  // Saves that have begun are let finish: a note cut off mid-write would be lost.
  for (const until = Date.now() + 5000; writes > 0 && Date.now() < until; ) await new Promise((resume) => setTimeout(resume, 50))
  // The lists of files as they are now, for the next start.
  await Promise.race([trees.flush(), new Promise((resume) => setTimeout(resume, 2000))])
  process.exit(0)
}
process.on('message', (message) => message === 'stop' && void stop())
// The launcher is gone (stopped, or the user signed out): the server goes with it instead of holding the port.
process.on('disconnect', () => void stop())
// A service manager (systemd) stops a program with SIGTERM, a terminal with SIGINT: the same orderly stop, so that a save
// begun is finished and the list of files kept, rather than the program being cut off.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void stop())
