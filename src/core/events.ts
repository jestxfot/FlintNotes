/** Unsubscribes a listener or undoes a registration. */
export type Off = () => void

/** Typed event emitter. `M` maps each event name to its argument tuple. */
export class Events<M extends Record<string, unknown[]>> {
  private handlers = new Map<keyof M, Set<(...args: any[]) => void>>()

  on<K extends keyof M>(name: K, handler: (...args: M[K]) => void): Off {
    let set = this.handlers.get(name)
    if (!set) this.handlers.set(name, (set = new Set()))
    set.add(handler)
    return () => void set.delete(handler)
  }

  trigger<K extends keyof M>(name: K, ...args: M[K]): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) {
      // One faulty listener (e.g. in a plugin) must not break the others.
      try {
        handler(...args)
      } catch (err) {
        console.error(`Error in "${String(name)}" handler`, err)
      }
    }
  }
}
