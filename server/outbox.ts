// The messages for the phone's app, kept for a while: a phone that was away (asleep, out of the wifi, the app restarted) is
// given what it missed when it comes back, by the number of the last message it has. The reminders (server/reminders.ts)
// are put here; the app (android/) reads them from a stream (`/api/reminders/stream`).

import fs from 'node:fs/promises'

export interface Message {
  id: number
  time: number
  title: string
  body: string
}

const KEEP = 200
const FOR = 24 * 60 * 60_000

export class Outbox {
  private list: Message[] = []
  private next = 1
  private listeners = new Set<(message: Message) => void>()
  private writing = Promise.resolve()

  /** `file`: where the messages are kept between starts; none: only in memory (tests). */
  constructor(
    private file?: string,
    private now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    if (!this.file) return
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as { next?: unknown; list?: unknown }
      if (Array.isArray(data.list)) this.list = data.list.filter((one): one is Message => !!one && typeof one.id === 'number' && typeof one.time === 'number' && typeof one.title === 'string' && typeof one.body === 'string')
      this.next = Math.max(typeof data.next === 'number' ? data.next : 1, ...this.list.map((one) => one.id + 1))
    } catch {
      // Nothing kept yet, or a file that cannot be read: it starts empty.
    }
  }

  /** The number of the last message; 0 if there was none. A new phone asks for what comes after this one. */
  latest(): number {
    return this.next - 1
  }

  push(message: { title: string; body: string }): Message {
    const made: Message = { id: this.next++, time: this.now(), title: message.title, body: message.body }
    this.list.push(made)
    this.list = this.list.filter((one) => one.time > this.now() - FOR).slice(-KEEP)
    this.save()
    for (const listener of this.listeners) listener(made)
    return made
  }

  /** What came after message `id`, oldest first. */
  since(id: number): Message[] {
    return this.list.filter((one) => one.id > id && one.time > this.now() - FOR)
  }

  subscribe(listener: (message: Message) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private save(): void {
    const file = this.file
    if (!file) return
    const text = JSON.stringify({ next: this.next, list: this.list })
    this.writing = this.writing
      .then(async () => {
        await fs.writeFile(`${file}.part`, text)
        await fs.rename(`${file}.part`, file)
      })
      .catch(() => {})
  }

  /** Waits for what is being written. */
  flush(): Promise<void> {
    return this.writing
  }
}
