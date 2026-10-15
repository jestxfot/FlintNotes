import { serve } from '@hono/node-server'
import chokidar from 'chokidar'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { stream, streamSSE } from 'hono/streaming'
import { AsyncLocalStorage } from 'node:async_hooks'
import { exec, execFile, spawn } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { existsSync, readFileSync, watch as fsWatch, type Stats } from 'node:fs'
import fs from 'node:fs/promises'
import type { Server } from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExternalPluginInfo, RemoteEvent, VaultEntry, VaultInfo } from '../shared/protocol'
import { TreeCache } from './tree-cache'

// The vaults the user has opened are remembered between runs, outside any vault.
const CONFIG = process.env.FLINT_CONFIG ?? path.join(os.homedir(), '.flintnotes.json')

interface Config {
  vaults: string[]
  current?: string
  /** The port the server listens on; chosen in the settings. */
  port?: number
  /** Programs that templates of a vault may run, by vault folder; see `/system-commands`. */
  systemCommands?: Record<string, SystemCommands>
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
      systemCommands: data.systemCommands && typeof data.systemCommands === 'object' ? data.systemCommands : undefined,
    }
  } catch {
    return { vaults: [] }
  }
}

const DEFAULT_PORT = 4600
const validPort = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65535

const config = await readConfig()
// FLINT_PORT (tests, development) wins over the port chosen in the settings; then that port can not be changed from the app.
const fixedPort = process.env.FLINT_PORT ? Number(process.env.FLINT_PORT) : undefined
let port = fixedPort ?? config.port ?? DEFAULT_PORT
// A vault named on the command line wins over the one used last time.
let defaultRoot = path.resolve(process.argv[2] ?? process.env.FLINT_VAULT ?? config.current ?? 'vault')
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
}

const toRel = (abs: string, base = root()) => path.relative(base, abs).split(path.sep).join('/')

const toEntry = (abs: string, stat: Stats, base = root()): VaultEntry => ({
  path: toRel(abs, base),
  kind: stat.isDirectory() ? 'folder' : 'file',
  size: stat.isDirectory() ? 0 : stat.size,
  mtime: stat.mtimeMs,
  // Some filesystems (Windows drives under WSL) do not report a creation time;
  // the earliest time known for the file stands in for it.
  ctime: stat.birthtimeMs || Math.min(stat.mtimeMs, stat.ctimeMs),
})

/** Resolves a vault-relative path, refusing anything that escapes the vault. */
function resolveInVault(rel: string | undefined, allowRoot = false): string {
  if (rel === undefined) throw new HTTPException(400, { message: 'Missing path' })
  const abs = path.resolve(root(), rel)
  const inside = abs.startsWith(root() + path.sep) || (allowRoot && abs === root())
  if (!inside) throw new HTTPException(400, { message: 'Path is outside the vault' })
  return abs
}

const target = (c: Context) => resolveInVault(c.req.query('path'))

/** The lists of the vaults' files, kept current by their watchers. */
const trees = new TreeCache((dir) => walk(dir))

/**
 * Every file and folder under `dir`, with paths relative to the vault `base`. What the system will
 * not let us read (a protected folder, a file held open by another program, a cloud placeholder on
 * Windows) is left out instead of failing the whole vault; only the vault's own folder must be readable.
 */
async function walk(dir: string, base = dir): Promise<VaultEntry[]> {
  const listed = await fs.readdir(dir, { withFileTypes: true }).catch((err) => {
    if (dir === base) throw err
    return []
  })
  const dirents = listed.filter((d) => !d.name.startsWith('.') && (d.isDirectory() || d.isFile()))
  const nested = await Promise.all(
    dirents.map(async (d) => {
      const abs = path.join(dir, d.name)
      const stat = await fs.stat(abs).catch(() => null)
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

api.use(async (c, next) => {
  if (!isLocal(`http://${c.req.header('host') ?? ''}`)) throw new HTTPException(403, { message: 'Forbidden host' })
  const origin = c.req.header('origin')
  if (origin && !isLocal(origin)) throw new HTTPException(403, { message: 'Forbidden origin' })
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
  return c.json({ name: vaultName(root()), path: root(), obsidianConfigs: await obsidianConfigs() })
})

const vaultInfo = (dir: string): VaultInfo => ({ path: dir, name: vaultName(dir), current: dir === root(), exists: existsSync(dir) })

api.get('/vaults', (c) => c.json(config.vaults.map(vaultInfo)))

// Makes a folder known as a vault. Pages already open stay on their own vaults; the page that asked goes to the new one by its address.
api.post('/vaults/open', async (c) => {
  const body = await c.req.json<{ path: string; create?: boolean }>()
  if (!body.path?.trim() || !path.isAbsolute(body.path.trim())) {
    throw new HTTPException(400, { message: 'Укажите полный путь к папке, например D:\\Заметки' })
  }
  const dir = path.resolve(body.path.trim())
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

api.get('/tree', async (c) => c.json(await trees.list(root())))

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
  return c.body(new Uint8Array(await fs.readFile(abs)), 200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
})

// Files are written in place rather than via temp file + rename: a replaced file
// would lose its creation time, which notes expose as `file.ctime`.
api.put('/file', async (c) => {
  const abs = target(c)
  if (c.req.query('create') && existsSync(abs)) {
    throw new HTTPException(409, { message: 'Already exists' })
  }
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, new Uint8Array(await c.req.arrayBuffer()))
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

// Shows a file or folder in the system's file manager (Explorer, Finder, ...).
api.post('/reveal', async (c) => {
  const abs = resolveInVault(c.req.query('path') ?? '', true)
  if (!existsSync(abs)) throw new HTTPException(404, { message: 'File not found' })
  // Explorer wants `/select,"path"` exactly so; Node's own quoting would break it.
  const explorer = (winPath: string, isRoot: boolean): [string, string[], object] => ['explorer.exe', isRoot ? [`"${winPath}"`] : [`/select,"${winPath}"`], { windowsVerbatimArguments: true }]
  let launch: [string, string[], object]
  if (process.platform === 'win32') launch = explorer(abs, abs === root())
  else if (process.platform === 'darwin') launch = ['open', abs === root() ? [abs] : ['-R', abs], {}]
  else if (process.env.WSL_DISTRO_NAME) {
    // Under WSL the file manager is Windows Explorer, which needs the path in its Windows form.
    const winPath = await new Promise<string>((resolve, reject) =>
      execFile('wslpath', ['-w', abs], (err, out) => (err ? reject(new HTTPException(500, { message: 'Не удалось получить путь Windows (wslpath)' })) : resolve(out.trim()))),
    )
    launch = explorer(winPath, abs === root())
  } else launch = ['xdg-open', [abs === root() ? abs : path.dirname(abs)], {}]
  const [command, args, options] = launch
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', ...options })
    child.on('error', (err) => {
      console.error(`Показать в проводнике: не удалось запустить ${command}: ${err.message}`)
      reject(new HTTPException(500, { message: `Не удалось запустить ${command}: ${err.message}` }))
    })
    // Explorer reports failure even when it opens the window, so starting is all that is checked.
    child.on('spawn', () => resolve())
    child.unref()
  })
  console.log(`Показать в проводнике: ${command} ${args.join(' ')}`)
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
    exec(command, { cwd: root(), timeout, env: { ...process.env, ...variables }, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new HTTPException(500, { message: (stderr || err.message).trim().slice(0, 500) }))
      else resolve(stdout)
    })
  })
  return c.json({ output: output.trimEnd() })
})

// ---- starting with the computer: a small file where the system looks for programs to run at sign-in
const AUTOSTART_DIR = process.env.FLINT_AUTOSTART_DIR
function autostart(): { file: string; text: string; encoding: BufferEncoding } | { reason: string } {
  const script = process.argv[1] ? path.resolve(process.argv[1]) : ''
  if (!script) return { reason: 'Не удалось определить, откуда запущен сервер' }
  // The same Node and the same program as now; the vault is the one opened last, so no folder is named.
  // Started by the launcher, the launcher itself: it keeps the server up and puts new builds in place.
  const launcher = process.env.FLINT_LAUNCHER
  const command = launcher ? [process.execPath, launcher] : [process.execPath, ...process.execArgv, script]
  if (process.platform === 'win32') {
    const dir = AUTOSTART_DIR ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
    // A script for Windows Script Host: it starts the server with no window. Doubled quotes are how VBScript writes a quote.
    const line = command.map((part) => `""${part}""`).join(' ')
    return { file: path.join(dir, 'FlintNotes.vbs'), text: `' FlintNotes: запускает сервер заметок при входе в Windows. Создан в настройках приложения; удалите файл, чтобы отключить.\r\nCreateObject("WScript.Shell").Run "${line}", 0, False\r\n`, encoding: 'utf16le' }
  }
  if (process.platform === 'darwin') {
    const dir = AUTOSTART_DIR ?? path.join(os.homedir(), 'Library', 'LaunchAgents')
    const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    return {
      file: path.join(dir, 'com.flintnotes.server.plist'),
      text: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.flintnotes.server</string>\n<key>ProgramArguments</key><array>${command.map((part) => `<string>${escape(part)}</string>`).join('')}</array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n`,
      encoding: 'utf8',
    }
  }
  if (!AUTOSTART_DIR && /microsoft/i.test(os.release())) return { reason: 'Сервер запущен внутри WSL: автозапуск настраивается в самой Windows (запустите FlintNotes.vbs и включите настройку там)' }
  const dir = AUTOSTART_DIR ?? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'autostart')
  const quoted = command.map((part) => `"${part.replace(/(["\\$`])/g, '\\$1')}"`).join(' ')
  return { file: path.join(dir, 'flintnotes.desktop'), text: `[Desktop Entry]\nType=Application\nName=FlintNotes\nComment=Сервер заметок FlintNotes\nExec=${quoted}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`, encoding: 'utf8' }
}

api.get('/autostart', (c) => {
  const entry = autostart()
  return c.json('reason' in entry ? { supported: false, enabled: false, reason: entry.reason } : { supported: true, enabled: existsSync(entry.file), file: entry.file })
})

api.post('/autostart', async (c) => {
  const origin = c.req.header('origin')
  if (!origin || new URL(origin).host !== c.req.header('host')) throw new HTTPException(403, { message: 'Только со страницы самого приложения' })
  const { enabled } = (await c.req.json()) as { enabled: boolean }
  const entry = autostart()
  if ('reason' in entry) throw new HTTPException(400, { message: entry.reason })
  if (enabled) {
    await fs.mkdir(path.dirname(entry.file), { recursive: true })
    // Windows Script Host reads names in any language only from a file that starts with this mark.
    await fs.writeFile(entry.file, entry.encoding === 'utf16le' ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(entry.text, 'utf16le')]) : entry.text)
  } else await fs.rm(entry.file, { force: true })
  return c.json({ supported: true, enabled, file: entry.file })
})

// ---- stopping from the app: with no window of its own, this is how FlintNotes is turned off
api.post('/quit', (c) => {
  const origin = c.req.header('origin')
  if (!origin || new URL(origin).host !== c.req.header('host')) throw new HTTPException(403, { message: 'Только со страницы самого приложения' })
  console.log('Остановлен из приложения')
  // The answer leaves first. Exiting with 0 tells the launcher not to start the server again.
  setTimeout(() => void stop(), 200)
  return c.json({ stopping: true })
})

// ---- the port: chosen in the settings, kept in the config with the vaults
api.get('/port', (c) => c.json({ port, fixed: fixedPort !== undefined }))

const isFree = (wanted: number) =>
  new Promise<boolean>((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(wanted, '127.0.0.1', () => probe.close(() => resolve(true)))
  })

api.post('/port', async (c) => {
  const origin = c.req.header('origin')
  if (!origin || new URL(origin).host !== c.req.header('host')) throw new HTTPException(403, { message: 'Только со страницы самого приложения' })
  const wanted = Number(((await c.req.json()) as { port?: unknown }).port)
  if (fixedPort !== undefined) throw new HTTPException(400, { message: `Порт задан при запуске (FLINT_PORT=${fixedPort}) и отсюда не меняется` })
  if (!validPort(wanted)) throw new HTTPException(400, { message: 'Порт — целое число от 1024 до 65535' })
  if (wanted !== port && !(await isFree(wanted))) throw new HTTPException(409, { message: `Порт ${wanted} занят другой программой` })
  config.port = wanted
  await remember()
  // The answer leaves first; then the server moves, and the page follows it to the new address.
  if (wanted !== port) setTimeout(() => listenOn(wanted), 200)
  return c.json({ port: wanted })
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
  const addresses = await lookup(url.hostname, { all: true }).catch(() => [])
  if (!addresses.length || addresses.some((a) => PRIVATE.test(a.address))) throw new HTTPException(400, { message: 'Адрес недоступен' })
  try {
    const res = await fetch(url, {
      method: method ?? 'GET',
      headers: { ...(contentType ? { 'content-type': contentType } : {}), ...headers },
      body: method && method.toUpperCase() !== 'GET' ? body : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    if (text.length > 20_000_000) throw new Error('too large')
    return c.json({ status: res.status, headers: Object.fromEntries(res.headers), text })
  } catch {
    throw new HTTPException(502, { message: 'Адрес не ответил' })
  }
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
  const addresses = await lookup(url.hostname, { all: true }).catch(() => [])
  if (!addresses.length || addresses.some((a) => PRIVATE.test(a.address))) throw new HTTPException(400, { message: 'Страница недоступна' })
  let html = ''
  let final = url.href
  // A video site answers a plain question about a video (its name, its channel, its frame) far more
  // surely than its page does, which is heavy and often asks for consent first.
  if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(url.hostname)) {
    try {
      const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.href)}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const video = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string }
        if (video.title) return c.json({ url: url.href, title: video.title, description: video.author_name ?? '', image: video.thumbnail_url ?? '', favicon: 'https://www.youtube.com/favicon.ico' })
      }
    } catch {
      // The page itself is asked below.
    }
  }
  // Pages are asked the way a browser asks: many sites turn anything else away. A slow site gets a second, longer try.
  const ask = (timeout: number) =>
    fetch(url, {
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'accept-language': 'ru,en;q=0.8',
      },
    })
  try {
    const res = await ask(8000).catch(() => ask(20_000))
    final = res.url || url.href
    // The head of the page is enough; a huge page is not read to the end.
    const reader = res.body?.getReader()
    const decoder = new TextDecoder()
    while (reader && html.length < 600_000) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
    }
    void reader?.cancel().catch(() => {})
  } catch {
    throw new HTTPException(502, { message: 'Страница не ответила' })
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
  return c.json({
    url: url.href,
    title: meta.get('og:title') ?? meta.get('twitter:title') ?? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim(),
    description: (meta.get('og:description') ?? meta.get('description') ?? meta.get('twitter:description') ?? '').replace(/\s+/g, ' '),
    image: absolute(meta.get('og:image') ?? meta.get('twitter:image')),
    favicon: absolute(icons.length ? attr(icons[0], 'href') : '/favicon.ico'),
  })
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
    const send = (event: RemoteEvent) => void stream.writeSSE({ data: JSON.stringify(event) })
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

// Windows drives mounted into WSL (/mnt/c, ...) deliver no file events, so poll there.
const needsPolling = (dir = root()) => (process.env.FLINT_POLL ? process.env.FLINT_POLL !== '0' : /^\/mnt\/[a-z]\//.test(`${dir}/`))

const watchers = new Map<string, { close(): unknown }>()

const isHiddenIn = (dir: string, abs: string) =>
  path
    .relative(dir, abs)
    .split(path.sep)
    .some((part) => part.startsWith('.'))

/** Follows changes in a vault's folder, from the first time the vault is asked for. */
function watch(dir: string): void {
  if (watchers.has(dir)) return
  // FLINT_WATCH=native tries the Windows way elsewhere too (tests on Linux).
  const native = process.env.FLINT_WATCH === 'native' || ((process.platform === 'win32' || process.platform === 'darwin') && !needsPolling(dir))
  watchers.set(dir, native ? watchNatively(dir) : watchWithChokidar(dir))
}

const upsert = (dir: string, entry: VaultEntry) => {
  trees.upsert(dir, entry)
  broadcast(dir, { type: 'upsert', entry })
}
const remove = (dir: string, rel: string) => {
  trees.remove(dir, rel)
  broadcast(dir, { type: 'delete', path: rel })
}

// A folder that cannot be watched (no access; on Windows also a watched folder being deleted)
// only loses its live updates. Unhandled, this error would stop the whole server.
const watchFailed = (dir: string) => (err: unknown) => {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'ENOENT') return
  console.error(`Слежение за папкой ${dir}:`, err)
}

/**
 * Windows and macOS watch a whole tree by themselves: one handle, ready at once. Chokidar would
 * first look at every file and set a watcher on each, which in a vault of tens of thousands of
 * files keeps the server busy for minutes, and the page waits all that time.
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

/** Elsewhere (Linux, and Windows drives under WSL, which have to be polled) chokidar does the watching. */
function watchWithChokidar(dir: string): { close(): unknown } {
  return chokidar
    .watch(dir, { ignored: (abs: string) => isHiddenIn(dir, abs), ignoreInitial: true, usePolling: needsPolling(dir), interval: 1000, binaryInterval: 3000 })
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
  // The page went away while sending (a tab closed or reloaded mid-save; on Windows the browser
  // drops the connection outright). Nobody is left to answer, and the server is fine.
  if (c.req.raw.signal.aborted || (err as NodeJS.ErrnoException).code === 'ECONNRESET') return c.body(null, 499 as 400)
  console.error(err)
  return c.text(err.message, 500)
})

app.route('/api', api)

// The built app: next to this file in a release, in `dist` when run from the sources.
const here = path.dirname(fileURLToPath(import.meta.url))
/** The build this server belongs to: `npm run release` writes it next to the server last. From the sources, `dev`. */
const BUILD: string = (() => {
  try {
    return JSON.parse(readFileSync(path.join(here, 'build.json'), 'utf8')).id
  } catch {
    return 'dev'
  }
})()
// FLINT_STATIC points at another build, e.g. an unminified one for profiling.
const staticDir = [process.env.FLINT_STATIC ?? '', path.join(here, 'public'), path.resolve('dist')].find((dir) => dir && existsSync(path.join(dir, 'index.html')))

app.get('*', async (c) => {
  if (!staticDir) return c.text('Приложение не собрано: выполните `npm run build`.', 404)
  const wanted = path.join(staticDir, decodeURIComponent(new URL(c.req.url).pathname))
  const inside = wanted.startsWith(staticDir + path.sep)
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

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`FlintNotes: http://localhost:${port}`)
  console.log(`Хранилище: ${defaultRoot}${needsPolling(defaultRoot) ? ' (опрос изменений)' : ''}`)
  if (!staticDir) console.log('Приложение не собрано: выполните `npm run build` или запустите `npm run dev`.')
}) as Server

/** Moves the server to another port: the pages open now lose their connection and go to the new address themselves. */
function listenOn(next: number): void {
  port = next
  server.close(() => server.listen(port, '127.0.0.1', () => console.log(`FlintNotes теперь на http://localhost:${port}`)))
  server.closeAllConnections()
}

// The port is taken: most likely FlintNotes is running already (started with the computer or a second
// double-click). Then there is nothing to do; the one that runs serves the notes.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err
  const url = `http://localhost:${port}`
  void fetch(`${url}/api/autostart`, { signal: AbortSignal.timeout(3000) })
    .then((res) => res.json())
    .then((answer: { supported?: unknown }) => {
      if (typeof answer?.supported !== 'boolean') throw new Error('not FlintNotes')
      console.log(`FlintNotes уже запущен: ${url}`)
      setTimeout(() => process.exit(0), 300)
    })
    .catch(() => {
      console.error(`Порт ${port} занят другой программой. Укажите другой в ${CONFIG}: "port": 4601`)
      process.exit(1)
    })
})

// ---- stepping aside: the launcher (release/launcher.mjs) asks for it when a new build is ready
async function stop(): Promise<void> {
  server.close()
  // Saves that have begun are let finish: a note cut off mid-write would be lost.
  for (const until = Date.now() + 5000; writes > 0 && Date.now() < until; ) await new Promise((resume) => setTimeout(resume, 50))
  process.exit(0)
}
process.on('message', (message) => message === 'stop' && void stop())
// The launcher is gone (stopped, or the user signed out): the server goes with it instead of holding the port.
process.on('disconnect', () => void stop())
