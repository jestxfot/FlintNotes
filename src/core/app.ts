import { Commands } from './commands'
import { EditorExtensions } from './editor/extensions'
import { LivePreview } from './editor/live-preview'
import { createMarkdownView } from './editor/markdown-view'
import { notice } from './notice'
import { PluginManager } from './plugin-manager'
import { Settings, type SettingsSection } from './settings'
import { StatusBar } from './status-bar'
import { Vault } from './vault'
import { Workspace } from './workspace'

const coreSettings: SettingsSection = {
  id: 'core',
  title: 'Основные',
  defs: [
    {
      key: 'theme',
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
      key: 'editorMode',
      name: 'Режим редактора',
      desc: 'Live Preview показывает оформление прямо в тексте и раскрывает разметку под курсором',
      type: 'select',
      default: 'live',
      options: [
        { value: 'live', label: 'Live Preview' },
        { value: 'source', label: 'Исходный текст' },
      ],
    },
    { key: 'fontSize', name: 'Размер шрифта', type: 'number', default: 16, min: 12, max: 24, step: 1 },
    {
      key: 'readableWidth',
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
  readonly editor = new EditorExtensions()
  readonly livePreview = new LivePreview(this)
  readonly statusBar = new StatusBar()
  readonly workspace = new Workspace(this)
  readonly plugins = new PluginManager(this)
  readonly notice = notice

  async init(): Promise<void> {
    await this.vault.load()
    await this.settings.load()
    this.settings.addSection(coreSettings)
    this.livePreview.init()
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
    this.workspace.restore()
    await this.plugins.init()
  }
}
