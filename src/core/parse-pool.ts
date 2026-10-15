import { parseMarkdown, type CachedMetadata } from './metadata'
import type { ParseReply, ParseRequest } from './parse-worker'

/**
 * A few threads that parse notes for the index, one batch each at a time, so
 * that a first start parses on several processor cores at once while the page
 * stays free. Where the browser gives no threads, notes are parsed here.
 */
export class ParsePool {
  private workers: Worker[] = []
  private busy: number[] = []
  private waiting = new Map<number, (parsed: ParseReply['parsed']) => void>()
  private next = 0

  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))) {
    try {
      for (let i = 0; i < size; i++) {
        const worker = new Worker(new URL('./parse-worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<ParseReply>) => {
          this.busy[i]--
          this.waiting.get(event.data.id)?.(event.data.parsed)
          this.waiting.delete(event.data.id)
        }
        this.workers.push(worker)
        this.busy.push(0)
      }
    } catch {
      this.workers = []
    }
  }

  /** Parses a batch of notes on the least busy thread. */
  parse(notes: [path: string, text: string][]): Promise<[string, CachedMetadata][]> {
    if (!this.workers.length) return Promise.resolve(notes.map(([path, text]) => [path, parseMarkdown(text)]))
    const id = this.next++
    const index = this.busy.indexOf(Math.min(...this.busy))
    this.busy[index]++
    return new Promise((resolve) => {
      this.waiting.set(id, resolve)
      this.workers[index].postMessage({ id, notes } satisfies ParseRequest)
    })
  }

  close(): void {
    this.workers.forEach((worker) => worker.terminate())
    this.workers = []
  }
}
