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

/** A picture larger than this (in pixels) is not opened: a decompression bomb would take the server's memory. */
const MAX_PIXELS = 400_000_000

export class Thumbs {
  private inflight = new Map<string, Promise<Buffer | null>>()
  private running = 0
  private queue: (() => void)[] = []
  private written = 0

  /** `dir`: where the copies are kept; `limit`: about how much of the disk they may take. */
  constructor(
    private dir = path.join(KEPT_DIR, 'thumbs'),
    private limit = 400_000_000,
  ) {}

  /** Whether pictures can be made at all here. */
  async available(): Promise<boolean> {
    return (await resizer()) !== null
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
  async make(id: string, width: number, load: () => Promise<Buffer | Uint8Array>): Promise<Buffer | null> {
    if (!(await resizer())) return null
    const key = createHash('sha1').update(`${id}\n${width}`).digest('hex').slice(0, 24)
    const pending = this.inflight.get(key)
    if (pending) return pending
    const work = this.build(key, width, load).finally(() => this.inflight.delete(key))
    this.inflight.set(key, work)
    return work
  }

  private async build(key: string, width: number, load: () => Promise<Buffer | Uint8Array>): Promise<Buffer | null> {
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
      const made = await sharp(bytes, { failOn: 'none', limitInputPixels: MAX_PIXELS })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78, effort: 3 })
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
        names.filter((name) => name.endsWith('.webp')).map(async (name) => {
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
