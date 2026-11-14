// The page tells the server's log when it was slow, and why. Nothing is written while it runs well.
//
// Three things are watched, each with what the page was showing at the time:
//   - a frame that took long to draw (the browser's own account of it: which script, how much of it was drawing),
//   - a key or a click that was slow to show its result,
//   - a scroll that stuttered: the frames of one gesture, and what the pictures on the page cost, because decoding a
//     picture is not script and shows in neither of the first two (that is what a grid of covers does).
// The lines go to the server (`POST /api/perf`) and stand in its log with `[perf]` (`flintnotes slow` shows only those).

/** A frame (or an input) shorter than this is not worth a line, ms. */
const FRAME = 100
const INPUT = 200
/** How long the page waits before sending what it noticed, so one send carries a burst of them. */
const SEND_EVERY = 8000
const QUEUE_MAX = 40
/** The scroll is over when no scroll event came for this long, ms. */
const SCROLL_END = 250

interface Script {
  duration: number
  invoker?: string
  sourceURL?: string
  sourceFunctionName?: string
  sourceCharPosition?: number
  forcedStyleAndLayoutDuration?: number
}
interface LongFrame extends PerformanceEntry {
  renderStart: number
  styleAndLayoutStart: number
  blockingDuration: number
  scripts: Script[]
}
interface InputEntry extends PerformanceEntry {
  processingStart: number
  processingEnd: number
  target?: Element | null
}

const round = (value: number) => Math.round(value)
const fileName = (url = '') => url.replace(/[?#].*$/, '').replace(/^.*\//, '')

/** `div.base-cards-wrap`: enough to find the element in the page, not a selector. */
function describe(node: unknown): string {
  if (!(node instanceof Element)) return node === document ? 'страница' : String(node)
  const classes = [...node.classList].slice(0, 2).join('.')
  return `${node.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`
}

let queue: string[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let where: () => string = () => ''

function send(): void {
  timer = undefined
  if (!queue.length) return
  const entries = queue
  queue = []
  // `keepalive`: a report sent as the page is closed or hidden still goes. A server that does not answer loses it: no retry.
  void fetch('/api/perf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries }), keepalive: true }).catch(() => {})
}

function note(text: string): void {
  if (queue.length >= QUEUE_MAX) return
  queue.push(`${text} — ${where()}`)
  timer ??= setTimeout(send, SEND_EVERY)
}

// ---- frames and inputs

function watchFrames(): void {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LongFrame[]) {
      // A page in the tray is throttled by the browser and its frames mean nothing.
      if (entry.duration < FRAME || document.visibilityState !== 'visible') continue
      const end = entry.startTime + entry.duration
      const script = entry.scripts.reduce((sum, one) => sum + one.duration, 0)
      const forced = entry.scripts.reduce((sum, one) => sum + (one.forcedStyleAndLayoutDuration ?? 0), 0)
      // After the scripts the browser works out styles and layout and draws: what is not script is that.
      const drawing = entry.renderStart ? end - entry.renderStart : 0
      const layout = entry.styleAndLayoutStart ? end - entry.styleAndLayoutStart : 0
      const top = [...entry.scripts]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 2)
        .map((one) => `${round(one.duration)} мс ${one.invoker || one.sourceFunctionName || 'скрипт'} (${fileName(one.sourceURL)}:${one.sourceCharPosition ?? 0})`)
      note(
        `кадр ${round(entry.duration)} мс: скрипты ${round(script)}, из них принудительная раскладка ${round(forced)}; стили и раскладка после них ${round(layout)}, отрисовка ${round(drawing)}${top.length ? `; дольше всех: ${top.join(', ')}` : ''}`,
      )
    }
  }).observe({ type: 'long-animation-frame', buffered: true })

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as InputEntry[]) {
      if (entry.duration < INPUT || document.visibilityState !== 'visible') continue
      const waited = entry.processingStart - entry.startTime
      const handled = entry.processingEnd - entry.processingStart
      const shown = entry.duration - waited - handled
      note(`${entry.name} на ${describe(entry.target)}: ждало ${round(waited)} мс, обработчик ${round(handled)}, до показа ${round(shown)} (всего ${round(entry.duration)} мс)`)
    }
  }).observe({ type: 'event', durationThreshold: INPUT, buffered: true } as PerformanceObserverInit)
}

// ---- scrolling

interface Gesture {
  target: unknown
  started: number
  lastScroll: number
  lastFrame: number
  gaps: number[]
  loaded: number
  megapixels: number
  biggest: [number, number]
  spoiled: boolean
}
let gesture: Gesture | null = null

/** What the pictures on the page cost: how many are drawn far larger than the place they are shown in. */
function pictures(): string {
  const ratio = window.devicePixelRatio || 1
  let shown = 0
  let oversized = 0
  let megapixels = 0
  const images = [...document.images].slice(0, 600)
  for (const image of images) {
    if (!image.complete || !image.naturalWidth || !image.clientWidth) continue
    shown++
    megapixels += (image.naturalWidth * image.naturalHeight) / 1e6
    if (image.naturalWidth > image.clientWidth * ratio * 2.5) oversized++
  }
  return `картинок на странице ${document.images.length}, показано ${shown}, из них вдвое-втрое больше своего места ${oversized} (все вместе ~${round(megapixels)} Мпикс)`
}

function endGesture(done: Gesture): void {
  const { gaps } = done
  if (done.spoiled || gaps.length < 5) return
  const sorted = [...gaps].sort((a, b) => a - b)
  const at = (share: number) => round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))])
  const slow = gaps.filter((gap) => gap > 50).length
  // A smooth scroll says nothing; a few slow frames out of many is a hiccup, not a stutter.
  if (slow < 3 && sorted[sorted.length - 1] < 120) return
  const loaded = done.loaded ? `; за это время подгрузилось картинок: ${done.loaded} (~${round(done.megapixels)} Мпикс, самая крупная ${done.biggest[0]}×${done.biggest[1]})` : ''
  note(
    `прокрутка ${describe(done.target)} ${((done.lastScroll - done.started) / 1000).toFixed(1)} с: кадров ${gaps.length}, обычно ${at(0.5)} мс, 90% ${at(0.9)}, худший ${round(sorted[sorted.length - 1])}, дольше 50 мс: ${slow}${loaded}; ${pictures()}`,
  )
}

function frame(): void {
  const now = performance.now()
  const g = gesture
  if (!g) return
  if (document.visibilityState !== 'visible') g.spoiled = true
  else g.gaps.push(now - g.lastFrame)
  g.lastFrame = now
  if (now - g.lastScroll > SCROLL_END) {
    gesture = null
    // The last gap is the wait for the end of the gesture, not a frame.
    g.gaps.pop()
    endGesture(g)
  } else requestAnimationFrame(frame)
}

function watchScroll(): void {
  // Capture: scrolling does not bubble, and what scrolls is rarely the window.
  window.addEventListener(
    'scroll',
    (event) => {
      const now = performance.now()
      if (gesture) return void (gesture.lastScroll = now)
      gesture = { target: event.target, started: now, lastScroll: now, lastFrame: now, gaps: [], loaded: 0, megapixels: 0, biggest: [0, 0], spoiled: false }
      requestAnimationFrame(frame)
    },
    { capture: true, passive: true },
  )
  // A picture that arrives while the page scrolls has to be decoded before it is drawn.
  document.addEventListener(
    'load',
    (event) => {
      const image = event.target
      if (!gesture || !(image instanceof HTMLImageElement)) return
      gesture.loaded++
      gesture.megapixels += (image.naturalWidth * image.naturalHeight) / 1e6
      if (image.naturalWidth * image.naturalHeight > gesture.biggest[0] * gesture.biggest[1]) gesture.biggest = [image.naturalWidth, image.naturalHeight]
    },
    true,
  )
}

/**
 * Starts watching. `describeScreen` says what the person is looking at (the note, the kind of view): it is added to each
 * line, since "a frame of 300 ms" without it cannot be found again.
 */
export function watchPerformance(describeScreen: () => string): void {
  if (typeof PerformanceObserver === 'undefined' || !('PerformanceLongAnimationFrameTiming' in window)) return
  where = () => {
    try {
      return describeScreen()
    } catch {
      return ''
    }
  }
  watchFrames()
  watchScroll()
  // A page being closed or hidden sends what it has: the stutter just before is the one worth knowing.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && send())
  addEventListener('pagehide', send)
}
