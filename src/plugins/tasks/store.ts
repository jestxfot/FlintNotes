import { Events, type App, type Off } from '../../api'
import { today } from './dates'
import { parseTaskLine, toggleTaskLine, type Task } from './task'

/** Finds the tasks of one note. Lines inside code blocks are not tasks. */
export function parseTasks(path: string, text: string, headings: { text: string; line: number }[]): Task[] {
  const tasks: Task[] = []
  let fence: string | null = null
  let heading = 0
  text.split(/\r?\n/).forEach((raw, line) => {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw)
    if (fence) {
      if (fenceMatch && fenceMatch[1].startsWith(fence) && !fenceMatch[2].trim()) fence = null
      return
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      return
    }
    const parsed = parseTaskLine(raw)
    if (!parsed) return
    while (heading < headings.length && headings[heading].line < line) heading++
    const { prefix: _, ...fields } = parsed
    tasks.push({ ...fields, path, line, raw, heading: headings[heading - 1]?.text })
  })
  return tasks
}

/** Every task in the vault, kept current through the note index. */
export class TaskStore extends Events<{ change: [] }> {
  private cache = new Map<string, { text: string; tasks: Task[]; lines: string }>()
  private list: Task[] | null = null

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
      // Notes were added, removed or renamed, or their tags and properties changed.
      metadata.on('resolved', changed),
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
      const tasks = parseTasks(path, text, metadata.get(path)?.headings ?? [])
      entry = { text, tasks, lines: tasks.map((task) => `${task.line}\t${task.raw}`).join('\n') }
      this.cache.set(path, entry)
    }
    return entry
  }

  all(): Task[] {
    if (this.list) return this.list
    const seen = new Set<string>()
    const tasks: Task[] = []
    for (const path of this.app.metadata.notes()) {
      seen.add(path)
      tasks.push(...this.parse(path).tasks)
    }
    for (const path of this.cache.keys()) if (!seen.has(path)) this.cache.delete(path)
    return (this.list = tasks)
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
