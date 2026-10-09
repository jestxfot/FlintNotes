import { errorMessage, expandVariables, moment, path as paths, type App, type Moment, type Plugin } from '../../api'

export type Period = 'daily' | 'weekly' | 'monthly' | 'yearly'

export const PERIODS: { period: Period; label: string; unit: string; format: string }[] = [
  { period: 'daily', label: 'Ежедневная', unit: 'day', format: 'YYYY-MM-DD' },
  { period: 'weekly', label: 'Еженедельная', unit: 'week', format: 'GGGG-[W]WW' },
  { period: 'monthly', label: 'Ежемесячная', unit: 'month', format: 'YYYY-MM' },
  { period: 'yearly', label: 'Ежегодная', unit: 'year', format: 'YYYY' },
]

const info = (period: Period) => PERIODS.find((p) => p.period === period)!

/** The part of the templates plugin's service that is used here. */
interface TemplatesService {
  render(template: string, target: string, options?: { date?: Moment }): Promise<{ text: string; target: string; done(): Promise<void> }>
}

/**
 * Daily, weekly, monthly and yearly notes: where each one lives and how it is
 * created. A note's name is its date in the configured format; the format may
 * contain folders (`YYYY-MM/YYYY-MM-DD`), as in Obsidian.
 */
export class PeriodicNotes {
  constructor(
    private plugin: Plugin,
    private app: App = plugin.app,
  ) {}

  private setting(period: Period, name: 'Format' | 'Folder' | 'Template'): string {
    return (this.plugin.getSetting<string>(`${period}${name}`) ?? '').trim()
  }

  format(period: Period): string {
    return this.setting(period, 'Format') || info(period).format
  }

  /** Where the note for the period containing `date` is, or would be. */
  path(period: Period, date: Moment): string {
    return `${paths.join(paths.normalize(this.setting(period, 'Folder')), date.format(this.format(period)))}.md`
  }

  /**
   * The existing note for that period: at its configured place, or, failing
   * that, a note with the right name anywhere in the vault.
   */
  find(period: Period, date: Moment): string | null {
    const expected = this.path(period, date)
    if (this.app.vault.get(expected)) return expected
    if (period === 'daily') return null
    return this.app.metadata.resolve(paths.basename(expected), expected)
  }

  /** The day (or first day of the period) a note stands for, read back from its path. */
  dateOf(period: Period, notePath: string): Moment | null {
    const folder = paths.normalize(this.setting(period, 'Folder'))
    if (folder && !notePath.startsWith(`${folder}/`)) return null
    const name = paths.stripExt(folder ? notePath.slice(folder.length + 1) : notePath)
    const date = moment(name, this.format(period))
    // Formatting back must give the same name: "2026-10-09 notes" is not a daily note.
    return date.isValid() && date.format(this.format(period)) === name ? date : null
  }

  /** Opens the note of the period containing `date`, creating it first if it does not exist. */
  async open(period: Period, date: Moment): Promise<void> {
    const path = await this.ensure(period, date, this.plugin.getSetting<boolean>('confirm'))
    if (path) this.app.workspace.openFile(path)
  }

  /**
   * Returns the note of the period containing `date`, creating it from its
   * template if it does not exist. With `ask`, the user confirms the creation
   * first; `null` means they declined or it failed.
   */
  async ensure(period: Period, date: Moment, ask = false): Promise<string | null> {
    const { app } = this
    const day = date.clone().startOf(info(period).unit === 'week' ? 'isoWeek' : info(period).unit)
    const existing = this.find(period, day)
    if (existing) return existing

    const target = this.path(period, day)
    const title = paths.stripExt(paths.basename(target))
    if (ask && !confirm(`${info(period).label} заметка «${title}» ещё не создана. Создать?`)) return null
    try {
      const template = this.setting(period, 'Template')
      let text = ''
      let path = target
      let done = async () => {}
      if (template) {
        // With the templates plugin on, the template may contain code; without it, only {{date}} variables.
        const templates = app.services.get<TemplatesService>('templates')
        if (templates) ({ text, target: path, done } = await templates.render(template, target, { date: day }))
        else {
          const file = app.metadata.resolve(template, target) ?? (app.vault.get(`${template}.md`) ? `${template}.md` : null)
          if (!file) app.notice(`Шаблон «${template}» не найден, заметка создана пустой`)
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
