import { Explorer } from './explorer'
import { NoteCreation } from './creation'
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
import { openFind } from './editor/find-bar'
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
import { connection, Vault, vaultAddress } from './vault'
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
    { key: 'floatingSidebars', group: 'Интерфейс', name: 'Плавающие боковые панели', desc: 'Панели убраны и выезжают поверх заметки, когда указатель подведён к левому или правому краю окна; уезжают, когда указатель уходит. Ширина каждой панели запоминается. Кнопки панелей в полосе вкладок закрепляют панель открытой', type: 'toggle', default: false },
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
    { key: 'pinnedCompact', group: 'Интерфейс', name: 'Закреплённые вкладки значком', desc: 'Закреплённая вкладка показывает только значок заметки (или эмодзи, или первую букву названия) и занимает мало места. Закрепляется вкладка правым щелчком по ней', type: 'toggle', default: true },
    { key: 'confirmLeave', group: 'Интерфейс', name: 'Спрашивать перед закрытием страницы', desc: 'Пока открыты вкладки заметок, браузер переспросит «Покинуть сайт?» — случайный Ctrl+W не закроет приложение. Сам Ctrl+W браузер странице не отдаёт: вкладку заметки закрывает Alt+W, а в режиме «Во весь экран» (Alt+Enter) — и Ctrl+W', type: 'toggle', default: true },
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
/**
 * Starting with the computer is a matter of the machine, not of a vault: the
 * server keeps it as a file where the system looks for programs to run at
 * sign-in, and the setting shows and changes that file.
 */
/** Which widgets are in the sidebars, and a way to open any of them as a tab. */
const panelsSetting = (app: App): SettingsSection['defs'][number] => ({
  key: 'panels',
  group: 'Интерфейс',
  section: 'Панели',
  name: 'Панели плагинов',
  desc: 'Каждая панель может стоять в боковой панели, открываться отдельной вкладкой на всю страницу или быть убранной. Перетаскивайте значки панелей, чтобы переставить их; правый щелчок по значку — те же действия',
  type: 'custom',
  render: (el) => {
    const box = el.appendChild(document.createElement('div'))
    box.className = 'panel-settings'
    const draw = () => {
      box.replaceChildren()
      for (const def of app.panels.list().sort((a, b) => a.title.localeCompare(b.title))) {
        const row = box.appendChild(document.createElement('div'))
        row.className = 'panel-setting'
        row.appendChild(document.createElement('span')).textContent = def.title
        const label = row.appendChild(document.createElement('label'))
        const shown = label.appendChild(document.createElement('input'))
        shown.type = 'checkbox'
        shown.checked = !app.panels.isHidden(def.id)
        shown.onchange = () => app.panels.setHidden(def.id, !shown.checked)
        label.append(' в боковой панели')
        const tab = row.appendChild(document.createElement('button'))
        tab.textContent = 'Открыть вкладкой'
        tab.onclick = () => app.commands.run(`core:panel-tab:${def.id}`)
      }
    }
    draw()
    const off = app.panels.on('change', draw)
    return () => {
      off()
      box.remove()
    }
  },
})

/** The vaults the program knows, each with its address: any of them opens in a tab of the browser of its own. */
const vaultsSetting = (app: App): SettingsSection['defs'][number] => ({
  key: 'vaults',
  group: 'Программа',
  section: 'Хранилища',
  name: 'Адреса хранилищ',
  desc: 'У каждого хранилища свой адрес; его можно открыть в отдельной вкладке браузера, добавить в закладки или сделать ярлыком. Добавить или убрать хранилище — в меню внизу слева, «Управление хранилищами»',
  type: 'custom',
  render: (el) => {
    const box = el.appendChild(document.createElement('div'))
    box.className = 'panel-settings'
    void app.vault.vaults().then(
      (vaults) => {
        for (const vault of vaults) {
          const row = box.appendChild(document.createElement('div'))
          row.className = 'panel-setting'
          const name = row.appendChild(document.createElement('span'))
          name.textContent = vault.current ? `${vault.name} — открыто здесь` : vault.name
          name.title = vault.path
          const link = row.appendChild(document.createElement('a'))
          link.className = 'inline-link'
          link.href = vaultAddress(vault.name)
          link.target = '_blank'
          link.textContent = `${location.origin}${vaultAddress(vault.name)}`
          if (!vault.exists) link.replaceWith(Object.assign(document.createElement('small'), { textContent: 'папки больше нет' }))
        }
      },
      (err) => (box.textContent = err instanceof Error ? err.message : String(err)),
    )
    return () => box.remove()
  },
})

const autostartSetting = (app: App): SettingsSection['defs'][number] => ({
  key: 'autostart',
  group: 'Программа',
  section: 'Запуск',
  name: 'Запускать вместе с компьютером',
  desc: 'Сервер FlintNotes стартует при входе в систему, без окна, и все хранилища сразу доступны в браузере по своим адресам. Эта настройка одна на всю программу: она хранится на компьютере, а не в хранилище, и одинакова, какое бы хранилище ни было открыто',
  type: 'custom',
  render: (el) => {
    const row = el.appendChild(document.createElement('label'))
    row.className = 'autostart'
    const box = row.appendChild(document.createElement('input'))
    box.type = 'checkbox'
    box.className = 'switch autostart-switch'
    box.disabled = true
    const note = row.appendChild(document.createElement('small'))
    const show = (state: { supported: boolean; enabled: boolean; file?: string; reason?: string }) => {
      box.disabled = !state.supported
      box.checked = state.enabled
      note.textContent = !state.supported ? (state.reason ?? 'Недоступно в этой системе') : state.enabled ? `Включено: ${state.file}` : 'Выключено'
    }
    const fail = (err: unknown) => (note.textContent = err instanceof Error ? err.message : String(err))
    void app.vault.autostart().then(show, fail)
    box.onchange = () => void app.vault.setAutostart(box.checked).then(show, fail)
    // The command below changes the same thing while the page is open.
    const off = app.settings.on('change', (scope, key) => scope === 'core' && key === 'autostartSeen' && void app.vault.autostart().then(show, fail))
    return () => {
      off()
      row.remove()
    }
  },
})

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
  readonly creation = new NoteCreation(this)
  readonly explorer = new Explorer()
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
    await this.vault.identify()
    await Promise.all([this.vault.load(), this.state.load(), this.settings.load().then(() => this.plugins.preload())])
    this.panels.init()
    // Once only: the page may be set up again (a vault is switched), the list of settings is the same object.
    if (!coreSettings.defs.some((def) => def.key === 'panels')) coreSettings.defs.splice(coreSettings.defs.findIndex((def) => def.key === 'zoom'), 0, panelsSetting(this))
    if (!coreSettings.defs.some((def) => def.key === 'autostart')) coreSettings.defs.push(autostartSetting(this), vaultsSetting(this))
    this.settings.addSection(coreSettings)
    // One plain sign that the server is not answering, instead of an error from every part that asks it something.
    const down = this.statusBar.addItem()
    down.className = 'status-item server-down'
    down.textContent = 'Нет связи с сервером FlintNotes — запустите его заново'
    down.hidden = connection.online
    connection.on('change', (online) => {
      down.hidden = online
      if (online) notice('Связь с сервером FlintNotes восстановлена')
    })
    // Every widget of the sidebars can also be opened as a tab of its own, with the whole page to itself.
    // Nothing is asked of the plugins for it: a widget is the same thing in either place.
    const asTabs = new Map<string, () => void>()
    const syncPanelTabs = () => {
      const defs = new Map(this.panels.list().map((def) => [def.id, def]))
      for (const [id, off] of asTabs) {
        if (defs.has(id)) continue
        off()
        asTabs.delete(id)
      }
      for (const def of defs.values()) {
        if (asTabs.has(def.id)) continue
        const type = `panel-${def.id}`
        const offView = this.workspace.registerView(
          type,
          ({ containerEl }) => {
            containerEl.classList.add('panel-tab')
            const off = this.panels.get(def.id)?.mount(containerEl)
            return { destroy: () => off?.() }
          },
          [],
        )
        const offCommand = this.commands.add({ id: `core:panel-tab:${def.id}`, name: `Открыть «${def.title}» во вкладке`, icon: 'panel-top', scope: 'sidebar', callback: () => this.workspace.openView(type, def.title) })
        asTabs.set(def.id, () => {
          offView()
          offCommand()
        })
      }
    }
    this.panels.on('change', syncPanelTabs)
    this.menus.register('panel', (id: string, add) => {
      const def = this.panels.get(id)
      if (!def) return
      add({ icon: 'panel-top', title: 'Открыть во вкладке', onClick: () => this.workspace.openView(`panel-${id}`, def.title) })
      add({ icon: 'eye-off', title: 'Убрать из боковой панели', onClick: () => this.panels.setHidden(id, true) })
    })
    // Finding in the open note: the keys work in the editor itself; the commands are for the palette, menus and buttons.
    const inNote = (replace: boolean) => () => {
      const editor = this.workspace.activeEditor
      if (editor) openFind(editor, replace)
      else notice('Откройте заметку, чтобы искать в ней')
    }
    this.commands.add({ id: 'core:find', name: 'Найти в заметке', icon: 'search', scope: 'note', callback: inNote(false) })
    this.commands.add({ id: 'core:replace', name: 'Найти и заменить в заметке', icon: 'replace', scope: 'note', callback: inNote(true) })
    this.commands.add({
      id: 'core:toggle-autostart',
      name: 'Включить или выключить запуск вместе с компьютером',
      icon: 'power',
      callback: () =>
        void this.vault
          .autostart()
          .then((state) => (state.supported ? this.vault.setAutostart(!state.enabled) : Promise.reject(new Error(state.reason ?? 'Недоступно в этой системе'))))
          .then(
            (state) => {
              notice(state.enabled ? 'FlintNotes будет запускаться вместе с компьютером' : 'Запуск вместе с компьютером выключен')
              // Tells an open settings page to read the state again.
              this.settings.set('core', 'autostartSeen', Date.now())
            },
            (err) => notice(err instanceof Error ? err.message : String(err)),
          ),
    })
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
      scope: 'note',
      icon: 'code-xml',
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
