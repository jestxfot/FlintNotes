/** How long the keyboard and the wheel must have been still before work that can wait is done: longer than a note waits to be saved (400 ms), so that what a save sets off is not done in a pause between two words. */
const QUIET = 600
/** However long the typing goes on, work that can wait waits no longer than this. */
const LONGEST = 4000

let last = 0
let listening = false
const touched = () => (last = performance.now())

function listen(): void {
  if (listening) return
  listening = true
  // Typing and scrolling come in streams that work must not cut into; a click is one act, whose result is
  // awaited at once (a task ticked in a list, a reminder put off), so it does not count.
  for (const type of ['keydown', 'beforeinput', 'compositionupdate', 'wheel']) {
    window.addEventListener(type, touched, { capture: true, passive: true })
  }
}

const idle = (work: () => void): (() => void) => {
  if (typeof requestIdleCallback !== 'function') {
    const timer = setTimeout(work)
    return () => clearTimeout(timer)
  }
  const handle = requestIdleCallback(work, { timeout: 500 })
  return () => cancelIdleCallback(handle)
}

export interface Quietly {
  /** Asks for the work; asked for again before it is done, it is still done once. */
  (): void
  cancel(): void
}

/**
 * Keeps work that can wait out of the way of the person typing: redrawing a list of tasks, a base, the search panel,
 * the graph, after a note changed. Asked for, the work is done `delay` ms after it was last asked for, once the
 * keyboard and the wheel have been still for a moment, and when the page has nothing else to do; asked for many times
 * meanwhile, it is done once. A key is then never kept waiting behind it: what a save of the note sets off (each
 * pause in the typing saves) waits until the typing stops, and does not freeze the letters typed next.
 *
 * However long the typing goes on, the work is done within a few seconds of being asked for.
 */
export function whenQuiet(work: () => void, delay = 100): Quietly {
  listen()
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelIdle: (() => void) | undefined
  /** When the work was first asked for since it was last done. */
  let since = 0
  const cancel = () => {
    clearTimeout(timer)
    cancelIdle?.()
    timer = cancelIdle = undefined
    since = 0
  }
  const go = () => {
    cancel()
    work()
  }
  const check = () => {
    timer = undefined
    const now = performance.now()
    const wait = last + QUIET - now
    if (wait > 0 && now - since < LONGEST) timer = setTimeout(check, Math.min(wait, LONGEST - (now - since)))
    else cancelIdle ??= idle(go)
  }
  const ask = () => {
    const now = performance.now()
    if (!since) since = now
    // Asked for again and again (notes read one after another at startup), the work waits for the asking to stop;
    // but not for ever.
    if (cancelIdle || (timer !== undefined && now - since >= LONGEST)) return
    clearTimeout(timer)
    timer = setTimeout(check, delay)
  }
  return Object.assign(ask, { cancel })
}
