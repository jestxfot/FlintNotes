import type { App } from './app'
import { moment, type Moment } from './moment'
import { errorMessage } from './notice'
import * as paths from './path'
import { expandVariables } from './variables'

/** How the notes of one period are named and made; read anew each time, so a changed setting counts at once. */
export interface DatedNoteRule {
  unit: 'day' | 'week' | 'month' | 'year'
  /** «Ежедневная», «Еженедельная»...: words the question before creating a note begins with. */
  label: string
  /** The date in moment.js format; may contain folders (`YYYY-MM/YYYY-MM-DD`), as in Obsidian. */
  format: string
  folder: string
  template: string
}

/** The part of the templates plugin's service that is used here. */
interface TemplatesService {
  render(template: string, target: string, options?: { date?: Moment }): Promise<{ text: string; target: string; done(): Promise<void> }>
}

/**
 * Notes named by a date: the daily note, the note of a week, a month, a year.
 * Where each one lives and how it is created from its template. The daily notes
 * plugin and the calendar both keep theirs with this.
 */
export class DatedNotes {
  constructor(
    private app: App,
    private rule: () => DatedNoteRule,
  ) {}

  /** Where the note for the period containing `date` is, or would be. */
  path(date: Moment): string {
    const { folder, format } = this.rule()
    return `${paths.join(paths.normalize(folder), date.format(format))}.md`
  }

  /**
   * The existing note for that period: at its configured place, or, failing
   * that (not for days), a note with the right name anywhere in the vault.
   */
  find(date: Moment): string | null {
    const expected = this.path(date)
    if (this.app.vault.get(expected)) return expected
    if (this.rule().unit === 'day') return null
    return this.app.metadata.resolve(paths.basename(expected), expected)
  }

  /** The day (or first day of the period) a note stands for, read back from its path. */
  dateOf(notePath: string): Moment | null {
    const { format } = this.rule()
    const folder = paths.normalize(this.rule().folder)
    if (folder && !notePath.startsWith(`${folder}/`)) return null
    const name = paths.stripExt(folder ? notePath.slice(folder.length + 1) : notePath)
    const date = moment(name, format)
    // Formatting back must give the same name: "2026-10-09 notes" is not a daily note.
    return date.isValid() && date.format(format) === name ? date : null
  }

  /** Opens the note of the period containing `date`, creating it first if it does not exist. */
  async open(date: Moment, ask = false): Promise<void> {
    const path = await this.ensure(date, ask)
    if (path) this.app.workspace.openFile(path)
  }

  /**
   * Returns the note of the period containing `date`, creating it from its
   * template if it does not exist. With `ask`, the user confirms the creation
   * first; `null` means they declined or it failed.
   */
  async ensure(date: Moment, ask = false): Promise<string | null> {
    const { app } = this
    const rule = this.rule()
    const day = date.clone().startOf(rule.unit === 'week' ? 'isoWeek' : rule.unit)
    const existing = this.find(day)
    if (existing) return existing

    const target = this.path(day)
    const title = paths.stripExt(paths.basename(target))
    if (ask && !confirm(`${rule.label} заметка «${title}» ещё не создана. Создать?`)) return null
    try {
      let text = ''
      let path = target
      let done = async () => {}
      if (rule.template) {
        // With the templates plugin on, the template may contain code; without it, only {{date}} variables.
        const templates = app.services.get<TemplatesService>('templates')
        if (templates) ({ text, target: path, done } = await templates.render(rule.template, target, { date: day }))
        else {
          const file = app.metadata.resolve(rule.template, target) ?? (app.vault.get(`${rule.template}.md`) ? `${rule.template}.md` : null)
          if (!file) app.notice(`Шаблон «${rule.template}» не найден, заметка создана пустой`)
          else text = expandVariables(await app.vault.read(file), title, day)
        }
      }
      await app.vault.create(path, text)
      await done()
      return path
    } catch (err) {
      app.notice(`Не удалось создать заметку «${title}»: ${errorMessage(err)}`)
      return null
    }
  }
}
