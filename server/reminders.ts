// Reminders for the phone, from the server: the page that works out what is due is closed when nobody has the app open, so
// the server reads the notes itself and sends a message (to the phone, through ntfy on the home network) when one is due.
// "Due" is the page's own reading (src/plugins/tasks/due.ts, with the settings of the vault's `.flint/settings.json`), so a
// phone and a window never disagree. It does not need the page, a window or the PC to be on.
//
// What is asked of the world is given in `env`, so the rules can be tried with no network, no disk and a clock that is moved.

import { dueReminders, alertTime, isQuiet, parseTasks, reminderSettings, timedReminders, type Due } from '../src/plugins/tasks/due'
import type { Task } from '../src/plugins/tasks/task'

export interface ReminderEnv {
  /** The folders of the vaults whose reminders are sent. */
  vaults(): string[]
  /** The notes of a vault (markdown files, not hidden ones) with the time each was last changed. */
  notes(dir: string): Promise<{ path: string; mtime: number }[]>
  read(dir: string, path: string): Promise<string>
  /** The `tasks` part of the vault's settings, as stored, or nothing. */
  settings(dir: string): Promise<unknown>
  /** Sends one message; false if it did not go (nothing is then marked as sent). */
  send(message: { title: string; body: string }): Promise<boolean>
  /** What was sent already, kept between starts; nothing for none. */
  load(): Promise<Sent | undefined>
  save(state: Sent): Promise<void>
  now(): number
  name(dir: string): string
}

/** What was sent: by the key of a reminder, the moment of the alert it was sent for. `since` is when sending began. */
export interface Sent {
  since: number
  sent: Record<string, number>
}

/** At most this many separate messages at once; the rest are told in one (a start after days off, an imported plan). */
const MOST_AT_ONCE = 6
const FORGET_AFTER = 30 * 24 * 60 * 60_000

/** What a message says about a task: its words without the marks of links. */
export function plainWords(text: string): string {
  return text
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const pad = (n: number) => String(n).padStart(2, '0')

export class PhoneReminders {
  private tasks = new Map<string, { mtime: number; tasks: Task[]; plain: Task[] }>()
  private state: Sent | undefined
  private busy = false
  private persisted = false

  constructor(private env: ReminderEnv) {}

  /** Reads what changed in the notes since the last look. */
  private async refresh(dir: string): Promise<{ tasks: Task[]; plain: Task[] }> {
    const notes = await this.env.notes(dir)
    const live = new Set<string>()
    const all: Task[] = []
    const plains: Task[] = []
    for (const { path, mtime } of notes) {
      const id = `${dir}\0${path}`
      live.add(id)
      let known = this.tasks.get(id)
      if (!known || known.mtime !== mtime) {
        const plain: Task[] = []
        const text = await this.env.read(dir, path).catch(() => '')
        known = { mtime, tasks: text.includes('[') || text.includes('(@') ? parseTasks(path, text, [], plain) : [], plain }
        this.tasks.set(id, known)
      }
      all.push(...known.tasks)
      plains.push(...known.plain)
    }
    for (const id of this.tasks.keys()) if (id.startsWith(`${dir}\0`) && !live.has(id)) this.tasks.delete(id)
    return { tasks: all, plain: plains }
  }

  /** One look: what is due and not yet sent is sent. Returns how many messages went. */
  async tick(): Promise<number> {
    if (this.busy) return 0
    this.busy = true
    try {
      const now = this.env.now()
      if (!this.state) {
        const kept = await this.env.load()
        this.persisted = !!kept
        this.state = kept ?? { since: now, sent: {} }
      }
      const state = this.state
      let went = 0
      let changed = false
      for (const dir of this.env.vaults()) {
        const { tasks, plain } = await this.refresh(dir)
        const settings = reminderSettings(await this.env.settings(dir).catch(() => undefined))
        if (isQuiet(settings, new Date(now))) continue
        const prefix = `${this.env.name(dir)}|`
        const timed = timedReminders(settings.remindPlain ? [...tasks, ...plain] : tasks, settings, now)
        const fresh = dueReminders(timed, settings, now).filter((due) => alertTime(due, settings) > state.since && (state.sent[prefix + due.key] ?? 0) < alertTime(due, settings))
        const separate = fresh.slice(0, MOST_AT_ONCE)
        for (const due of separate) {
          if (!(await this.env.send(this.message(due)))) continue
          state.sent[prefix + due.key] = alertTime(due, settings)
          went++
          changed = true
        }
        const rest = fresh.slice(MOST_AT_ONCE)
        if (rest.length && separate.length === MOST_AT_ONCE) {
          const text = rest.map((due) => plainWords(due.task.description)).slice(0, 5).join('; ')
          if (await this.env.send({ title: `Ещё напоминаний: ${rest.length}`, body: text })) {
            for (const due of rest) state.sent[prefix + due.key] = alertTime(due, settings)
            went++
            changed = true
          }
        }
      }
      for (const [key, at] of Object.entries(state.sent)) if (at < now - FORGET_AFTER) (delete state.sent[key], (changed = true))
      if (changed || !this.persisted) (await this.env.save(state), (this.persisted = true))
      return went
    } finally {
      this.busy = false
    }
  }

  /** What the phone shows: the words of the task, the time, and the note it is in. */
  private message(due: Due): { title: string; body: string } {
    const when = `${pad(due.at.getHours())}:${pad(due.at.getMinutes())}`
    const note = due.task.path.slice(due.task.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
    return { title: due.task.plain ? 'Напоминание' : 'Напоминание о задаче', body: `${plainWords(due.task.description) || 'Напоминание'}\n${when} · ${note}` }
  }

  /** Looks every `every` ms; the returned function stops it. */
  start(every = 30_000): () => void {
    const look = () => void this.tick().catch((err) => console.error('Напоминания для телефона:', err))
    const timer = setInterval(look, every)
    timer.unref()
    setTimeout(look, 3000).unref()
    return () => clearInterval(timer)
  }
}
