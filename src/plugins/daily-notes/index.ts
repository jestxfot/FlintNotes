import { DatedNotes, moment, Plugin } from '../../api'

/**
 * The note of each day, as Obsidian's Daily notes: its name, folder and template,
 * the commands that open it, and its creation at start. Other plugins (the
 * calendar, the day planner, links to a date) find and make daily notes through
 * the `daily-notes` service.
 */
export default class DailyNotes extends Plugin {
  async onload() {
    const { app } = this
    this.addSettings([
      {
        key: 'format',
        name: 'Имя заметки',
        desc: 'Дата в формате moment.js; может включать папки, например YYYY-MM/YYYY-MM-DD',
        type: 'text',
        default: '',
        placeholder: 'YYYY-MM-DD',
      },
      { key: 'folder', name: 'Папка', type: 'text', default: '' },
      { key: 'template', name: 'Шаблон', type: 'text', default: '' },
      {
        key: 'confirm',
        name: 'Спрашивать перед созданием заметки',
        desc: 'Alt+D и другие команды дня спрашивают, создавать ли заметку, которой ещё нет. При запуске и после полуночи заметка создаётся без вопроса',
        type: 'toggle',
        default: false,
      },
      {
        key: 'openOnStart',
        name: 'Открывать заметку дня при запуске',
        desc: 'Если заметки на сегодня ещё нет, она создаётся по шаблону. Если приложение осталось открытым за полночь, заметка нового дня тоже создаётся сама',
        type: 'toggle',
        default: false,
      },
    ])
    await this.importFromObsidian(false)

    const setting = (key: string) => (this.getSetting<string>(key) ?? '').trim()
    const notes = new DatedNotes(app, () => ({
      unit: 'day',
      label: 'Ежедневная',
      format: setting('format') || 'YYYY-MM-DD',
      folder: setting('folder'),
      template: setting('template'),
    }))
    this.provide('daily-notes', notes)

    const open = (shift: number) => void notes.open(moment().add(shift, 'day'), this.getSetting<boolean>('confirm'))
    this.addCommand({ id: 'today', name: 'Открыть заметку дня', hotkey: 'Alt+D', callback: () => open(0) })
    this.addCommand({ id: 'tomorrow', name: 'Открыть заметку на завтра', callback: () => open(1) })
    this.addCommand({ id: 'yesterday', name: 'Открыть вчерашнюю заметку', callback: () => open(-1) })
    // From a daily note, step to the day before or after it.
    const step = (days: number) => {
      const active = app.workspace.active?.path
      const date = (active && notes.dateOf(active)) || moment()
      void notes.open(date.add(days, 'day'), this.getSetting<boolean>('confirm'))
    }
    this.addCommand({ id: 'next-day', name: 'Следующий день', hotkey: 'Mod+Alt+ArrowRight', callback: () => step(1) })
    this.addCommand({ id: 'previous-day', name: 'Предыдущий день', hotkey: 'Mod+Alt+ArrowLeft', callback: () => step(-1) })
    this.addCommand({ id: 'import', name: 'Взять настройки ежедневных заметок из Obsidian', callback: () => void this.importFromObsidian(true) })

    if (this.getSetting<boolean>('openOnStart')) {
      // Asked for in the settings, so today's note is created without a question.
      // Plugins load before tabs are restored; the daily note opens after them, on top.
      setTimeout(async () => {
        const today = await notes.ensure(moment())
        if (today) app.workspace.openFile(today, { newTab: true })
      })
    }
    // Obsidian only does this at launch. A tab left open overnight gets the new
    // day's note too, without being switched away from what is on screen.
    let day = moment().format('YYYY-MM-DD')
    const timer = setInterval(async () => {
      const now = moment().format('YYYY-MM-DD')
      if (now === day) return
      day = now
      if (this.getSetting<boolean>('openOnStart') && !notes.find(moment()) && (await notes.ensure(moment()))) app.notice(`Создана заметка дня ${now}`)
    }, 60_000)
    this.register(() => clearInterval(timer))
  }

  /**
   * Copies the settings of Obsidian's Daily notes (and the daily part of
   * Periodic Notes, which overrides them there) from the vault, so both apps
   * create the same note in the same place. Done once by itself on first use.
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
    const periodic = config ? (await read('plugins/periodic-notes/data.json'))?.daily : null
    const core = config ? await read('app.json') : null
    if (!daily && !periodic && core?.openBehavior !== 'daily') {
      if (asked) app.notice('В хранилище не найдены настройки ежедневных заметок Obsidian')
      return
    }
    for (const source of [daily, periodic]) {
      if (!source) continue
      for (const key of ['format', 'folder', 'template']) {
        if (source[key]) this.setSetting(key, String(source[key]).replace(/\.md$/, ''))
      }
    }
    if (core?.openBehavior === 'daily') this.setSetting('openOnStart', true)
    app.notice(`Настройки ежедневных заметок взяты из Obsidian (${config})`)
  }
}
