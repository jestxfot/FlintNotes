import { serve } from '@hono/node-server'
import chokidar from 'chokidar'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { stream, streamSSE } from 'hono/streaming'
import { exec, execFile, spawn } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { existsSync, type Stats } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExternalPluginInfo, RemoteEvent, VaultEntry, VaultInfo } from '../shared/protocol'

const port = Number(process.env.FLINT_PORT ?? 4600)

// The vaults the user has opened are remembered between runs, outside any vault.
const CONFIG = process.env.FLINT_CONFIG ?? path.join(os.homedir(), '.flintnotes.json')

interface Config {
  vaults: string[]
  current?: string
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
      systemCommands: data.systemCommands && typeof data.systemCommands === 'object' ? data.systemCommands : undefined,
    }
  } catch {
    return { vaults: [] }
  }
}

const config = await readConfig()
// A vault named on the command line wins over the one used last time.
let root = path.resolve(process.argv[2] ?? process.env.FLINT_VAULT ?? config.current ?? 'vault')

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

const toRel = (abs: string) => path.relative(root, abs).split(path.sep).join('/')

const toEntry = (abs: string, stat: Stats): VaultEntry => ({
  path: toRel(abs),
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
  const abs = path.resolve(root, rel)
  const inside = abs.startsWith(root + path.sep) || (allowRoot && abs === root)
  if (!inside) throw new HTTPException(400, { message: 'Path is outside the vault' })
  return abs
}

const target = (c: Context) => resolveInVault(c.req.query('path'))

async function walk(dir: string): Promise<VaultEntry[]> {
  const dirents = (await fs.readdir(dir, { withFileTypes: true })).filter(
    (d) => !d.name.startsWith('.') && (d.isDirectory() || d.isFile()),
  )
  const nested = await Promise.all(
    dirents.map(async (d) => {
      const abs = path.join(dir, d.name)
      const self = toEntry(abs, await fs.stat(abs))
      return d.isDirectory() ? [self, ...(await walk(abs))] : [self]
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
  config.current = root
  if (!config.vaults.includes(root)) config.vaults.push(root)
  await fs.writeFile(CONFIG, JSON.stringify(config, null, 2)).catch((err) => console.error(`Не удалось записать ${CONFIG}`, err))
}

await ensureVault(root)
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

api.use(async (c, next) => {
  if (!isLocal(`http://${c.req.header('host') ?? ''}`)) throw new HTTPException(403, { message: 'Forbidden host' })
  const origin = c.req.header('origin')
  if (origin && !isLocal(origin)) throw new HTTPException(403, { message: 'Forbidden origin' })
  await next()
})

/**
 * Obsidian keeps its settings in a dot-folder of the vault (`.obsidian`, or
 * another name the user chose). Plugins read them to work the same way as
 * Obsidian does on the same notes. The most recently used folder comes first.
 */
async function obsidianConfigs(): Promise<string[]> {
  const dirs = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name.startsWith('.'))
  const found = await Promise.all(
    dirs.map(async (d) => {
      const app = await fs.stat(path.join(root, d.name, 'app.json')).catch(() => null)
      const used = await fs.stat(path.join(root, d.name, 'workspace.json')).catch(() => null)
      return app ? { name: d.name, used: (used ?? app).mtimeMs } : null
    }),
  )
  return found.filter((f) => f !== null).sort((a, b) => b.used - a.used).map((f) => f.name)
}

api.get('/vault', async (c) => c.json({ name: path.basename(root), path: root, obsidianConfigs: await obsidianConfigs() }))

const vaultInfo = (dir: string): VaultInfo => ({ path: dir, name: path.basename(dir), current: dir === root, exists: existsSync(dir) })

api.get('/vaults', (c) => c.json(config.vaults.map(vaultInfo)))

// Switches the app to another folder. Open pages are told to reload.
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
  root = dir
  await remember()
  watch()
  broadcast({ type: 'vault' })
  return c.json(vaultInfo(dir))
})

// Removes a vault from the list. Its folder and notes are not touched.
api.post('/vaults/forget', async (c) => {
  const { path: dir } = await c.req.json<{ path: string }>()
  if (dir === root) throw new HTTPException(400, { message: 'Это хранилище сейчас открыто' })
  config.vaults = config.vaults.filter((v) => v !== dir)
  await remember()
  return c.json(config.vaults.map(vaultInfo))
})

api.get('/tree', async (c) => c.json(await walk(root)))

// Every note's text in one response, one JSON object per line. The app reads
// this once at start to build its index; a request per note would be far slower.
api.get('/notes', async (c) => {
  const notes = (await walk(root)).filter((entry) => entry.kind === 'file' && entry.path.toLowerCase().endsWith('.md'))
  c.header('content-type', 'application/x-ndjson; charset=utf-8')
  c.header('cache-control', 'no-store')
  return stream(c, async (out) => {
    for (let i = 0; i < notes.length; i += 32) {
      const lines = await Promise.all(
        notes.slice(i, i + 32).map(async ({ path: file }) => {
          // A note deleted since the listing is simply left out.
          const text = await fs.readFile(path.join(root, file), 'utf8').catch(() => null)
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
  let dest = path.join(root, '.trash', toRel(abs))
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
  if (process.platform === 'win32') launch = explorer(abs, abs === root)
  else if (process.platform === 'darwin') launch = ['open', abs === root ? [abs] : ['-R', abs], {}]
  else if (process.env.WSL_DISTRO_NAME) {
    // Under WSL the file manager is Windows Explorer, which needs the path in its Windows form.
    const winPath = await new Promise<string>((resolve, reject) =>
      execFile('wslpath', ['-w', abs], (err, out) => (err ? reject(new HTTPException(500, { message: 'Не удалось получить путь Windows (wslpath)' })) : resolve(out.trim()))),
    )
    launch = explorer(winPath, abs === root)
  } else launch = ['xdg-open', [abs === root ? abs : path.dirname(abs)], {}]
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
api.get('/system-commands', async (c) => c.json({ file: CONFIG, vault: root, commands: Object.keys((await readConfig()).systemCommands?.[root]?.commands ?? {}) }))

api.post('/exec', async (c) => {
  const origin = c.req.header('origin')
  if (!origin || new URL(origin).host !== c.req.header('host')) throw new HTTPException(403, { message: 'Только со страницы самого приложения' })
  const { name, env } = (await c.req.json()) as { name: string; env?: Record<string, unknown> }
  // The file is read anew, so a command added by hand works without a restart.
  const allowed = (await readConfig()).systemCommands?.[root]
  const command = allowed && Object.hasOwn(allowed.commands ?? {}, name) ? allowed.commands[name] : undefined
  if (typeof command !== 'string' || !command.trim()) throw new HTTPException(403, { message: `Команда «${name}» не разрешена в ${CONFIG}` })
  const variables = Object.fromEntries(Object.entries(env ?? {}).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]))
  const timeout = Math.min(600, Math.max(1, Number(allowed?.timeout) || 5)) * 1000
  const output = await new Promise<string>((resolve, reject) => {
    exec(command, { cwd: root, timeout, env: { ...process.env, ...variables }, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new HTTPException(500, { message: (stderr || err.message).trim().slice(0, 500) }))
      else resolve(stdout)
    })
  })
  return c.json({ output: output.trimEnd() })
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
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; FlintNotes link preview)', accept: 'text/html,*/*;q=0.5' } })
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
  const dir = path.join(root, '.flint', 'plugins')
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

const clients = new Set<(event: RemoteEvent) => void>()

api.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    const send = (event: RemoteEvent) => void stream.writeSSE({ data: JSON.stringify(event) })
    clients.add(send)
    stream.onAbort(() => void clients.delete(send))
    while (!stream.aborted && !stream.closed) {
      await stream.sleep(30_000)
      await stream.writeSSE({ event: 'ping', data: '' })
    }
    clients.delete(send)
  }),
)

const broadcast = (event: RemoteEvent) => clients.forEach((send) => send(event))

const isHidden = (abs: string) =>
  path
    .relative(root, abs)
    .split(path.sep)
    .some((part) => part.startsWith('.'))

// Windows drives mounted into WSL (/mnt/c, ...) deliver no file events, so poll there.
const needsPolling = () => (process.env.FLINT_POLL ? process.env.FLINT_POLL !== '0' : /^\/mnt\/[a-z]\//.test(`${root}/`))

let watcher: ReturnType<typeof chokidar.watch> | undefined

/** Follows changes in the current vault's folder; called again when the vault changes. */
function watch(): void {
  void watcher?.close()
  const watched = root
  watcher = chokidar
    .watch(watched, { ignored: isHidden, ignoreInitial: true, usePolling: needsPolling(), interval: 1000, binaryInterval: 3000 })
    .on('all', async (event, abs) => {
      if (abs === watched || watched !== root) return
      if (event === 'unlink' || event === 'unlinkDir') {
        broadcast({ type: 'delete', path: toRel(abs) })
        return
      }
      const stat = await fs.stat(abs).catch(() => null)
      if (stat) broadcast({ type: 'upsert', entry: toEntry(abs, stat) })
    })
}

watch()

const app = new Hono()

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.text(err.message, err.status)
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') return c.text('File not found', 404)
  console.error(err)
  return c.text(err.message, 500)
})

app.route('/api', api)

// The built app: next to this file in a release, in `dist` when run from the sources.
const here = path.dirname(fileURLToPath(import.meta.url))
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

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  const url = `http://localhost:${port}`
  console.log(`FlintNotes: ${url}`)
  console.log(`Хранилище: ${root}${needsPolling() ? ' (опрос изменений)' : ''}`)
  if (!staticDir) console.log('Приложение не собрано: выполните `npm run build` или запустите `npm run dev`.')
  // The launchers set FLINT_OPEN so the app appears in the browser once it is ready.
  if (process.env.FLINT_OPEN) {
    const [command, args] =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {})
  }
})
