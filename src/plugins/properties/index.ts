import { Plugin } from '../../api'
import { propertiesForm, type SmartDates } from './form'
import { yearlyBadge, type DateSense } from './smart-dates'
import './style.css'

export default class Properties extends Plugin {
  onload() {
    this.addSettings([
      {
        key: 'smartDates',
        name: 'Подсказки у дат',
        desc: 'Рядом со свойством-датой: сколько осталось или прошло; у дня рождения и годовщины — сколько лет и через сколько дней следующая; у срока — сколько осталось или на сколько просрочен. Что значит дата, угадывается по имени свойства или выбирается в его меню («Подсказка у даты»). Заметка при этом не меняется',
        type: 'toggle',
        default: true,
      },
      {
        key: 'birthdayLinks',
        name: 'Дни рождения у ссылок',
        desc: 'Ссылка на заметку с днём рождения (или другой ежегодной датой) получает 🎂: за две недели — со счётом дней, в сам день — «сегодня» и сколько исполнилось. Наведите на 🎂, чтобы увидеть дату и возраст',
        type: 'toggle',
        default: true,
      },
    ])
    // What each date property means, by its name, for the whole vault: as Obsidian keeps the types of properties.
    const redraws = new Set<() => void>()
    const smart: SmartDates = {
      enabled: () => this.getSetting<boolean>('smartDates') !== false,
      chosen: (key) => this.getSetting<Record<string, DateSense> | undefined>('dateSenses')?.[key],
      choose: (key, sense) => {
        const senses = { ...this.getSetting<Record<string, DateSense> | undefined>('dateSenses') }
        if (sense === 'auto') delete senses[key]
        else senses[key] = sense
        this.setSetting('dateSenses', senses)
      },
      watch: (redraw) => (redraws.add(redraw), () => redraws.delete(redraw)),
    }
    this.onSettingChange((key) => {
      if (key === 'dateSenses' || key === 'smartDates') redraws.forEach((redraw) => redraw())
      if (key === 'dateSenses' || key === 'birthdayLinks') this.app.livePreview.refresh()
    })
    // Links to people (to any note with a date that comes back every year) say when it comes.
    this.registerLinkBadge((path) => (this.getSetting<boolean>('birthdayLinks') === false ? null : yearlyBadge(this.app.metadata.get(path)?.frontmatter, smart.chosen)))
    this.registerBlockRenderer('Frontmatter', (source, root, ctx) => propertiesForm(source, root, ctx, smart))

    this.addCommand({
      id: 'add',
      name: 'Добавить свойства в заметку',
      callback: () => {
        const editor = this.app.workspace.activeEditor
        if (!editor) return
        if (editor.state.doc.line(1).text.trimEnd() === '---') {
          this.app.notice('В этой заметке уже есть блок свойств')
          return
        }
        const br = editor.state.lineBreak
        const block = `---${br}свойство: ${br}---${br}`
        // The cursor goes below the block, so the block shows as a form at once.
        editor.dispatch({ changes: { from: 0, insert: block }, selection: { anchor: block.length + editor.state.selection.main.head } })
      },
    })
  }
}
