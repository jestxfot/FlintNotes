// Where the time goes: what the server notices of itself, and what the page reports of itself.
//
// Everything is one kind of line in the server's log (`flintnotes logs`, `flintnotes slow`), each starting `[perf]`:
//   - a request that took long to answer, or an answer that is large (a picture of 20 MB for a card);
//   - the server not answering at all for a while (its one thread was busy), with the requests it was in the middle of;
//   - what the page saw: a frame that took long to draw, a key that was slow to show, a scroll that stuttered, and
//     what was on screen then (src/core/perf.ts).
// Nothing is kept: a line is written when something is slow and never otherwise, so a quiet app writes nothing.

import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { MiddlewareHandler } from 'hono'

/** The longest a request may take to be answered before it is written down, ms. `FLINT_PERF_SLOW`; 0 switches it all off. */
const SLOW = Number(process.env.FLINT_PERF_SLOW ?? 400)
/** An answer larger than this is written down whatever its time: it is what makes pages slow on a network. */
const LARGE = 3_000_000
/** The server standing still longer than this at a stretch is written down, ms. */
const STALL = 150

export const perfEnabled = SLOW > 0

/** What the page may say in one report: how many entries, how long each. */
const MAX_ENTRIES = 20
const MAX_TEXT = 600

type Write = (line: string) => void

export class Perf {
  private open = new Set<{ what: string; since: number }>()
  private spent = 0
  private windowStart = 0

  constructor(
    private write: Write = (line) => console.log(line),
    private now: () => number = Date.now,
    readonly slow = SLOW,
  ) {}

  /** Times the requests passing through. Streams that stay open (the changes, the reminders) answer at once and so cost nothing here. */
  readonly middleware: MiddlewareHandler = async (c, next) => {
    if (this.slow <= 0) return next()
    const query = c.req.query('path') ?? c.req.query('url') ?? ''
    const entry = { what: `${c.req.method} ${c.req.path}${query ? ` ${decodeURIComponent(query).slice(0, 120)}` : ''}`, since: this.now() }
    this.open.add(entry)
    try {
      await next()
    } finally {
      this.open.delete(entry)
      const ms = this.now() - entry.since
      const bytes = Number(c.res.headers.get('content-length') ?? 0)
      if (ms >= this.slow || bytes >= LARGE) this.write(`[perf] запрос ${entry.what}: ответ ${ms} мс, ${size(bytes)}, код ${c.res.status}`)
    }
  }

  /** Watches the server's own thread. Returns what stops it. */
  watchLoop(every = 5000): () => void {
    if (this.slow <= 0) return () => {}
    const histogram = monitorEventLoopDelay({ resolution: 10 })
    histogram.enable()
    const timer = setInterval(() => {
      const worst = Math.round(histogram.max / 1e6)
      histogram.reset()
      if (worst < STALL) return
      const doing = [...this.open].slice(0, 5).map((one) => one.what)
      this.write(`[perf] сервер стоял ${worst} мс подряд${doing.length ? `; в это время шли: ${doing.join('; ')}` : ''}`)
    }, every)
    timer.unref()
    return () => (clearInterval(timer), histogram.disable())
  }

  /** What a page says of its own slowness; written down with who said it. Anything that is not the right shape is dropped. */
  report(who: string, body: unknown): number {
    if (this.slow <= 0) return 0
    const entries = (body as { entries?: unknown } | null)?.entries
    if (!Array.isArray(entries)) return 0
    // A page that goes wrong must not fill the log: some per minute, whatever it sends.
    const t = this.now()
    if (t - this.windowStart > 60_000) (this.windowStart = t), (this.spent = 0)
    let taken = 0
    for (const one of entries.slice(0, MAX_ENTRIES)) {
      if (typeof one !== 'string' || this.spent >= 120) continue
      this.spent++
      taken++
      this.write(`[perf] страница (${who}): ${one.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT)}`)
    }
    return taken
  }
}

const size = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} МБ` : bytes >= 1e3 ? `${Math.round(bytes / 1e3)} КБ` : `${bytes} Б`)
