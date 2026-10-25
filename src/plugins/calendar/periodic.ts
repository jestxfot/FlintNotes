import { DatedNotes, type App, type Moment, type Plugin } from '../../api'

export type Period = 'daily' | 'weekly' | 'monthly' | 'yearly'

export const PERIODS: { period: Period; label: string; unit: 'day' | 'week' | 'month' | 'year'; format: string }[] = [
  { period: 'daily', label: 'Ежедневная', unit: 'day', format: 'YYYY-MM-DD' },
  { period: 'weekly', label: 'Еженедельная', unit: 'week', format: 'GGGG-[W]WW' },
  { period: 'monthly', label: 'Ежемесячная', unit: 'month', format: 'YYYY-MM' },
  { period: 'yearly', label: 'Ежегодная', unit: 'year', format: 'YYYY' },
]

/**
 * Daily, weekly, monthly and yearly notes. The daily note is the «Ежедневные
 * заметки» plugin's (its `daily-notes` service); with that plugin off, days get
 * Obsidian's defaults: `YYYY-MM-DD` at the root, no template. The other periods
 * are set in the calendar's own settings.
 */
export class PeriodicNotes {
  private own = new Map<Period, DatedNotes>()

  constructor(
    private plugin: Plugin,
    private app: App = plugin.app,
  ) {
    for (const { period, label, unit, format } of PERIODS) {
      const setting = (name: string) => (period === 'daily' ? '' : (plugin.getSetting<string>(`${period}${name}`) ?? '').trim())
      this.own.set(period, new DatedNotes(app, () => ({ unit, label, format: setting('Format') || format, folder: setting('Folder'), template: setting('Template') })))
    }
  }

  private of(period: Period): DatedNotes {
    return (period === 'daily' && this.app.services.get<DatedNotes>('daily-notes')) || this.own.get(period)!
  }

  /** Where the note for the period containing `date` is, or would be. */
  path(period: Period, date: Moment): string {
    return this.of(period).path(date)
  }

  /** The existing note for that period; see `DatedNotes.find`. */
  find(period: Period, date: Moment): string | null {
    return this.of(period).find(date)
  }

  /** The day (or first day of the period) a note stands for, read back from its path. */
  dateOf(period: Period, notePath: string): Moment | null {
    return this.of(period).dateOf(notePath)
  }

  /** Opens the note of the period containing `date`, creating it first (after asking, if the calendar is set to) if it does not exist. */
  async open(period: Period, date: Moment): Promise<void> {
    await this.of(period).open(date, this.plugin.getSetting<boolean>('confirm'))
  }

  /** Returns the note of the period containing `date`, creating it if it does not exist; see `DatedNotes.ensure`. */
  ensure(period: Period, date: Moment, ask = false): Promise<string | null> {
    return this.of(period).ensure(date, ask)
  }
}
