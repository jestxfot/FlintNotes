import { Plugin } from '../../api'
import type { FromWorker, ToWorker } from './worker'

/** A picture is taken for a GIF by its address: the file's name, or the `path` of a vault file, ends in `.gif`. */
const GIF = /\.gif(?:$|[?#&])/i
/** Shown widths are rounded up to steps of this many pixels: a window resized a little keeps its copies. */
const STEP = 64
/** Copies kept at hand in the page. */
const KEPT = 16
/** Copies kept between runs (Cache Storage), and how much room they may take. */
const STORE = 'flint-animations'
const STORED = 24
const STORED_SIZE = 256_000_000

interface Copy {
  /** The animated copy at the shown size, or `null` when the GIF plays as it is. */
  light: string | null
  /** The first frame, shown while animations are paused. */
  still: string
  /** The shown width (in pixels of the screen) it was made for; `Infinity` for one made at the GIF's own size. */
  width: number
}

interface Made {
  light: Blob | null
  still: Blob
  frames: number
  /** It came from the copies of an earlier run. */
  kept?: boolean
}

interface Shown {
  /** The address the app gave the picture. */
  original: string
  /** The GIF's own width, in pixels of the page, once it has loaded. */
  natural?: number
  copy?: Copy
  /** The copy is being made for this width. */
  making?: number
  /** No copy could be made (not a GIF after all, or it could not be read): the picture is left as it is. */
  failed?: boolean
  timer?: ReturnType<typeof setTimeout>
}

const place = (key: string, kind: string) => `https://flint.cache/${encodeURIComponent(key)}/${kind}`

/** The copies of earlier runs. Not every page has them: one opened over the network without https does not. */
async function stored(key: string): Promise<Made | null> {
  if (!globalThis.caches) return null
  const cache = await caches.open(STORE)
  const info = await cache.match(place(key, 'info'))
  if (!info) return null
  const { light, frames } = (await info.json()) as { light: boolean; frames: number }
  const still = await (await cache.match(place(key, 'still')))?.blob()
  const lightBlob = light ? await (await cache.match(place(key, 'light')))?.blob() : null
  return still && (!light || lightBlob) ? { light: lightBlob ?? null, still, frames, kept: true } : null
}

async function store(key: string, made: Made): Promise<void> {
  if (!globalThis.caches) return
  const cache = await caches.open(STORE)
  await cache.put(place(key, 'still'), new Response(made.still))
  if (made.light) await cache.put(place(key, 'light'), new Response(made.light))
  await cache.put(place(key, 'info'), Response.json({ light: !!made.light, frames: made.frames, size: made.still.size + (made.light?.size ?? 0) }))
  // The oldest go first, while there are too many or they take too much room.
  const infos = (await cache.keys()).filter((request) => request.url.endsWith('/info'))
  const sizes = await Promise.all(infos.map(async (request) => ((await (await cache.match(request))?.json()) as { size?: number } | undefined)?.size ?? 0))
  let total = sizes.reduce((a, b) => a + b, 0)
  for (let i = 0; i < infos.length && (infos.length - i > STORED || total > STORED_SIZE); i++) {
    const base = infos[i].url.slice(0, -'/info'.length)
    await Promise.all(['info', 'still', 'light'].map((kind) => cache.delete(`${base}/${kind}`)))
    total -= sizes[i]
  }
}

/**
 * Animated pictures that cost less. A GIF shown smaller than it is plays from a copy made at the size
 * it is shown (worker.ts tells why that is several times cheaper), and animations stop on their first
 * frame while the window is not the one being worked in, or when asked to.
 */
export default class Animations extends Plugin {
  private shown = new WeakMap<HTMLImageElement, Shown>()
  private copies = new Map<string, Promise<Copy | null>>()
  private worker: Worker | null = null
  private asked = new Map<number, (answer: FromWorker) => void>()
  private nextId = 0
  /** Stopped by the command, until it is given again. */
  private held = false

  onload() {
    this.addSettings([
      { key: 'lighten', name: 'Облегчать большие GIF', desc: 'GIF, показанный меньше своего размера, один раз пересобирается в фоне под размер на экране и дальше играет из этой копии: выглядит так же, а процессора уходит в несколько раз меньше. Копии хранятся между запусками', type: 'toggle', default: true },
      { key: 'pauseUnfocused', name: 'Останавливать, когда окно не в фокусе', desc: 'Пока вы работаете в другой программе, GIF стоят на первом кадре. Свёрнутое окно и окно в трее не рисуют ничего и без этого', type: 'toggle', default: true },
    ])
    this.addCommand({
      id: 'toggle',
      name: 'Остановить или запустить анимированные картинки',
      icon: 'pause',
      callback: () => {
        this.held = !this.held
        this.app.notice(this.held ? 'Анимированные картинки остановлены' : 'Анимированные картинки снова играют')
        this.applyAll()
      },
    })
    this.onSettingChange(() => this.applyAll())

    const resized = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        // A picture taken off the page (the editor draws its parts anew all the time) is let go.
        if (!target.isConnected) resized.unobserve(target)
        else this.fitSoon(target as HTMLImageElement)
      }
    })
    const take = (img: HTMLImageElement) => {
      const state = this.shown.get(img)
      // The picture shows one of this plugin's own copies: nothing has changed.
      if (state && (img.src === state.copy?.light || img.src === state.copy?.still)) return
      if (!GIF.test(safeDecode(img.src))) {
        if (state) this.shown.delete(img)
        return
      }
      if (state?.original === img.src) return
      this.shown.set(img, { original: img.src })
      resized.observe(img)
    }
    const look = (node: Node) => {
      if (node instanceof HTMLImageElement) take(node)
      else if (node instanceof Element) node.querySelectorAll('img').forEach(take)
    }
    const watching = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') look(record.target)
        else record.addedNodes.forEach(look)
      }
    })
    watching.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
    look(document.body)

    // Whether the window is the one worked in settles only after the event, so it is asked a moment later.
    const focus = () => setTimeout(() => this.applyAll())
    window.addEventListener('focus', focus)
    window.addEventListener('blur', focus)
    document.addEventListener('visibilitychange', focus)

    this.register(() => {
      watching.disconnect()
      resized.disconnect()
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', focus)
      document.removeEventListener('visibilitychange', focus)
      // Every picture gets its own address back.
      for (const img of document.images) {
        const state = this.shown.get(img)
        if (state && img.src !== state.original) img.src = state.original
      }
      this.worker?.terminate()
      for (const copy of this.copies.values()) void copy.then(revoke)
      this.copies.clear()
    })
  }

  private paused(): boolean {
    return this.held || (this.getSetting<boolean>('pauseUnfocused') !== false && !document.hasFocus())
  }

  /** What a picture should show now: the still frame, the light copy, or its own GIF. */
  private apply(img: HTMLImageElement): void {
    const state = this.shown.get(img)
    if (!state) return
    const { copy } = state
    const lighten = this.getSetting<boolean>('lighten') !== false
    const want = copy && this.paused() ? copy.still : copy?.light && lighten ? copy.light : state.original
    if (img.src !== want) img.src = want
  }

  private applyAll(): void {
    for (const img of document.images) {
      const state = this.shown.get(img)
      if (!state) continue
      // A copy is needed to pause, and to lighten: one made for a smaller width is made again.
      if (!state.copy || state.copy.width < this.widthOf(img)) this.fitSoon(img)
      this.apply(img)
    }
  }

  /** The width the picture is shown at, in pixels of the screen, rounded up to a step; 0 while it is not shown. */
  private widthOf(img: HTMLImageElement): number {
    const shown = img.getBoundingClientRect().width * devicePixelRatio
    return shown ? Math.ceil(shown / STEP) * STEP : 0
  }

  /** A picture that came or changed its size gets its copy a moment later, when the layout has settled. */
  private fitSoon(img: HTMLImageElement): void {
    const state = this.shown.get(img)
    if (!state) return
    clearTimeout(state.timer)
    state.timer = setTimeout(() => void this.fit(img, state), 250)
  }

  private async fit(img: HTMLImageElement, state: Shown): Promise<void> {
    if (!img.isConnected || state.failed || this.shown.get(img) !== state) return
    // Without either setting there is nothing to make copies for.
    if (this.getSetting<boolean>('lighten') === false && this.getSetting<boolean>('pauseUnfocused') === false && !this.held) return this.apply(img)
    // The GIF's own size is learnt from the GIF itself, before any copy takes its place.
    if (state.natural === undefined) {
      if (img.src !== state.original || !img.complete || !img.naturalWidth) return void img.addEventListener('load', () => this.fitSoon(img), { once: true })
      state.natural = img.naturalWidth
    }
    const shown = img.getBoundingClientRect().width
    // Shown as large as it is, a smaller copy would make it smaller on the page: such a GIF keeps its size.
    const width = !shown ? 0 : shown < state.natural - 1 ? this.widthOf(img) : Infinity
    // A copy for this size or larger is there or on its way; a picture not shown waits until it is.
    if (!width || (state.copy && state.copy.width >= width) || (state.making ?? 0) >= width) return this.apply(img)
    state.making = width
    const copy = await this.copyOf(state.original, width === Infinity ? 0 : width)
    if (this.shown.get(img) !== state) return
    state.making = undefined
    if (copy) state.copy = copy
    else state.failed = true
    this.apply(img)
  }

  /** The copies of a GIF for a width: from those at hand, from those kept between runs, or made now. */
  private copyOf(original: string, width: number): Promise<Copy | null> {
    const key = `${original}\n${width}`
    let copy = this.copies.get(key)
    if (copy) {
      // The latest used are kept longest.
      this.copies.delete(key)
      this.copies.set(key, copy)
      return copy
    }
    copy = (async () => {
      const made = (await stored(key).catch(() => null)) ?? (await this.make(original, width))
      if (!made) return null
      if (!made.kept) void store(key, made).catch(() => {})
      // A picture of one frame does not move: nothing to lighten or pause.
      if (made.frames === 1) return null
      return { light: made.light && URL.createObjectURL(made.light), still: URL.createObjectURL(made.still), width: width || Infinity }
    })()
    this.copies.set(key, copy)
    this.forget()
    return copy
  }

  /** Lets go of the oldest copies beyond those kept at hand, unless a picture on the page still shows one. */
  private forget(): void {
    const used = new Set([...document.images].map((img) => img.src))
    for (const [key, copy] of this.copies) {
      if (this.copies.size <= KEPT) break
      void copy.then((made) => {
        if (made && (used.has(made.still) || (made.light && used.has(made.light)))) return
        this.copies.delete(key)
        revoke(made)
      })
    }
  }

  private make(url: string, width: number): Promise<Made | null> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
        this.asked.get(data.id)?.(data)
        this.asked.delete(data.id)
      }
    }
    const id = ++this.nextId
    return new Promise((resolve) => {
      this.asked.set(id, (answer) => {
        if ('error' in answer) {
          console.warn(`Анимированная картинка ${url} оставлена как есть: ${answer.error}`)
          return resolve(null)
        }
        resolve(answer)
      })
      this.worker!.postMessage({ id, url, width } satisfies ToWorker)
    })
  }
}

function revoke(copy: Copy | null): void {
  if (!copy) return
  URL.revokeObjectURL(copy.still)
  if (copy.light) URL.revokeObjectURL(copy.light)
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
