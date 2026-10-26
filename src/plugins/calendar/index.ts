import { mount, unmount } from 'svelte'
import { moment, Plugin, type SettingDef } from '../../api'
import CalendarBoard from './CalendarBoard.svelte'
import CalendarPanel from './CalendarPanel.svelte'
import { PeriodicNotes, PERIODS, type Period } from './periodic'

const PANEL = 'calendar'

export default class Calendar extends Plugin {
  async onload() {
    const { app } = this
    // The daily note's are the «Ежедневные заметки» plugin's.
    const periodSettings = PERIODS.filter(({ period }) => period !== 'daily').flatMap(({ period, label, format }): SettingDef[] => [
      { key: `${period}Format`, name: `${label} заметка: имя`, desc: `Дата в формате moment.js; может включать папки. Пусто — ${format}`, type: 'text', default: '', placeholder: format },
      { key: `${period}Folder`, name: `${label} заметка: папка`, desc: 'Пусто — корень хранилища', type: 'text', default: '' },
      { key: `${period}Template`, name: `${label} заметка: шаблон`, desc: 'Путь к шаблону новой заметки. Пусто — пустая заметка', type: 'text', default: '' },
    ])
    this.addSettings([
      {
        key: 'weekStart',
        name: 'Первый день недели',
        desc: 'С какого дня начинается неделя в календаре',
        type: 'select',
        default: 'monday',
        options: [
          { value: 'monday', label: 'Понедельник' },
          { value: 'sunday', label: 'Воскресенье' },
        ],
      },
      { key: 'weekNumbers', name: 'Номера недель', desc: 'Столбец номеров недель слева. Щелчок по номеру открывает заметку недели', type: 'toggle', default: true },
      { key: 'confirm', name: 'Спрашивать перед созданием заметки', desc: 'Щелчок по дню без заметки сначала спрашивает, создавать ли её', type: 'toggle', default: true },
      {
        key: 'wordsPerDot',
        name: 'Слов на одну точку',
        desc: 'Точки под днём показывают, сколько написано в его заметке: одна точка на столько слов',
        type: 'number',
        default: 250,
        min: 1,
        max: 5000,
      },
      { key: 'boardField', section: 'Календарь во вкладке', name: 'На какой день ставить задачу', desc: 'По какой дате задача попадает в клетку календаря во вкладке', type: 'select', default: 'happens', options: [{ value: 'happens', label: 'Срок, иначе план, иначе начало' }, { value: 'due', label: 'Срок 📅' }, { value: 'scheduled', label: 'Запланировано ⏳' }, { value: 'start', label: 'Начало 🛫' }] },
      { key: 'boardTasks', section: 'Календарь во вкладке', name: 'Показывать задачи с датой из всех заметок', desc: 'Задачи со сроком, планом или началом из всего хранилища. Нужен плагин «Задачи»', type: 'toggle', default: true },
      { key: 'boardNote', section: 'Календарь во вкладке', name: 'Показывать задачи из заметки дня', desc: 'Задачи, записанные в самой заметке дня', type: 'toggle', default: true },
      { key: 'boardPlan', section: 'Календарь во вкладке', name: 'Показывать строки плана дня (со временем)', desc: 'Строки плана дня вида «- [ ] 17:00 - 17:10 Дело»', type: 'toggle', default: true },
      { key: 'boardDone', section: 'Календарь во вкладке', name: 'Показывать выполненное', desc: 'Выполненные задачи остаются в клетках дней', type: 'toggle', default: true },
      { key: 'boardLines', section: 'Календарь во вкладке', name: 'Строк в клетке месяца', desc: 'Сколько строк задач помещается в клетку на виде месяца', type: 'number', default: 4, min: 1, max: 20 },
      ...periodSettings,
    ])
    await this.moveDailyNotes()
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
        // In a sidebar: the small month. With the page to itself: the large calendar with the day's tasks.
        const panel = mount(target.classList.contains('panel-tab') ? CalendarBoard : CalendarPanel, { target, props: { app, plugin: this, notes } })
        return () => void unmount(panel)
      },
    })

    // The day's own commands (Alt+D and the like) are the «Ежедневные заметки» plugin's.
    const open = (period: Period) => void notes.open(period, moment())
    this.addCommand({ id: 'week', name: 'Открыть заметку недели', callback: () => open('weekly') })
    this.addCommand({ id: 'month', name: 'Открыть заметку месяца', callback: () => open('monthly') })
    this.addCommand({ id: 'year', name: 'Открыть заметку года', callback: () => open('yearly') })
    this.addCommand({ id: 'show', name: 'Показать календарь', callback: () => app.panels.reveal(PANEL) })
    this.addCommand({ id: 'import', name: 'Взять настройки календаря из Obsidian', callback: () => void this.importFromObsidian(true) })
  }

  /**
   * The daily note had its settings here until it got a plugin of its own,
   * «Ежедневные заметки». Once, they move there, and that plugin is switched on
   * beside the calendar, so the days stay where they were and Alt+D still works.
   */
  private async moveDailyNotes(): Promise<void> {
    const { settings, plugins } = this.app
    if (this.getSetting<boolean>('dailyMoved')) return
    this.setSetting('dailyMoved', true)
    const keys = { dailyFormat: 'format', dailyFolder: 'folder', dailyTemplate: 'template', openOnStart: 'openOnStart' }
    for (const [old, key] of Object.entries(keys)) {
      const value = this.getSetting(old)
      if (value === undefined) continue
      settings.set('daily-notes', key, value)
      this.setSetting(old, undefined)
    }
    // Obsidian's daily note settings were taken already; they are not to be taken again over the user's own.
    if (this.getSetting<boolean>('imported')) settings.set('daily-notes', 'imported', true)
    // Stored first and enabled without storing: the list stored when this plugin is
    // switched on must not be written while the other one is still loading.
    const enabled = settings.get<string[] | undefined>('core', 'enabledPlugins') ?? []
    if (enabled.includes('daily-notes')) return
    settings.set('core', 'enabledPlugins', [...enabled, 'daily-notes'])
    await plugins.enable('daily-notes', false)
  }

  /**
   * Copies the periodic note settings of Obsidian (its Periodic Notes and
   * Calendar plugins) from the vault, so both apps create the same notes in the
   * same places. Done once by itself on first use. The daily note's are taken
   * by the «Ежедневные заметки» plugin.
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
    const periodic = config ? await read('plugins/periodic-notes/data.json') : null
    const calendar = config ? await read('plugins/calendar/data.json') : null
    if (!periodic && !calendar) {
      if (asked) app.notice('В хранилище не найдены настройки календаря и периодических заметок Obsidian')
      return
    }
    const set = (period: Period, source: any) => {
      if (!source) return
      for (const [key, name] of [['format', 'Format'], ['folder', 'Folder'], ['template', 'Template']]) {
        if (source[key]) this.setSetting(`${period}${name}`, String(source[key]).replace(/\.md$/, ''))
      }
    }
    for (const { period } of PERIODS) if (period !== 'daily') set(period, periodic?.[period])
    if (calendar) {
      set('weekly', { format: calendar.weeklyNoteFormat, folder: calendar.weeklyNoteFolder, template: calendar.weeklyNoteTemplate })
      if (calendar.weekStart === 'sunday' || calendar.weekStart === 'monday') this.setSetting('weekStart', calendar.weekStart)
      if (typeof calendar.shouldConfirmBeforeCreate === 'boolean') this.setSetting('confirm', calendar.shouldConfirmBeforeCreate)
      if (typeof calendar.wordsPerDot === 'number') this.setSetting('wordsPerDot', calendar.wordsPerDot)
      if (typeof calendar.showWeeklyNote === 'boolean') this.setSetting('weekNumbers', calendar.showWeeklyNote)
    }
    app.notice(`Настройки календаря взяты из Obsidian (${config})`)
  }
}
