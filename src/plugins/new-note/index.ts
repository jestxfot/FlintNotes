import { mount, unmount } from 'svelte'
import { errorMessage, Plugin, type Draft, type Off } from '../../api'
import Builder from './Builder.svelte'
import BuilderDialog from './BuilderDialog.svelte'
import CreateDialog from './CreateDialog.svelte'
import { TemplateStore } from './store'
import './style.css'

export default class NewNote extends Plugin {
  private store = new TemplateStore(this.app)
  private dialogs = new Set<() => void>()
  private pending = false
  private templateCommands: Off[] = []

  onload(): void {
    this.store.initialize()
    this.addSettings([
      { key: 'intercept', name: 'Форма для новых заметок', desc: 'Alt+N, кнопка «+» и создание в списке файлов открывают форму с выбором тематики', type: 'toggle', default: true },
      { key: 'linked', name: 'Форма при создании по ссылке', desc: 'Также показывать форму для несуществующих ссылок и новых имён в быстром переключателе', type: 'toggle', default: false },
      { key: 'builder', name: 'Конструктор шаблонов', desc: 'Настройте поля, теги, папку, имя файла и содержание заметки. Сохранённые шаблоны сразу доступны в форме создания и как команды', type: 'custom', render: (el) => {
        const component = mount(Builder, { target: el, props: { store: this.store } })
        return () => { void unmount(component) }
      } },
    ])
    this.addCommand({ id: 'create', name: 'Новая заметка: выбрать тематику', scope: 'vault', icon: 'file-plus-2', hotkey: 'Alt+Shift+N', callback: () => void this.create() })
    this.addCommand({ id: 'builder', name: 'Новая заметка: конструктор шаблонов', scope: 'vault', icon: 'layout-template', callback: () => this.builder() })
    this.register(this.app.creation.addPreparer(async (target) => {
      const origin = this.app.creation.placementOf(target)?.origin
      const intercept = this.getSetting<boolean>('intercept') && (origin === 'new' || origin === 'tree')
      const linked = this.getSetting<boolean>('linked') && (origin === 'link' || origin === 'switcher')
      if (!intercept && !linked) return undefined
      return this.form(target)
    }))
    this.refreshCommands()
    this.onSettingChange((key) => { if (key === 'library') this.refreshCommands() })
    this.register(() => { for (const off of this.templateCommands) off() })
    this.provide('new-note', { list: () => this.store.list(), create: (templateId?: string) => this.create(templateId), builder: () => this.builder() })
  }

  private refreshCommands(): void {
    for (const off of this.templateCommands) off()
    this.templateCommands = this.store.list().map((template) => this.app.commands.add({
      id: `new-note:template:${template.id}`, name: `Новая заметка: ${template.name}`, icon: 'file-plus-2', callback: () => void this.create(template.id),
    }))
  }

  private builder(): void {
    const target = document.body.appendChild(document.createElement('div'))
    const close = () => { this.dialogs.delete(close); void unmount(component); target.remove() }
    const component = mount(BuilderDialog, { target, props: { store: this.store, onclose: close } })
    this.dialogs.add(close)
  }

  private form(targetPath: string, templateId?: string): Promise<Draft | null> {
    if (this.pending) return Promise.resolve(null)
    this.pending = true
    const placement = this.app.creation.placementOf(targetPath)
    return new Promise((resolve) => {
      const target = document.body.appendChild(document.createElement('div'))
      let settled = false
      const close = (draft: Draft | null = null) => {
        if (settled) return
        settled = true
        this.pending = false
        this.dialogs.delete(cancel)
        void unmount(component)
        target.remove()
        resolve(draft)
      }
      const cancel = () => close()
      const component = mount(CreateDialog, { target, props: {
        store: this.store, targetPath, templateId,
        source: placement?.source ?? this.app.creation.activeNote(),
        explicitFolder: placement?.explicit ?? false,
        onclose: cancel, oncreate: close,
        onbuilder: () => this.builder(),
      } })
      this.dialogs.add(cancel)
    })
  }

  private async create(templateId?: string): Promise<void> {
    if (this.pending) return
    try {
      const folder = this.app.creation.defaultFolder()
      const draft = await this.form(this.app.vault.uniquePath(folder, 'Без названия', 'md'), templateId)
      if (!draft) return
      const entry = await this.app.creation.createDraft(draft)
      await this.app.workspace.openFile(entry.path)
    } catch (err) { this.app.notice(`Не удалось создать заметку: ${errorMessage(err)}`) }
  }

  onunload(): void {
    for (const close of [...this.dialogs]) close()
  }
}
