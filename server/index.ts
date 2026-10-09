import { serve } from '@hono/node-server'
import chokidar from 'chokidar'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { stream, streamSSE } from 'hono/streaming'
import { spawn } from 'node:child_process'
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
}

async function readConfig(): Promise<Config> {
  try {
    const data = JSON.parse(await fs.readFile(CONFIG, 'utf8'))
    return { vaults: Array.isArray(data.vaults) ? data.vaults.filter((v: unknown) => typeof v === 'string') : [], current: data.current }
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

api.get('/vault', (c) => c.json({ name: path.basename(root), path: root }))

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
const staticDir = [path.join(here, 'public'), path.resolve('dist')].find((dir) => existsSync(path.join(dir, 'index.html')))

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
