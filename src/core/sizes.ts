// How large things are, kept so that room is left for them before they arrive.
//
// A picture has no size until it has been fetched, and a block (a list of tasks, a base, an embed) has none until it is drawn:
// the line under it sits where it sits, and when the picture or the block turns up everything below it jumps, in the middle of
// reading or scrolling. Here the sizes are remembered (what was seen once is known at the next opening, kept in the browser),
// and for the files of the vault the server tells them from the file's header, much sooner than the picture itself comes.
//   - `reserveImage` gives a picture the shape it will have (CSS `aspect-ratio`) before it loads;
//   - `blockHeight` is what the editor is told a block will measure (`WidgetType.estimatedHeight`).

const STORE = 'flint-sizes'
const IMAGES_MAX = 3000
const BLOCKS_MAX = 600

interface Stored {
  images: Record<string, [number, number]>
  blocks: Record<string, number>
}

function read(): Stored {
  try {
    const data = JSON.parse(localStorage.getItem(STORE) ?? '') as Partial<Stored>
    return { images: data.images ?? {}, blocks: data.blocks ?? {} }
  } catch {
    return { images: {}, blocks: {} }
  }
}

const data = read()
let saving: ReturnType<typeof setTimeout> | undefined

function write(): void {
  saving = undefined
  for (const [group, max] of [
    [data.images, IMAGES_MAX],
    [data.blocks, BLOCKS_MAX],
  ] as const) {
    const keys = Object.keys(group)
    // The oldest first: an object keeps its keys in the order they were added.
    for (const key of keys.slice(0, Math.max(0, keys.length - max))) delete (group as Record<string, unknown>)[key]
  }
  try {
    localStorage.setItem(STORE, JSON.stringify(data))
  } catch {
    // A full or forbidden store only means the sizes are learnt again next time.
  }
}

/** Written a little later and not at every size: a page full of pictures would write once per picture. */
function save(): void {
  saving ??= setTimeout(write, 2000)
}

// A page that is closed or reloaded right away writes at once, not two seconds later.
if (typeof addEventListener === 'function') {
  const flush = () => {
    if (saving === undefined) return
    clearTimeout(saving)
    write()
  }
  addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
}

/** The address a picture is remembered by: a file of the vault by its path and version, anything else as it is written. */
function keyOf(src: string): string {
  try {
    const url = new URL(src, location.href)
    if (url.origin === location.origin && url.pathname === '/api/file') return `file:${url.searchParams.get('vault') ?? ''}:${url.searchParams.get('path')}:${url.searchParams.get('v') ?? ''}`
    return url.href.replace(/#.*$/, '')
  } catch {
    return src
  }
}

/** The path in the vault, if the address is of one of its files. */
function vaultPath(src: string): { path: string; vault: string } | null {
  try {
    const url = new URL(src, location.href)
    const path = url.searchParams.get('path')
    return url.origin === location.origin && url.pathname === '/api/file' && path ? { path, vault: url.searchParams.get('vault') ?? '' } : null
  } catch {
    return null
  }
}

export function imageSize(src: string): [number, number] | undefined {
  return data.images[keyOf(src)]
}

export function rememberImage(src: string, width: number, height: number): void {
  if (!(width > 0 && height > 0)) return
  const key = keyOf(src)
  const known = data.images[key]
  if (known && known[0] === width && known[1] === height) return
  // Re-added at the end: a picture seen again is the last to go.
  delete data.images[key]
  data.images[key] = [width, height]
  save()
}

// ---- what the server says of the files of the vault

type Fetcher = (paths: string[]) => Promise<Record<string, [number, number]>>
let fetcher: Fetcher | null = null
/** Wires the server in: asked for the sizes of several files at once, it answers from the files' headers. */
export function setSizeSource(source: Fetcher): void {
  fetcher = source
}

const waiting = new Map<string, ((size: [number, number] | undefined) => void)[]>()
let flushing = false

/** The pictures of one moment are asked about in one request. */
function ask(path: string): Promise<[number, number] | undefined> {
  return new Promise((resolve) => {
    const list = waiting.get(path)
    if (list) list.push(resolve)
    else waiting.set(path, [resolve])
    if (flushing) return
    flushing = true
    queueMicrotask(async () => {
      flushing = false
      const batch = [...waiting.entries()].slice(0, 100)
      for (const [name] of batch) waiting.delete(name)
      const sizes = await fetcher?.(batch.map(([name]) => name)).catch(() => ({}) as Record<string, [number, number]>)
      for (const [name, resolvers] of batch) for (const resolve of resolvers) resolve(sizes?.[name])
    })
  })
}

// ---- pictures

/**
 * Gives a picture its shape before it loads, so that what is below it does not move when it does.
 * `sized`: the page gave it a width of its own (a style, an attribute), so only its height is unknown; a picture that has
 * neither is left to its natural size, and the guess for it would be a shift of its own.
 */
export function reserveImage(img: HTMLImageElement, src: string, sized = false): void {
  // The page's own shape for it (`height`, an `aspect-ratio` of its own) is left as written.
  if (img.hasAttribute('height') || img.style.height || img.style.aspectRatio) return
  const known = imageSize(src)
  if (known) {
    img.style.aspectRatio = `${known[0]} / ${known[1]}`
    return
  }
  const local = vaultPath(src)
  if (local && fetcher) {
    // The server reads the file's header, which is far less than the picture: the shape is there before the picture is.
    void ask(local.path).then((size) => {
      if (!size) return
      rememberImage(src, size[0], size[1])
      if (!img.complete || !img.naturalWidth) img.style.aspectRatio = `${size[0]} / ${size[1]}`
    })
    return
  }
  // A picture of the web that has a width and no height: room for a frame of the usual shape until the real one is known.
  if (sized) img.style.aspectRatio = 'auto 16 / 9'
}

/** Every picture that loads on the page says what size it is; that is what is known at the next opening. */
export function watchImageSizes(): void {
  document.addEventListener(
    'load',
    (event) => {
      const img = event.target
      if (!(img instanceof HTMLImageElement) || !img.naturalWidth || img.classList.contains('base-cover') || (img.currentSrc || img.src).includes('/api/thumb')) return
      // An animated picture's size is that of a frame; the browser says the same.
      rememberImage(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight)
    },
    true,
  )
}

// ---- blocks

/** A short name for a block, whose key holds all its text. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

export function blockHeight(key: string): number | undefined {
  return data.blocks[hash(key)]
}

export function rememberBlock(key: string, height: number): void {
  if (!(height > 0)) return
  const name = hash(key)
  if (Math.abs((data.blocks[name] ?? 0) - height) < 1) return
  delete data.blocks[name]
  data.blocks[name] = Math.round(height)
  save()
}
