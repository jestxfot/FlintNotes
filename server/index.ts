import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import chokidar from 'chokidar'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import { existsSync, type Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ExternalPluginInfo, RemoteEvent, VaultEntry } from '../shared/protocol'

const root = path.resolve(process.argv[2] ?? process.env.FLINT_VAULT ?? 'vault')
const port = Number(process.env.FLINT_PORT ?? 4600)

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

if (!existsSync(root)) {
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(
    path.join(root, 'Добро пожаловать.md'),
    '# Добро пожаловать в FlintNotes\n\nЭто ваше хранилище: обычная папка с Markdown-файлами.\n\n- `Ctrl+P` открывает палитру команд\n- `Ctrl+,` открывает настройки, там же включаются плагины\n- `Alt+N` создаёт новую заметку\n',
  )
}

const api = new Hono()

// The server can write to disk, so only the local app may talk to it: this blocks
// other websites (cross-origin requests) and DNS rebinding (foreign Host header).
api.use(async (c, next) => {
  const host = c.req.header('host') ?? ''
  const { hostname } = new URL(`http://${host}`)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    throw new HTTPException(403, { message: 'Forbidden host' })
  }
  const origin = c.req.header('origin')
  if (origin && new URL(origin).host !== host) {
    throw new HTTPException(403, { message: 'Forbidden origin' })
  }
  await next()
})

api.get('/vault', (c) => c.json({ name: path.basename(root) }))

api.get('/tree', async (c) => c.json(await walk(root)))

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
const usePolling = process.env.FLINT_POLL
  ? process.env.FLINT_POLL !== '0'
  : /^\/mnt\/[a-z]\//.test(`${root}/`)

chokidar
  .watch(root, { ignored: isHidden, ignoreInitial: true, usePolling, interval: 1000, binaryInterval: 3000 })
  .on('all', async (event, abs) => {
    if (abs === root) return
    if (event === 'unlink' || event === 'unlinkDir') {
      broadcast({ type: 'delete', path: toRel(abs) })
      return
    }
    const stat = await fs.stat(abs).catch(() => null)
    if (stat) broadcast({ type: 'upsert', entry: toEntry(abs, stat) })
  })

const app = new Hono()

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.text(err.message, err.status)
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') return c.text('File not found', 404)
  console.error(err)
  return c.text(err.message, 500)
})

app.route('/api', api)

if (existsSync('dist')) {
  app.use('*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`FlintNotes: http://localhost:${port}`)
  console.log(`Хранилище: ${root}${usePolling ? ' (опрос изменений)' : ''}`)
})
