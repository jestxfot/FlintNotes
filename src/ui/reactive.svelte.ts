import { createSubscriber } from 'svelte/reactivity'
import type { Events } from '../core/events'

/**
 * Bridges the framework-free core to Svelte: `current` re-reads `read()` whenever
 * one of the named events fires. `read` must return a new value each time (a
 * fresh array, not the same one mutated) for Svelte to see the change.
 */
export function watch<T>(source: Events<any>, names: string[], read: () => T) {
  const subscribe = createSubscriber((update) => {
    const offs = names.map((name) => source.on(name, update))
    return () => offs.forEach((off) => off())
  })
  return {
    get current(): T {
      subscribe()
      return read()
    },
  }
}
