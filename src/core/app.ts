import { RibbonItems } from './ribbon-items'
import { NotePositions } from './positions'
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
import { FORMAT_COMMANDS } from './editor/format'
import { phoneSetting } from './phone-setting'
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
import { desktop, type DesktopUpdates } from './desktop'
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
    // Each sidebar floats over the note or stays beside it; a right click on a sidebar or its button switches it too.
    { key: 'floatingLeft', group: 'Интерфейс', section: 'Боковые панели', name: 'Левая панель плавающая', desc: 'Панель убрана и выезжает поверх заметки, когда указатель подведён к левому краю окна; уезжает, когда указатель уходит. Выключено — панель прикреплена и стоит рядом с заметкой. То же переключает правый щелчок по панели или по её кнопке', type: 'toggle', default: false },
    { key: 'floatingRight', group: 'Интерфейс', section: 'Боковые панели', name: 'Правая панель плавающая', desc: 'То же для правой панели. Ширина каждой панели запоминается; кнопка панели в полосе вкладок закрепляет плавающую панель открытой', type: 'toggle', default: false },
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
    { key: 'defaultReading', group: 'Редактор', name: 'Открывать заметки для чтения', desc: 'Заметка открывается без возможности случайно её изменить; переключается кнопкой с книгой над заметкой или Ctrl+Shift+E', type: 'toggle', default: false },
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

    { key: 'rememberPosition', group: 'Редактор', section: 'Режим работы', name: 'Помнить место в заметке', desc: 'Заметка открывается там, где её оставили: курсор и прокрутка — и по кнопкам «Назад» и «Вперёд», и при открытии заново', type: 'toggle', default: true },

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
    { key: 'ribbonTabs', group: 'Интерфейс', name: 'Кнопка на боковой полосе — сама вкладка', desc: 'Вид плагина, открытый кнопкой на полосе у края окна (граф, напоминания, менеджер задач…), показывается на странице без вкладки в полосе вкладок: его вкладка — сама кнопка, она подсвечена, пока вид на экране; второй щелчок возвращает к прежней вкладке. Выключено — кнопка открывает обычную вкладку', type: 'toggle', default: true },
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

/** The port is the program's, not a vault's: the server keeps it with the list of vaults. */
const portSetting = (app: App): SettingsSection['defs'][number] => ({
  key: 'port',
  group: 'Программа',
  section: 'Запуск',
  name: 'Порт',
  desc: 'Адрес FlintNotes в браузере — http://localhost:порт. Сменить его стоит, если порт нужен другой программе. Сервер сразу переходит на новый порт, эта страница — за ним; закладки на старый адрес работать перестанут',
  type: 'custom',
  render: (el) => {
    const row = el.appendChild(document.createElement('div'))
    row.className = 'port-setting'
    const input = row.appendChild(document.createElement('input'))
    input.type = 'number'
    input.min = '1024'
    input.max = '65535'
    input.disabled = true
    const apply = row.appendChild(document.createElement('button'))
    apply.className = 'setting-button'
    apply.textContent = 'Применить'
    apply.disabled = true
    const note = row.appendChild(document.createElement('small'))
    let current = 0
    const fail = (err: unknown) => {
      note.textContent = err instanceof Error ? err.message : String(err)
      apply.disabled = false
    }
    void app.vault.port().then(({ port, fixed }) => {
      current = port
      input.value = String(port)
      input.disabled = fixed
      note.textContent = fixed ? 'Задан при запуске переменной FLINT_PORT' : ''
    }, fail)
    input.oninput = () => (apply.disabled = Number(input.value) === current)
    apply.onclick = () => {
      apply.disabled = true
      note.textContent = 'Перехожу на новый порт…'
      // What is not saved yet goes to the server while it still listens here.
      void Promise.all([app.workspace.flushAll(), app.state.flush()])
        .then(() => app.vault.setPort(Number(input.value)))
        .then(async ({ port }) => {
        const next = new URL(location.href)
        next.port = String(port)
        // In development the page comes from Vite, which keeps its own port: only the server moves.
        if (location.port !== String(current)) return void (note.textContent = `Сервер перешёл на порт ${port}`)
        await waitFor(next.origin)
        location.href = next.href
      }, fail)
    }
    return () => row.remove()
  },
})

/** The proxy is the program's too: link cards and video descriptions come through it. */
const proxySetting = (app: App): SettingsSection['defs'][number] => ({
  key: 'proxy',
  group: 'Программа',
  section: 'Сеть',
  name: 'Прокси',
  desc: 'Через что сервер FlintNotes ходит в интернет за карточками ссылок, описаниями видео и т. п. «Как у компьютера» — прокси из настроек Windows или HTTPS_PROXY. Свой прокси — HTTP (http://127.0.0.1:8080) или SOCKS5 (socks5://127.0.0.1:1080), с именем и паролем: socks5://имя:пароль@адрес:порт',
  type: 'custom',
  render: (el) => {
    const row = el.appendChild(document.createElement('div'))
    row.className = 'proxy-setting'
    const mode = row.appendChild(document.createElement('select'))
    for (const [value, label] of [
      ['system', 'Как у компьютера'],
      ['manual', 'Свой прокси'],
      ['off', 'Без прокси'],
    ]) mode.append(new Option(label, value))
    const input = row.appendChild(document.createElement('input'))
    input.type = 'text'
    input.placeholder = 'socks5://127.0.0.1:1080'
    input.spellcheck = false
    const apply = row.appendChild(document.createElement('button'))
    apply.className = 'setting-button'
    apply.textContent = 'Применить'
    const check = row.appendChild(document.createElement('button'))
    check.className = 'setting-button'
    check.textContent = 'Проверить'
    const note = row.appendChild(document.createElement('small'))
    let saved = ''
    let computer: string | null = null
    const chosen = () => (mode.value === 'manual' ? input.value.trim() : mode.value)
    const refresh = () => {
      input.hidden = mode.value !== 'manual'
      apply.disabled = chosen() === saved || (mode.value === 'manual' && !input.value.trim())
      if (mode.value === 'system') note.textContent = computer ? `Сейчас у компьютера: ${computer}` : 'У компьютера прокси не задан: сервер ходит напрямую'
      else if (note.dataset.kind !== 'result') note.textContent = ''
    }
    const fail = (err: unknown) => {
      note.dataset.kind = 'result'
      note.textContent = err instanceof Error ? err.message : String(err)
    }
    void app.vault.proxy().then((answer) => {
      saved = answer.proxy
      computer = answer.computer
      mode.value = saved === 'system' || saved === 'off' ? saved : 'manual'
      if (mode.value === 'manual') input.value = saved
      refresh()
    }, fail)
    mode.onchange = input.oninput = () => (delete note.dataset.kind, refresh())
    apply.onclick = () => {
      apply.disabled = true
      void app.vault.setProxy(chosen()).then(({ proxy }) => {
        saved = proxy
        // Pictures follow the new way at once, not in half a minute.
        navigator.serviceWorker?.controller?.postMessage({ type: 'proxy-changed' })
        refresh()
        note.dataset.kind = 'result'
        note.textContent = 'Сохранено, действует сразу'
      }, (err) => (fail(err), refresh()))
    }
    // Whether a page that is often closed (Telegram) opens for the server the way that is saved now.
    check.onclick = () => {
      check.disabled = true
      note.dataset.kind = 'result'
      note.textContent = 'Проверяю t.me…'
      void app.vault
        .netCheck('https://t.me/telegram')
        .then(({ steps }) => {
          const way = steps.find((step) => step.step.startsWith('Через прокси')) ?? steps.find((step) => step.step.startsWith('Напрямую'))
          const proxy = steps.find((step) => step.step === 'Прокси')
          note.textContent = way ? `${proxy ? `Прокси ${proxy.result}. ` : ''}${way.step}: ${way.ok ? '✓' : '✗'} ${way.result} — ${way.ms} мс` : 'Сервер ничего не ответил'
        }, fail)
        .finally(() => (check.disabled = false))
    }
    return () => row.remove()
  },
})

/** Waits until the server answers at its new address (it moves a moment after saying yes). */
async function waitFor(origin: string): Promise<void> {
  for (let tries = 0; tries < 50; tries++) {
    // Another port is another site to the browser: an opaque answer is enough to know someone is there.
    if (await fetch(`${origin}/api/port`, { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false)) return
    await new Promise((resume) => setTimeout(resume, 100))
  }
}

/** A build id (the time it was made) as a date to read. */
const builtAt = (id: string) => (/^\d{4}-/.test(id) ? new Date(id).toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'для разработки')

/** Which build the page and the server are, and whether the next one will come by itself. */
const buildSetting = (): SettingsSection['defs'][number] => ({
  key: 'build',
  group: 'Программа',
  section: 'Обновление',
  name: 'Сборка',
  desc: desktop
    ? 'После новой сборки (npm run release) приложение само заменяет сервер и перезагружает окно, сохранив набранное'
    : 'После новой сборки (npm run release) программа запуска сама заменяет сервер, а открытые страницы перезагружаются сами, сохранив набранное: обновлять страницу вручную не нужно',
  type: 'custom',
  render: (el) => {
    const row = el.appendChild(document.createElement('div'))
    row.className = 'build-info'
    const show = () => {
      const server = connection.server
      const page = __FLINT_BUILD__
      row.replaceChildren(
        ...[
          `Эта страница: ${builtAt(page)}`,
          server ? `Сервер: ${server.build === page ? 'та же сборка' : builtAt(server.build)}` : 'Сервер: нет связи',
          !server
            ? ''
            : server.updates
              ? 'Новые сборки подхватываются сами'
              : desktop
                ? 'Приложение запущено без папки сборок: новую версию приносит новый установщик'
                : 'Сервер запущен без программы запуска: новую сборку он не подхватит. Запускайте приложение FlintNotes или node release/launcher.mjs',
        ]
          .filter(Boolean)
          .map((text) => Object.assign(document.createElement('small'), { textContent: text })),
      )
    }
    show()
    const off = connection.on('build', show)
    return () => {
      off()
      row.remove()
    }
  },
})

/** The installed desktop app's updates from the project's releases: by themselves, or only when asked. */
const appUpdatesSetting = (app: App): SettingsSection['defs'][number] => ({
  key: 'appUpdates',
  group: 'Программа',
  section: 'Обновление',
  name: 'Версия и обновления',
  desc: 'Новые версии приходят с GitHub: FlintNotes загружает их в фоне и спрашивает, перезапуститься ли сейчас. Небольшие обновления ставятся за пару секунд',
  type: 'custom',
  render: (el) => {
    const box = el.appendChild(document.createElement('div'))
    box.className = 'update-box'
    const head = box.appendChild(document.createElement('div'))
    head.className = 'update-head'
    const mark = head.appendChild(document.createElement('span'))
    mark.className = 'update-mark'
    const what = head.appendChild(document.createElement('div'))
    what.className = 'update-what'
    const title = what.appendChild(document.createElement('b'))
    const status = what.appendChild(document.createElement('small'))
    const actions = head.appendChild(document.createElement('div'))
    actions.className = 'update-actions'
    const check = actions.appendChild(document.createElement('button'))
    check.className = 'setting-button'
    check.textContent = 'Проверить'
    const install = actions.appendChild(document.createElement('button'))
    install.className = 'setting-button primary'
    install.textContent = 'Перезапустить и обновить'
    install.hidden = true
    const bar = box.appendChild(document.createElement('div'))
    bar.className = 'update-bar'
    bar.hidden = true
    const fill = bar.appendChild(document.createElement('div'))
    const auto = box.appendChild(document.createElement('label'))
    auto.className = 'update-auto'
    const toggle = auto.appendChild(document.createElement('input'))
    toggle.type = 'checkbox'
    toggle.className = 'switch app-updates-switch'
    toggle.disabled = true
    auto.append('Обновляться автоматически')

    let shownIcon = ''
    const icon = (name: string) => {
      if (name === shownIcon) return
      shownIcon = name
      mark.replaceChildren(app.icons.draw(name))
    }
    const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} МБ`
    const at = (time?: number) => (time ? new Date(time).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '')
    let timer: ReturnType<typeof setTimeout> | undefined
    let gone = false

    const show = (info: DesktopUpdates, said?: string) => {
      toggle.disabled = !info.supported
      toggle.checked = info.enabled
      title.textContent = info.version ? `FlintNotes ${info.version}` : 'FlintNotes'
      const built = `сборка ${builtAt(__FLINT_BUILD__)}`
      install.hidden = !info.ready || !!info.checking
      check.disabled = !info.supported || !!info.checking
      bar.hidden = !info.progress
      let tone = ''
      if (!info.supported) {
        icon('package')
        status.textContent = `${built}. Обновления приходят только установленному приложению`
      } else if (info.progress) {
        icon('download')
        const { loaded, total } = info.progress
        bar.classList.toggle('unknown', !total)
        fill.style.width = total ? `${Math.min(100, (loaded / total) * 100)}%` : ''
        status.textContent = `Загружаю версию ${info.progress.version}${info.progress.light ? '' : ' (установщик)'}: ${mb(loaded)}${total ? ` из ${mb(total)}` : ''}`
      } else if (info.checking) {
        icon('refresh-cw')
        status.textContent = 'Проверяю…'
      } else if (info.ready) {
        icon('circle-arrow-up')
        tone = 'ready'
        status.textContent = `Версия ${info.ready} загружена. ${info.light ? 'Перезапуск займёт пару секунд' : 'Установка займёт около минуты'}; если отложить — при следующем запуске`
      } else {
        // The version is in the title already.
        const result = (said || info.result || '').replace(/\s*\([\d.]+\)$/, '')
        tone = result.startsWith('Не удалось') ? 'error' : 'ok'
        icon(tone === 'error' ? 'circle-alert' : 'circle-check')
        const checked = info.checkedAt ? `проверено в ${at(info.checkedAt)}` : ''
        status.textContent = [result || (checked ? 'Установлена последняя версия' : built), checked].filter(Boolean).join(' · ')
      }
      box.dataset.tone = tone
      // While something goes on, the settings follow it.
      clearTimeout(timer)
      if (!gone && (info.checking || info.progress)) timer = setTimeout(() => void desktop?.updates().then((next) => show(next), fail), 400)
    }
    const fail = (err: unknown) => {
      box.dataset.tone = 'error'
      icon('circle-alert')
      status.textContent = err instanceof Error ? err.message : String(err)
      check.disabled = false
    }
    if (!desktop) return () => box.remove()
    void desktop.updates().then((info) => show(info), fail)
    toggle.onchange = () => void desktop?.setUpdates(toggle.checked).then((info) => show(info), fail)
    check.onclick = () => {
      check.disabled = true
      icon('refresh-cw')
      status.textContent = 'Проверяю…'
      void desktop?.checkUpdates().then((info) => show(info, info.result), fail)
    }
    install.onclick = () => {
      install.disabled = true
      status.textContent = 'Сохраняю и перезапускаю…'
      void desktop?.installUpdate().then((started) => !started && ((install.disabled = false), (status.textContent = 'Загруженная версия пропала: проверьте ещё раз')), fail)
    }
    return () => {
      gone = true
      clearTimeout(timer)
      box.remove()
    }
  },
})

const autostartSetting = (app: App): SettingsSection['defs'][number] => ({
  key: 'autostart',
  group: 'Программа',
  section: 'Запуск',
  name: 'Запускать вместе с компьютером',
  desc: desktop
    ? 'FlintNotes запускается при входе в Windows свёрнутым в область уведомлений: напоминания приходят, даже если окно ещё не открывали. Эта настройка одна на всю программу и одинакова, какое бы хранилище ни было открыто'
    : 'Сервер FlintNotes стартует при входе в систему, без окна, и все хранилища сразу доступны в браузере по своим адресам. Эта настройка одна на всю программу: она хранится на компьютере, а не в хранилище, и одинакова, какое бы хранилище ни было открыто',
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
      note.textContent = !state.supported ? (state.reason ?? 'Недоступно в этой системе') : state.enabled ? (state.file ? `Включено: ${state.file}` : 'Включено') : 'Выключено'
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
  /** Where each note was left, to open it there again. */
  readonly positions = new NotePositions(this.state, this.vault)
  readonly panels = new Panels(this.state)
  readonly workspace = new Workspace(this)
  readonly plugins = new PluginManager(this)
  readonly services = new Services()
  readonly router = new Router(this)
  readonly docked = new DockedNotes(this)
  readonly icons = new Icons()
  readonly creation = new NoteCreation(this)
  readonly explorer = new Explorer()
  readonly ribbonItems = new RibbonItems(this)
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
    performance.mark('flint:identify')
    this.metadata.prefetch()
    const done = (name: string) => () => performance.mark(`flint:${name}`)
    await Promise.all([this.vault.load().then(done('tree')), this.state.load().then(done('state')), this.settings.load().then(done('settings')).then(() => this.plugins.preload())])
    this.panels.init()
    // Once only: the page may be set up again (a vault is switched), the list of settings is the same object.
    if (!coreSettings.defs.some((def) => def.key === 'panels')) coreSettings.defs.splice(coreSettings.defs.findIndex((def) => def.key === 'zoom'), 0, panelsSetting(this))
    if (!coreSettings.defs.some((def) => def.key === 'autostart')) coreSettings.defs.push(
        // The desktop app has no port and no addresses to open in a browser.
        ...(desktop ? [autostartSetting(this), proxySetting(this), phoneSetting(this), appUpdatesSetting(this)] : [autostartSetting(this), portSetting(this), proxySetting(this), phoneSetting(this), buildSetting(), vaultsSetting(this)]),
      )
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
    this.commands.add({
      id: 'core:toggle-reading',
      name: 'Переключить чтение и редактирование заметки',
      icon: 'book-open',
      scope: 'note',
      hotkey: 'Mod+Shift+E',
      callback: () => {
        const view = this.workspace.active?.view
        if (!view?.setReading) return notice('Эта вкладка не редактируется')
        view.setReading(!view.reading)
        this.workspace.trigger('active-change', this.workspace.active)
      },
    })
    this.commands.add({ id: 'core:find', name: 'Найти в заметке', icon: 'search', scope: 'note', callback: inNote(false) })
    this.commands.add({ id: 'core:replace', name: 'Найти и заменить в заметке', icon: 'replace', scope: 'note', callback: inNote(true) })
    // Small edits of the note: the bar over a phone's keyboard runs them, and anyone may put them on a button.
    for (const format of FORMAT_COMMANDS)
      this.commands.add({
        id: format.id,
        name: format.name,
        icon: format.icon,
        callback: () => {
          const editor = this.workspace.activeEditor
          if (!editor) return notice('Откройте заметку')
          if (editor.state.readOnly) return notice('Заметка открыта для чтения')
          format.run(editor)
          if (!editor.hasFocus) editor.focus()
        },
      })
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
    if (desktop)
      this.commands.add({
        id: 'core:check-updates',
        name: 'Проверить обновления FlintNotes',
        icon: 'refresh-cw',
        callback: () => void desktop?.checkUpdates().then((info) => notice(info.result || 'Проверено'), (err) => notice(err instanceof Error ? err.message : String(err))),
      })
    this.commands.add({
      id: 'core:quit',
      name: desktop ? 'Выйти из FlintNotes' : 'Остановить FlintNotes',
      icon: 'power-off',
      // What is not saved yet goes to the server first, while it still listens.
      callback: () =>
        void Promise.all([this.workspace.flushAll(), this.state.flush()])
          .then(() => this.vault.quit())
          .then(
            () => desktop || notice('FlintNotes остановлен. Запустить снова — node release/launcher.mjs', 10_000),
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
    this.toolbars.init(this.state, this.menus)
    this.ribbonItems.init()
    this.commands.setCustomHotkeys(this.settings.get<Record<string, string>>('core', 'hotkeys') ?? {})
  }
}
