import { cm, Plugin } from '../../api'
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
        name: 'Дни рождения: 🎂 у ссылок и выделение «ДР»',
        desc: 'Ссылка на заметку с днём рождения (или другой ежегодной датой) получает 🎂 и сколько дней осталось (в последние две недели и в сам день — ярче). Наведите, чтобы увидеть дату и возраст. Слова «ДР» и «день рождения» в тексте выделяются везде',
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
      if (key === 'birthdayLinks') markWords()
      if (key === 'dateSenses' || key === 'birthdayLinks') this.app.livePreview.refresh()
    })
    // «ДР» and «день рождения» stand out wherever they are written, with or without a link to the person.
    const BIRTHDAY_WORD = /(?<![\p{L}\p{N}_])(?:ДР|[Дд]ень рождения)(?![\p{L}\p{N}_])/gu
    this.registerWordMark({ pattern: BIRTHDAY_WORD, className: 'word-birthday', title: 'День рождения' })
    const { MatchDecorator, ViewPlugin, Decoration } = cm.view
    const decorator = new MatchDecorator({ regexp: BIRTHDAY_WORD, decoration: Decoration.mark({ class: 'word-birthday' }) })
    this.registerEditorExtension(
      ViewPlugin.fromClass(
        class {
          decorations
          constructor(view: InstanceType<typeof cm.view.EditorView>) {
            this.decorations = decorator.createDeco(view)
          }
          update(update: Parameters<typeof decorator.updateDeco>[0]) {
            this.decorations = decorator.updateDeco(update, this.decorations)
          }
        },
        { decorations: (plugin) => plugin.decorations },
      ),
    )
    const markWords = () => document.body.classList.toggle('no-word-birthday', this.getSetting<boolean>('birthdayLinks') === false)
    markWords()
    this.register(() => document.body.classList.remove('no-word-birthday'))
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
