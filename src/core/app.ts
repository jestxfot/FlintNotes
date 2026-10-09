import { Commands } from './commands'
import { EditorExtensions } from './editor/extensions'
import { LivePreview } from './editor/live-preview'
import { MarkdownSyntax } from './editor/markdown'
import { createMarkdownView } from './editor/markdown-view'
import { Embeds } from './embeds'
import { Events } from './events'
import { MetadataCache } from './metadata'
import { notice } from './notice'
import { Panels } from './panels'
import { PluginManager } from './plugin-manager'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { DockedNotes } from './docked'
import { autoPairs } from './editor/pairs'
import { Icons } from './icons'
import { Menus } from './menu'
import { Toolbars } from './toolbars'
import { Router } from './router'
import { Services } from './services'
import { VaultState } from './state'
import { Settings, type SettingsSection } from './settings'
import { StatusBar } from './status-bar'
import type { SuggestOptions } from './suggest'
import { Vault } from './vault'
import { Workspace } from './workspace'

const coreSettings: SettingsSection = {
  id: 'core',
  title: 'Основные',
  defs: [
    // ---- Оформление
    {
      key: 'theme',
      group: 'Оформление',
      name: 'Тема',
      type: 'select',
      default: 'system',
      options: [
        { value: 'system', label: 'Как в системе' },
        { value: 'light', label: 'Светлая' },
        { value: 'dark', label: 'Тёмная' },
      ],
    },
    { key: 'fontSize', group: 'Оформление', name: 'Размер шрифта', desc: 'Меняется и колёсиком мыши с зажатым Ctrl', type: 'number', default: 16, min: 10, max: 32, step: 1 },

    // ---- Интерфейс
    { key: 'viewHeader', group: 'Интерфейс', name: 'Строка заголовка', desc: 'Строка над заметкой с кнопками «назад» и «вперёд» и путём к файлу', type: 'toggle', default: true },
    { key: 'ribbon', group: 'Интерфейс', name: 'Вертикальная панель', desc: 'Полосы кнопок по краям окна (их наполняет плагин «Быстрые кнопки и команды»)', type: 'toggle', default: true },
    { key: 'zoom', group: 'Интерфейс', section: 'Расширенные', name: 'Уровень масштабирования, %', desc: 'Общий масштаб приложения', type: 'number', default: 100, min: 50, max: 200, step: 5 },
    { key: 'nativeMenu', group: 'Интерфейс', section: 'Расширенные', name: 'Системное контекстное меню', desc: 'По правому щелчку показывать меню браузера, а не приложения', type: 'toggle', default: false },

    // ---- Редактор
    {
      key: 'editorMode',
      group: 'Редактор',
      name: 'Режим редактора по умолчанию',
      desc: 'Live Preview показывает оформление прямо в тексте и раскрывает разметку под курсором',
      type: 'select',
      default: 'live',
      options: [
        { value: 'live', label: 'Динамический просмотр' },
        { value: 'source', label: 'Исходный текст' },
      ],
    },
    { key: 'inlineTitle', group: 'Редактор', section: 'Отображение', name: 'Встроенный заголовок', desc: 'Имя файла как заголовок над текстом; его правка переименовывает заметку', type: 'toggle', default: true },
    { key: 'readableWidth', group: 'Редактор', section: 'Отображение', name: 'Ограничить максимальную длину строки', desc: 'Длинные абзацы читать удобнее, но на экране помещается меньше', type: 'toggle', default: true },
    {
      key: 'properties',
      group: 'Редактор',
      section: 'Отображение',
      name: 'Свойства в документе',
      desc: 'Показывать ли блок свойств в начале заметки (рисует его плагин «Свойства»)',
      type: 'select',
      default: 'visible',
      options: [
        { value: 'visible', label: 'Видимый' },
        { value: 'hidden', label: 'Скрытый' },
      ],
    },
    { key: 'spellcheck', group: 'Редактор', section: 'Режим работы', name: 'Проверять орфографию', desc: 'Подчёркивает слова с ошибками средствами браузера', type: 'toggle', default: false },
    { key: 'autoPair', group: 'Редактор', section: 'Режим работы', name: 'Закрывать скобки и кавычки', desc: 'Открывающая скобка или кавычка сразу получает закрывающую; выделенный текст оборачивается', type: 'toggle', default: true },

    // ---- Файлы и ссылки
    {
      key: 'reuseTab',
      group: 'Файлы и ссылки',
      name: 'Открывать заметки в текущей вкладке',
      desc: 'Заметка открывается на месте текущей; с зажатым Ctrl — в новой вкладке. Если выключить, каждая заметка открывается в своей вкладке',
      type: 'toggle',
      default: true,
    },
    {
      key: 'newNoteTab',
      group: 'Файлы и ссылки',
      name: 'Новую заметку открывать',
      desc: 'Для команды «Новая заметка» и создания в списке файлов. Кнопка «+» в полосе вкладок всегда открывает новую вкладку',
      type: 'select',
      default: 'current',
      options: [
        { value: 'current', label: 'в текущей вкладке' },
        { value: 'new', label: 'в новой вкладке' },
      ],
    },
    {
      key: 'newNoteLocation',
      group: 'Файлы и ссылки',
      name: 'Место для новых заметок',
      desc: 'Куда попадает заметка, созданная командой или кнопкой «+»',
      type: 'select',
      default: 'root',
      options: [
        { value: 'root', label: 'Корень хранилища' },
        { value: 'current', label: 'Папка открытой заметки' },
        { value: 'folder', label: 'Указанная папка' },
      ],
    },
    { key: 'newNoteFolder', group: 'Файлы и ссылки', name: 'Папка для новых заметок', desc: 'Используется, когда выше выбрана «Указанная папка»', type: 'text', default: '', placeholder: 'Заметки' },
    { key: 'confirmDelete', group: 'Файлы и ссылки', name: 'Спрашивать перед удалением', desc: 'Удалённое в любом случае попадает в папку .trash хранилища', type: 'toggle', default: true },
    {
      key: 'obsidianConfig',
      group: 'Файлы и ссылки',
      section: 'Obsidian',
      name: 'Папка настроек Obsidian',
      desc: 'Откуда плагины берут настройки Obsidian (шаблоны, ежедневные заметки). Пусто — папка с app.json, в которой Obsidian работал последним; иначе её имя, например .obsidian',
      type: 'text',
      default: '',
      placeholder: 'сама',
    },
  ],
}

/** The core: owns every subsystem. Plugins receive it as `this.app`. */
export class App {
  readonly vault = new Vault()
  readonly settings = new Settings(this.vault)
  readonly commands = new Commands()
  readonly metadata = new MetadataCache(this.vault)
  readonly editor = new EditorExtensions()
  readonly markdown = new MarkdownSyntax(this.editor)
  readonly livePreview = new LivePreview(this)
  readonly embeds = new Embeds()
  readonly statusBar = new StatusBar()
  readonly state = new VaultState(this.vault)
  readonly panels = new Panels(this.state)
  readonly workspace = new Workspace(this)
  readonly plugins = new PluginManager(this)
  readonly services = new Services()
  readonly router = new Router(this)
  readonly docked = new DockedNotes(this)
  readonly icons = new Icons()
  readonly menus = new Menus()
  readonly toolbars = new Toolbars()
  readonly notice = notice
  /** Requests handled by the UI layer. */
  readonly ui = new Events<{ suggest: [options: SuggestOptions<any>] }>()

  /** The folder Obsidian keeps this vault's settings in, if the vault is used with Obsidian. */
  get obsidianConfig(): string | undefined {
    const chosen = this.settings.get<string>('core', 'obsidianConfig')?.trim().replace(/^\/+|\/+$/g, '')
    return chosen || this.vault.obsidianConfigs[0]
  }

  /** Opens a pick-one dialog with a filter field. */
  suggest<T>(options: SuggestOptions<T>): void {
    this.ui.trigger('suggest', options)
  }

  /** Starts the core. Plugins are started separately, once the UI is in place. */
  async init(): Promise<void> {
    // The file list and the settings do not depend on each other; plugin code is
    // requested as soon as the settings say which plugins are on.
    await Promise.all([this.vault.load(), this.state.load(), this.settings.load().then(() => this.plugins.preload())])
    this.panels.init()
    this.settings.addSection(coreSettings)
    this.metadata.init()
    this.livePreview.init()
    this.embeds.on('change', () => this.livePreview.refresh())
    this.menus.native = () => this.settings.get<boolean>('core', 'nativeMenu')
    // Editor behaviour that is switched in the settings takes effect at once, in every open note.
    const switched = (key: string, extension: Extension) => {
      let off = this.settings.get<boolean>('core', key) ? this.editor.add(extension) : null
      this.settings.on('change', (scope, changed) => {
        if (scope !== 'core' || changed !== key) return
        off?.()
        off = this.settings.get<boolean>('core', key) ? this.editor.add(extension) : null
      })
    }
    switched('autoPair', autoPairs)
    switched('spellcheck', EditorView.contentAttributes.of({ spellcheck: 'true' }))
    this.commands.add({
      id: 'core:toggle-editor-mode',
      name: 'Переключить Live Preview и исходный текст',
      hotkey: 'Mod+E',
      callback: () => {
        const source = this.settings.get<string>('core', 'editorMode') === 'source'
        this.settings.set('core', 'editorMode', source ? 'live' : 'source')
      },
    })
    this.workspace.registerView('markdown', createMarkdownView, ['md'])
    this.docked.init()
    this.commands.setCustomHotkeys(this.settings.get<Record<string, string>>('core', 'hotkeys') ?? {})
  }
}
