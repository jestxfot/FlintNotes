import { createSubscriber } from 'svelte/reactivity'
import type { Events } from '../core/events'
import { whenQuiet } from '../core/quiet'

export interface WatchOptions {
  /** Read again at most once in that many milliseconds, after the latest event of a flood. */
  calm?: number
  /** Read again only once the typing has stopped for a moment (see `whenQuiet`). */
  quiet?: boolean
  /**
   * The element that shows the value: while it is out of sight (a widget behind another one of its sidebar,
   * a closed sidebar) the value is not read again; it is, once, when the element comes into sight.
   */
  shown?: () => Element | null | undefined
}

/**
 * Bridges the framework-free core to Svelte: `current` re-reads `read()` whenever
 * one of the named events fires. `read` must return a new value each time (a
 * fresh array, not the same one mutated) for Svelte to see the change.
 *
 * `calm` (a number, or `options.calm`) is for values that are costly to read and whose events come in floods
 * (the list of files while another program is writing hundreds of them): the
 * value is then read again at most once in that many milliseconds, after the
 * flood's latest event, instead of once for every event. A value that is costly
 * to read and follows the notes (a search, the tags of the vault) should be read
 * `quiet`ly, and only where it is `shown`: a note being typed in changes the notes
 * at every pause in the typing.
 */
export function watch<T>(source: Events<any>, names: string[], read: () => T, options: number | WatchOptions = 0) {
  const { calm = 0, quiet = false, shown } = typeof options === 'number' ? { calm: options } : options
  const subscribe = createSubscriber((update) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let held = false
    let seen: IntersectionObserver | undefined
    /**
     * Whether the element is in sight, as the browser last said. It is told, not asked: asked in the middle of
     * going to another tab, the browser would lay the whole page out there and then.
     */
    let inSight = true
    // Out of sight, the value waits; it is read when the element comes into sight.
    const fresh = () => {
      const el = shown?.()
      if (el && !seen) {
        seen = new IntersectionObserver((entries) => {
          inSight = entries[entries.length - 1].isIntersecting
          if (!inSight || !held) return
          held = false
          update()
        })
        seen.observe(el)
      }
      if (el && !inSight) return void (held = true)
      held = false
      update()
    }
    const soon = quiet ? whenQuiet(fresh, calm || 100) : undefined
    const later = () => {
      timer ??= setTimeout(() => {
        timer = undefined
        fresh()
      }, calm)
    }
    const offs = names.map((name) => source.on(name, soon ?? (calm ? later : fresh)))
    return () => {
      clearTimeout(timer)
      soon?.cancel()
      seen?.disconnect()
      offs.forEach((off) => off())
    }
  })
  return {
    get current(): T {
      subscribe()
      return read()
    },
  }
}
