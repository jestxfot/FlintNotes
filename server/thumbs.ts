// Small copies of pictures, for the places that show them small (the covers of cards).
//
// A cover is drawn 150-300 px wide, but the picture it comes from may be 1280x720 or 11520x2877: the browser then
// downloads all of it and decodes all of it (a decoded picture is width x height x 4 bytes) every time the card
// scrolls into view, and forgets it again soon after. Here the server makes a WebP of the size asked for, once, keeps
// it on disk, and the page gets a few kilobytes that the browser keeps for good.
//
// The resizer (`sharp`) is an optional dependency: where it is not installed `make` answers `null` and the page
// falls back to the picture itself.

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { KEPT_DIR } from './kept'

type Sharp = typeof import('sharp').default

let engine: Promise<Sharp | null> | undefined
/** The resizer, loaded on first use; `null` if it is not installed. */
const resizer = (): Promise<Sharp | null> =>
  (engine ??= import('sharp')
    .then((module) => {
      const sharp = module.default
      // A cover is made once: no cache of decoded pictures inside, and only a couple of threads, so that
      // the notes themselves are not kept waiting behind a page full of covers.
      sharp.cache(false)
      sharp.concurrency(2)
      return sharp
    })
    .catch(() => null))

/** The widths made. A page asks for any, it gets the next one up: a few sizes make a few files, not one per pixel. */
const WIDTHS = [160, 240, 320, 480, 640, 960, 1280]
export const snapWidth = (wanted: number): number => WIDTHS.find((width) => width >= wanted) ?? WIDTHS[WIDTHS.length - 1]

/** The widest an SVG is drawn, in pixels: twice the width of a wide note. */
const MAX_DRAWN = 3200

/** A picture larger than this (in pixels) is not opened: a decompression bomb would take the server's memory. */
const MAX_PIXELS = 400_000_000
/** An animated picture's frames all together, in pixels: 377 frames of 718x404 is 109 million (it converts in 5 s, in 135 MB). */
const MAX_ANIMATED_PIXELS = 600_000_000

export class Thumbs {
  private inflight = new Map<string, Promise<Buffer | null>>()
  private inflightMoving = new Map<string, Promise<{ bytes: Buffer; frames: number }>>()
  private running = 0
  private queue: (() => void)[] = []
  private written = 0

  /** `dir`: where the copies are kept; `limit`: about how much of the disk they may take. */
  constructor(
    private dir = path.join(KEPT_DIR, 'thumbs'),
    private limit = 600_000_000,
  ) {}

  private sourceFile(address: string): string {
    return path.join(this.dir, `${createHash('sha1').update(`source\n${address}`).digest('hex').slice(0, 24)}.src`)
  }

  /**
   * A picture of the web that this server cannot fetch itself, brought by a window that can (the desktop app, over its own
   * connection): kept as the picture's original, so that the copies are made from it and asked for as for any other.
   * `false`: it is not a picture the resizer can read.
   */
  async keepSource(address: string, bytes: Buffer): Promise<boolean> {
    const sharp = await resizer()
    if (!sharp) return false
    try {
      const meta = await sharp(bytes, { animated: true, limitInputPixels: MAX_ANIMATED_PIXELS }).metadata()
      if (!meta.width) return false
    } catch {
      return false
    }
    await fs.mkdir(this.dir, { recursive: true })
    const file = this.sourceFile(address)
    await fs.writeFile(`${file}.part`, bytes)
    await fs.rename(`${file}.part`, file)
    if (++this.written % 200 === 0) void this.trim()
    return true
  }

  /** The path of the picture a window brought for this address, if it did and it is still kept. */
  async source(address: string): Promise<string | null> {
    const file = this.sourceFile(address)
    const stat = await fs.stat(file).catch(() => null)
    if (!stat?.isFile()) return null
    void fs.utimes(file, new Date(), new Date()).catch(() => {})
    return file
  }

  /** Whether pictures can be made at all here. */
  async available(): Promise<boolean> {
    return (await resizer()) !== null
  }


  /**
   * An animated picture (a GIF) for a place that shows it small: the same animation as a WebP at `width`, or its first frame
   * (`still`, what is shown while animations are paused). The animation of a 50 MB GIF comes to 2 MB, once, and is kept on disk.
   * `load` gives the picture as a path (read from the disk as it is converted) or as bytes. `frames` is how many it has
   * (1: it does not move, and `bytes` is the picture as one frame). `null`: there is no resizer.
   */
  async animated(id: string, width: number, still: boolean, load: () => Promise<Buffer | Uint8Array | string>): Promise<{ bytes: Buffer; frames: number } | null> {
    if (!(await resizer())) return null
    const key = createHash('sha1').update(`${id}\n${width}\n${still ? 'still' : 'moving'}`).digest('hex').slice(0, 24)
    const pending = this.inflightMoving.get(key)
    if (pending) return pending
    const work = this.buildMoving(key, width, still, load).finally(() => this.inflightMoving.delete(key))
    this.inflightMoving.set(key, work)
    return work
  }

  private async buildMoving(key: string, width: number, still: boolean, load: () => Promise<Buffer | Uint8Array | string>): Promise<{ bytes: Buffer; frames: number }> {
    const sharp = (await resizer())!
    const file = path.join(this.dir, `${key}.webp`)
    const kept = await fs.readFile(file).catch(() => null)
    if (kept) {
      void fs.utimes(file, new Date(), new Date()).catch(() => {})
      // How many frames it has is in its header: nothing is decoded to say.
      const frames = (await sharp(kept, { animated: true }).metadata().catch(() => null))?.pages ?? 1
      return { bytes: kept, frames }
    }
    const input = await load()
    await this.turn()
    try {
      const options = { failOn: 'none' as const, limitInputPixels: MAX_PIXELS }
      const meta = await sharp(input, { ...options, animated: true }).metadata()
      const frames = meta.pages ?? 1
      const total = (meta.width ?? 0) * (meta.pageHeight ?? meta.height ?? 0) * frames
      if (!still && frames > 1 && total > MAX_ANIMATED_PIXELS) throw new Error('Input: animation too large to convert')
      // The first frame, or the whole animation at the size asked for; a picture of one frame is simply a small picture.
      const moving = !still && frames > 1
      const made = await sharp(input, { ...options, animated: moving })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp(moving ? { quality: 75, effort: 2, loop: meta.loop ?? 0 } : { quality: 80, effort: 3 })
        .toBuffer()
      await fs.mkdir(this.dir, { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      await fs.writeFile(temp, made)
      await fs.rename(temp, file)
      if (++this.written % 200 === 0) void this.trim()
      return { bytes: made, frames }
    } finally {
      this.done()
    }
  }

  /** The size (width, height) a picture file is shown at, from its header: nothing is decoded. `null`: not a picture, or no resizer. */
  async dimensions(file: string): Promise<[number, number] | null> {
    const sharp = await resizer()
    if (!sharp) return null
    try {
      const meta = await sharp(file, { failOn: 'none', limitInputPixels: MAX_PIXELS }).metadata()
      // An animated picture's height is all its frames' together; a photo turned by its camera is shown turned.
      let width = meta.width ?? 0
      let height = meta.pageHeight ?? meta.height ?? 0
      if ((meta.orientation ?? 1) >= 5) [width, height] = [height, width]
      return width > 0 && height > 0 ? [width, height] : null
    } catch {
      return null
    }
  }

  /**
   * The copy of picture `id` (a name for what it is and which version of it: a path with its time and size, an address)
   * at `width`. `load` reads the picture and is called only if the copy is not kept yet. `null`: there is no resizer.
   * Throws if the picture cannot be read or is not one.
   */
  async make(id: string, width: number, load: () => Promise<Buffer | Uint8Array>, scale = 0): Promise<Buffer | null> {
    if (!(await resizer())) return null
    const key = createHash('sha1').update(scale ? `${id}\nx${scale}` : `${id}\n${width}`).digest('hex').slice(0, 24)
    const pending = this.inflight.get(key)
    if (pending) return pending
    const work = this.build(key, width, load, scale).finally(() => this.inflight.delete(key))
    this.inflight.set(key, work)
    return work
  }

  private async build(key: string, width: number, load: () => Promise<Buffer | Uint8Array>, scale: number): Promise<Buffer | null> {
    const file = path.join(this.dir, `${key}.webp`)
    const kept = await fs.readFile(file).catch(() => null)
    if (kept) {
      // Used: the oldest unused go first when the folder is trimmed.
      void fs.utimes(file, new Date(), new Date()).catch(() => {})
      return kept
    }
    const sharp = (await resizer())!
    const bytes = await load()
    await this.turn()
    try {
      const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata()
      // A drawing (SVG) is drawn anew at the size wanted, sharp at any width; a raster picture is only made smaller.
      const drawing = meta.format === 'svg' && meta.width ? meta.width : 0
      const wanted = drawing && scale ? Math.min(MAX_DRAWN, Math.round(drawing * scale)) : scale ? meta.width ?? width : width
      const made = await sharp(bytes, { failOn: 'none', limitInputPixels: MAX_PIXELS, ...(drawing ? { density: Math.min(2400, (72 * wanted) / drawing) } : {}) })
        .rotate()
        .resize({ width: wanted, withoutEnlargement: true })
        .webp(drawing ? { quality: 86, effort: 3 } : { quality: 78, effort: 3 })
        .toBuffer()
      await fs.mkdir(this.dir, { recursive: true })
      // Written beside and then put in place: a server stopped halfway leaves no broken copy.
      const temp = `${file}.${process.pid}.tmp`
      await fs.writeFile(temp, made)
      await fs.rename(temp, file)
      if (++this.written % 200 === 0) void this.trim()
      return made
    } finally {
      this.done()
    }
  }

  /** At most three pictures are made at once; the rest wait their turn. */
  private turn(): Promise<void> {
    if (this.running < 3) {
      this.running++
      return Promise.resolve()
    }
    return new Promise((resume) => this.queue.push(() => (this.running++, resume())))
  }

  private done(): void {
    this.running--
    this.queue.shift()?.()
  }

  /** Removes the copies not used for longest until the folder is under its limit. */
  async trim(): Promise<void> {
    const names = await fs.readdir(this.dir).catch(() => [])
    const files = (
      await Promise.all(
        names.filter((name) => name.endsWith('.webp') || name.endsWith('.src')).map(async (name) => {
          const stat = await fs.stat(path.join(this.dir, name)).catch(() => null)
          return stat ? { name, size: stat.size, time: stat.mtimeMs } : null
        }),
      )
    ).filter((one): one is { name: string; size: number; time: number } => !!one)
    let total = files.reduce((sum, one) => sum + one.size, 0)
    for (const one of files.sort((a, b) => a.time - b.time)) {
      if (total <= this.limit) break
      await fs.rm(path.join(this.dir, one.name), { force: true })
      total -= one.size
    }
  }
}
