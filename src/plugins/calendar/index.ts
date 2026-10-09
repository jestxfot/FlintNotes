import { mount, unmount } from 'svelte'
import { moment, Plugin, type SettingDef } from '../../api'
import CalendarPanel from './CalendarPanel.svelte'
import { PeriodicNotes, PERIODS, type Period } from './periodic'

const PANEL = 'calendar'

export default class Calendar extends Plugin {
  async onload() {
    const { app } = this
    const periodSettings = PERIODS.flatMap(({ period, label, format }): SettingDef[] => [
      {
        key: `${period}Format`,
        name: `${label} заметка: имя`,
        desc: period === 'daily' ? 'Дата в формате moment.js; может включать папки, например YYYY-MM/YYYY-MM-DD' : undefined,
        type: 'text',
        default: '',
        placeholder: format,
      },
      { key: `${period}Folder`, name: `${label} заметка: папка`, type: 'text', default: '' },
      { key: `${period}Template`, name: `${label} заметка: шаблон`, type: 'text', default: '' },
    ])
    this.addSettings([
      {
        key: 'weekStart',
        name: 'Первый день недели',
        type: 'select',
        default: 'monday',
        options: [
          { value: 'monday', label: 'Понедельник' },
          { value: 'sunday', label: 'Воскресенье' },
        ],
      },
      { key: 'weekNumbers', name: 'Номера недель', desc: 'Щелчок по номеру открывает заметку недели', type: 'toggle', default: true },
      { key: 'confirm', name: 'Спрашивать перед созданием заметки', type: 'toggle', default: true },
      {
        key: 'wordsPerDot',
        name: 'Слов на одну точку',
        desc: 'Точки под днём показывают, сколько написано в его заметке',
        type: 'number',
        default: 250,
        min: 1,
        max: 5000,
      },
      {
        key: 'openOnStart',
        name: 'Открывать заметку дня при запуске',
        desc: 'Если заметки на сегодня ещё нет, она создаётся по шаблону. Если приложение осталось открытым за полночь, заметка нового дня тоже создаётся сама',
        type: 'toggle',
        default: false,
      },
      ...periodSettings,
    ])
    await this.importFromObsidian(false)

    const notes = new PeriodicNotes(this)
    this.provide('periodic-notes', notes)

    this.addPanel({
      id: PANEL,
      title: 'Календарь',
      side: 'right',
      icon: 'M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3',
      compact: true,
      mount: (target) => {
        const panel = mount(CalendarPanel, { target, props: { app, plugin: this, notes } })
        return () => void unmount(panel)
      },
    })

    const open = (period: Period, shift = 0) => void notes.open(period, moment().add(shift, period === 'daily' ? 'day' : period.replace('ly', '')))
    this.addCommand({ id: 'today', name: 'Открыть заметку дня', hotkey: 'Alt+D', callback: () => open('daily') })
    this.addCommand({ id: 'tomorrow', name: 'Открыть заметку на завтра', callback: () => open('daily', 1) })
    this.addCommand({ id: 'yesterday', name: 'Открыть вчерашнюю заметку', callback: () => open('daily', -1) })
    this.addCommand({ id: 'week', name: 'Открыть заметку недели', callback: () => open('weekly') })
    this.addCommand({ id: 'month', name: 'Открыть заметку месяца', callback: () => open('monthly') })
    this.addCommand({ id: 'year', name: 'Открыть заметку года', callback: () => open('yearly') })
    this.addCommand({ id: 'show', name: 'Показать календарь', callback: () => app.panels.reveal(PANEL) })

    // From a daily note, step to the day before or after it.
    const step = (days: number) => {
      const active = app.workspace.active?.path
      const date = (active && notes.dateOf('daily', active)) || moment()
      void notes.open('daily', date.add(days, 'day'))
    }
    this.addCommand({ id: 'next-day', name: 'Следующий день', hotkey: 'Mod+Alt+ArrowRight', callback: () => step(1) })
    this.addCommand({ id: 'previous-day', name: 'Предыдущий день', hotkey: 'Mod+Alt+ArrowLeft', callback: () => step(-1) })
    this.addCommand({ id: 'import', name: 'Взять настройки календаря из Obsidian', callback: () => void this.importFromObsidian(true) })

    if (this.getSetting<boolean>('openOnStart')) {
      // Asked for in the settings, so today's note is created without a question.
      // Plugins load before tabs are restored; the daily note opens after them, on top.
      setTimeout(async () => {
        const today = await notes.ensure('daily', moment())
        if (today) app.workspace.openFile(today, { newTab: true })
      })
      // Obsidian only does this at launch. A tab left open overnight gets the new
      // day's note too, without being switched away from what is on screen.
      let day = moment().format('YYYY-MM-DD')
      const timer = setInterval(async () => {
        const now = moment().format('YYYY-MM-DD')
        if (now === day || !this.getSetting<boolean>('openOnStart')) return
        day = now
        if (!notes.find('daily', moment()) && (await notes.ensure('daily', moment()))) app.notice(`Создана заметка дня ${now}`)
      }, 60_000)
      this.register(() => clearInterval(timer))
    }
  }

  /**
   * Copies the daily and periodic note settings of Obsidian (its Daily notes,
   * Periodic Notes and Calendar plugins) from the vault, so both apps create
   * the same notes in the same places. Done once by itself on first use.
   */
  private async importFromObsidian(asked: boolean): Promise<void> {
    const { app } = this
    if (!asked && this.getSetting<boolean>('imported')) return
    this.setSetting('imported', true)
    const config = app.obsidianConfig
    const read = async (file: string): Promise<any> => {
      try {
        return JSON.parse((await app.vault.readOptional(`${config}/${file}`)) ?? 'null')
      } catch {
        return null
      }
    }
    const daily = config ? await read('daily-notes.json') : null
    const periodic = config ? await read('plugins/periodic-notes/data.json') : null
    const calendar = config ? await read('plugins/calendar/data.json') : null
    const core = config ? await read('app.json') : null
    if (!daily && !periodic && !calendar) {
      if (asked) app.notice('В хранилище не найдены настройки ежедневных заметок Obsidian')
      return
    }
    const set = (period: Period, source: any) => {
      if (!source) return
      for (const [key, name] of [['format', 'Format'], ['folder', 'Folder'], ['template', 'Template']]) {
        if (source[key]) this.setSetting(`${period}${name}`, String(source[key]).replace(/\.md$/, ''))
      }
    }
    set('daily', daily)
    for (const { period } of PERIODS) set(period, periodic?.[period])
    if (calendar) {
      set('weekly', { format: calendar.weeklyNoteFormat, folder: calendar.weeklyNoteFolder, template: calendar.weeklyNoteTemplate })
      if (calendar.weekStart === 'sunday' || calendar.weekStart === 'monday') this.setSetting('weekStart', calendar.weekStart)
      if (typeof calendar.shouldConfirmBeforeCreate === 'boolean') this.setSetting('confirm', calendar.shouldConfirmBeforeCreate)
      if (typeof calendar.wordsPerDot === 'number') this.setSetting('wordsPerDot', calendar.wordsPerDot)
      if (typeof calendar.showWeeklyNote === 'boolean') this.setSetting('weekNumbers', calendar.showWeeklyNote)
    }
    if (core?.openBehavior === 'daily') this.setSetting('openOnStart', true)
    app.notice(`Настройки календаря взяты из Obsidian (${config})`)
  }
}
