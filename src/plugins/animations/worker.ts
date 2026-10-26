/// <reference lib="webworker" />
// Makes the light copy of an animated GIF on a thread of its own. The browser decodes every frame of a
// GIF anew each time round, at the GIF's own size, however small it is shown: a GIF of 1440×810 shown
// 360 wide costs sixteen times the work it needs. Here its frames are decoded once, shrunk to the size
// they are shown at and written as an animated PNG, which the browser then plays as it would the GIF.
// The first frame is also written alone, as the still picture shown while animations are paused.

export interface ToWorker {
  id: number
  /** The picture's address, as the page has it. */
  url: string
  /** How many pixels wide it is shown; 0 to keep its own size (the picture is shown as large as it is). */
  width: number
}

export type FromWorker =
  | {
      id: number
      /** The animated copy at the shown size; `null` when the GIF is hardly larger than shown, and plays as it is. */
      light: Blob | null
      still: Blob
      frames: number
    }
  | { id: number; error: string }

/** A GIF shown at less than this part of its width is copied smaller; closer to its size, the copy would gain little. */
const WORTH = 0.7

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16 = (n: number) => [(n >>> 8) & 255, n & 255]

/** A PNG chunk: length, type, data, and the checksum of type and data. */
function chunk(type: string, data: Uint8Array | number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
  return out
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const header = (w: number, h: number) => chunk('IHDR', [...u32(w), ...u32(h), 8, 6, 0, 0, 0])

/**
 * One frame's pixels as PNG data: each row led by the "Sub" filter (every byte less the one a pixel
 * to its left), which deflate packs far better than the raw pixels, and the whole deflated by the browser.
 */
async function packed(pixels: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array<ArrayBuffer>> {
  const stride = w * 4
  const rows = new Uint8Array(h * (stride + 1))
  for (let y = 0; y < h; y++) {
    const from = y * stride
    const to = y * (stride + 1)
    rows[to] = 1
    for (let x = 0; x < stride; x++) rows[to + 1 + x] = pixels[from + x] - (x >= 4 ? pixels[from + x - 4] : 0)
  }
  const stream = new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The picture's bytes. One of another site is asked of the server: such a site rarely lets a page read it. */
async function bytesOf(url: string): Promise<ArrayBuffer> {
  const address = new URL(url, self.location.href)
  const own = address.origin === self.location.origin || address.protocol === 'data:'
  const res = await fetch(own ? address.href : `/api/web?url=${encodeURIComponent(address.href)}`)
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.arrayBuffer()
}

async function copy({ url, width }: ToWorker): Promise<Omit<Extract<FromWorker, { light: unknown }>, 'id'>> {
  const bytes = await bytesOf(url)
  const decoder = new ImageDecoder({ data: bytes, type: 'image/gif' })
  try {
    await decoder.tracks.ready
    const track = decoder.tracks.selectedTrack!
    const frames = track.frameCount
    const first = (await decoder.decode({ frameIndex: 0 })).image
    const firstDuration = first.duration
    const shrink = width > 0 && width < first.displayWidth * WORTH
    const w = shrink ? Math.max(1, Math.round(width)) : first.displayWidth
    const h = Math.max(1, Math.round((first.displayHeight * w) / first.displayWidth))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const frame = async (image: VideoFrame) => {
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(image, 0, 0, w, h)
      image.close()
      return packed(ctx.getImageData(0, 0, w, h).data, w, h)
    }
    const firstData = await frame(first)
    const still = new Blob([new Uint8Array(SIGNATURE), header(w, h), chunk('IDAT', firstData), chunk('IEND', [])], { type: 'image/png' })
    if (!shrink || frames < 2) return { light: null, still, frames }

    // An animated PNG: the frame count and how often it plays, then each frame with its own time.
    // Every frame of the decoder is whole (the GIF's partial frames are already laid over the earlier
    // ones), so each one simply replaces the last.
    const plays = track.repetitionCount === Infinity ? 0 : track.repetitionCount + 1
    const parts: Uint8Array<ArrayBuffer>[] = [new Uint8Array(SIGNATURE), header(w, h), chunk('acTL', [...u32(frames), ...u32(plays)])]
    let sequence = 0
    for (let i = 0; i < frames; i++) {
      const { image } = i ? await decoder.decode({ frameIndex: i }) : { image: null }
      const delay = Math.max(10, Math.round(((i ? image!.duration : firstDuration) ?? 100_000) / 1000))
      const data = i ? await frame(image!) : firstData
      parts.push(chunk('fcTL', [...u32(sequence++), ...u32(w), ...u32(h), ...u32(0), ...u32(0), ...u16(delay), ...u16(1000), 0, 0]))
      if (!i) parts.push(chunk('IDAT', data))
      else {
        const body = new Uint8Array(4 + data.length)
        body.set(u32(sequence++))
        body.set(data, 4)
        parts.push(chunk('fdAT', body))
      }
    }
    parts.push(chunk('IEND', []))
    return { light: new Blob(parts, { type: 'image/png' }), still, frames }
  } finally {
    decoder.close()
  }
}

// One copy at a time: they are heavy, and the page asks for them one after another anyway.
let queue = Promise.resolve()
self.onmessage = ({ data }: MessageEvent<ToWorker>) => {
  queue = queue.then(async () => {
    try {
      self.postMessage({ id: data.id, ...(await copy(data)) } satisfies FromWorker)
    } catch (err) {
      self.postMessage({ id: data.id, error: err instanceof Error ? err.message : String(err) } satisfies FromWorker)
    }
  })
}
