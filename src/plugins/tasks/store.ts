import { Events, type App, type Off } from '../../api'
import { today } from './dates'
import { parseTasks } from './due'
import { toggleTaskLine, type Task } from './task'

export { parseTasks }

/** Every task in the vault, kept current through the note index. */
export class TaskStore extends Events<{ change: [] }> {
  private cache = new Map<string, { text: string; tasks: Task[]; plain: Task[]; lines: string }>()
  private list: Task[] | null = null
  private plainList: Task[] = []

  constructor(private app: App) {
    super()
  }

  /** Begins following the vault; returns how to stop. */
  start(): Off {
    const { metadata } = this.app
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = () => {
      this.list = null
      // Notes change in bursts (typing, startup); lists are redrawn once per burst.
      clearTimeout(timer)
      timer = setTimeout(() => this.trigger('change'), 120)
    }
    const offs = [
      // A note's text changed. Most edits do not touch its tasks, and then nothing needs redrawing.
      metadata.on('changed', (path) => {
        const before = this.cache.get(path)?.lines
        if (this.parse(path).lines !== before) changed()
      }),
      // Notes were added, removed or renamed, or their tags and properties changed. A list of tasks may ask
      // about the note of each task (its tags, its properties), so the notes that matter are those with tasks.
      metadata.on('resolved', (what) => {
        if (!what.notes || [...what.notes].some((path) => this.parse(path).lines)) changed()
      }),
    ]
    return () => {
      clearTimeout(timer)
      offs.forEach((off) => off())
    }
  }

  private parse(path: string) {
    const { metadata } = this.app
    const text = metadata.text(path) ?? ''
    let entry = this.cache.get(path)
    // Only notes whose text changed are parsed again.
    if (entry?.text !== text) {
      const plain: Task[] = []
      const tasks = parseTasks(path, text, metadata.get(path)?.headings ?? [], plain)
      entry = { text, tasks, plain, lines: [...tasks, ...plain].map((task) => `${task.line}\t${task.raw}`).join('\n') }
      this.cache.set(path, entry)
    }
    return entry
  }

  all(): Task[] {
    if (this.list) return this.list
    const seen = new Set<string>()
    const tasks: Task[] = []
    const plain: Task[] = []
    for (const path of this.app.metadata.notes()) {
      seen.add(path)
      const entry = this.parse(path)
      tasks.push(...entry.tasks)
      if (entry.plain.length) plain.push(...entry.plain)
    }
    for (const path of this.cache.keys()) if (!seen.has(path)) this.cache.delete(path)
    this.plainList = plain
    return (this.list = tasks)
  }

  /** Ordinary lines that carry a reminder: they are not tasks and appear in no task list. */
  plain(): Task[] {
    this.all()
    return this.plainList
  }

  /** Rewrites a task's line in its file; `edit` may return several lines. */
  async edit(task: Task, edit: (raw: string) => string[]): Promise<void> {
    const { app } = this
    // Unsaved edits of the open note must be on disk before it is rewritten there.
    await app.workspace.flushAll()
    const text = await app.vault.read(task.path)
    const lines = text.split(/\r?\n/)
    // The note may have changed since the list was drawn; find the line again.
    const index = lines[task.line] === task.raw ? task.line : lines.indexOf(task.raw)
    if (index < 0) {
      app.notice('Задача изменилась в заметке, список сейчас обновится')
      return
    }
    lines.splice(index, 1, ...edit(lines[index]))
    await app.vault.write(task.path, lines.join(text.includes('\r\n') ? '\r\n' : '\n'))
  }

  toggle(task: Task): Promise<void> {
    return this.edit(task, (raw) => toggleTaskLine(raw, today()))
  }
}
