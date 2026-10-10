import { createSubscriber } from 'svelte/reactivity'
import type { Events } from '../core/events'

/**
 * Bridges the framework-free core to Svelte: `current` re-reads `read()` whenever
 * one of the named events fires. `read` must return a new value each time (a
 * fresh array, not the same one mutated) for Svelte to see the change.
 */
/**
 * `calm` is for values that are costly to read and whose events come in floods
 * (the list of files while another program is writing hundreds of them): the
 * value is then read again at most once in that many milliseconds, after the
 * flood's latest event, instead of once for every event.
 */
export function watch<T>(source: Events<any>, names: string[], read: () => T, calm = 0) {
  const subscribe = createSubscriber((update) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = () => {
      timer ??= setTimeout(() => {
        timer = undefined
        update()
      }, calm)
    }
    const offs = names.map((name) => source.on(name, calm ? later : update))
    return () => {
      clearTimeout(timer)
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
