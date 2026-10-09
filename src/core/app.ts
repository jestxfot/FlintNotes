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
import { DockedNotes } from './docked'
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
    {
      key: 'theme', group: 'Оформление',
      name: 'Тема',
      type: 'select',
      default: 'system',
      options: [
        { value: 'system', label: 'Как в системе' },
        { value: 'light', label: 'Светлая' },
        { value: 'dark', label: 'Тёмная' },
      ],
    },
    {
      key: 'editorMode', group: 'Редактор',
      name: 'Режим редактора',
      desc: 'Live Preview показывает оформление прямо в тексте и раскрывает разметку под курсором',
      type: 'select',
      default: 'live',
      options: [
        { value: 'live', label: 'Live Preview' },
        { value: 'source', label: 'Исходный текст' },
      ],
    },
    { key: 'fontSize', group: 'Оформление', name: 'Размер шрифта', desc: 'Меняется и колёсиком мыши с зажатым Ctrl', type: 'number', default: 16, min: 10, max: 32, step: 1 },
    {
      key: 'obsidianConfig', group: 'Файлы и ссылки',
      name: 'Папка настроек Obsidian',
      desc: 'Откуда плагины берут настройки Obsidian (шаблоны, ежедневные заметки). Пусто — папка с app.json, в которой Obsidian работал последним; иначе её имя, например .obsidian',
      type: 'text',
      default: '',
      placeholder: 'сама',
    },
    {
      key: 'reuseTab', group: 'Файлы и ссылки',
      name: 'Открывать заметки в текущей вкладке',
      desc: 'Заметка открывается на месте текущей; с зажатым Ctrl — в новой вкладке. Если выключить, каждая заметка открывается в своей вкладке',
      type: 'toggle',
      default: true,
    },
    { key: 'inlineTitle', group: 'Оформление', name: 'Название заметки над текстом', desc: 'Правка названия переименовывает заметку', type: 'toggle', default: true },
    {
      key: 'readableWidth', group: 'Оформление',
      name: 'Удобная ширина строки',
      desc: 'Ограничивает ширину текста в редакторе',
      type: 'toggle',
      default: true,
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
