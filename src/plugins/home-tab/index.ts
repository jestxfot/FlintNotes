import { path as paths, Plugin } from '../../api'
import './style.css'

const VIEW = 'home'
const RECENT = 'home-recent'
const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean)

/**
 * A home page: what a new tab shows, and what the app opens with. It is a
 * page of its own (a clock, a greeting, a field to find files, the notes
 * opened lately and the notes the user keeps at hand) or simply a note chosen
 * for it. Every part can be switched off.
 */
export default class HomeTab extends Plugin {
  onload() {
    const { app } = this
    this.addSettings([
      {
        key: 'mode',
        section: 'Что открывать',
        name: 'Домашняя вкладка показывает',
        type: 'select',
        default: 'page',
        options: [
          { value: 'page', label: 'Домашнюю страницу' },
          { value: 'note', label: 'Выбранную заметку' },
        ],
      },
      { key: 'note', section: 'Что открывать', name: 'Домашняя заметка', desc: 'Путь или имя заметки. Её же можно назначить командой «Сделать эту заметку домашней»', type: 'text', default: '', placeholder: 'Home' },
      { key: 'newTab', section: 'Что открывать', name: 'Открывать по кнопке «+» новой вкладки', desc: 'Выключено — «+» создаёт новую заметку, как без плагина', type: 'toggle', default: true },
      { key: 'onStart', section: 'Что открывать', name: 'Открывать при запуске', desc: 'Когда приложение открыто без единой вкладки — всегда; иначе по выбору ниже', type: 'toggle', default: true },
      { key: 'onStartAlways', section: 'Что открывать', name: 'При запуске — даже если есть другие вкладки', type: 'toggle', default: false },
      { key: 'pin', section: 'Что открывать', name: 'Закреплять домашнюю вкладку', desc: 'Закреплённая вкладка стоит первой и не закрывается вместе с остальными', type: 'toggle', default: false },

      { key: 'clock', section: 'Страница', name: 'Часы', type: 'toggle', default: true },
      { key: 'seconds', section: 'Страница', name: 'Секунды на часах', type: 'toggle', default: false },
      { key: 'hour12', section: 'Страница', name: '12-часовой формат', type: 'toggle', default: false },
      { key: 'date', section: 'Страница', name: 'Дата под часами', type: 'toggle', default: true },
      { key: 'greeting', section: 'Страница', name: 'Приветствие', desc: '{name} — имя ниже, {part} — «Доброе утро», «Добрый день», «Добрый вечер» или «Доброй ночи». Пусто — без приветствия', type: 'text', default: '{part}, {name}.', placeholder: '{part}, {name}.' },
      { key: 'name', section: 'Страница', name: 'Имя', type: 'text', default: '' },
      { key: 'search', section: 'Страница', name: 'Поле поиска файлов', type: 'toggle', default: true },
      { key: 'recent', section: 'Страница', name: 'Сколько недавних заметок показывать', desc: '0 — не показывать', type: 'number', default: 8, min: 0, max: 40 },
      { key: 'favorites', section: 'Страница', name: 'Заметки под рукой', desc: 'По одной в строке: путь или имя заметки. Показываются над недавними', type: 'lines', default: '' },
      { key: 'quote', section: 'Страница', name: 'Строка внизу страницы', desc: 'Цитата или девиз. Несколько строк — каждый день показывается своя', type: 'lines', default: '' },
      { key: 'background', section: 'Страница', name: 'Фон', desc: 'Адрес картинки в интернете или путь к картинке в хранилище. Пусто — без фона', type: 'text', default: '', placeholder: 'attachments/wallpaper.jpg' },
    ])
    const get = <T>(key: string) => this.getSetting<T>(key)
    const resolve = (name: string) => {
      const wanted = paths.normalize(name)
      for (const candidate of [wanted, `${wanted}.md`]) if (app.vault.get(candidate)?.kind === 'file') return candidate
      return app.metadata.resolve(wanted, '')
    }

    // ---- which notes were opened lately
    this.register(
      app.workspace.on('active-change', (leaf) => {
        const path = leaf?.path
        if (!path || path.startsWith('view:')) return
        const recent = app.state.get<string[]>(RECENT, [])
        if (recent[0] !== path) app.state.set(RECENT, [path, ...recent.filter((one) => one !== path)].slice(0, 60))
      }),
    )

    // ---- the page
    this.registerView(
      VIEW,
      ({ containerEl }) => {
        const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = '') => {
          const node = parent.appendChild(document.createElement(tag))
          if (className) node.className = className
          if (text) node.textContent = text
          return node
        }
        const page = el(containerEl, 'div', 'home-tab')
        let tick: (() => void) | null = null
        const open = (file: string, event?: MouseEvent | KeyboardEvent) => app.workspace.openFile(file, event && (event.ctrlKey || event.metaKey) ? { newTab: true } : {})
        const fileButton = (parent: HTMLElement, file: string) => {
          const button = el(parent, 'button', 'home-file')
          const look = app.icons.look('file', file)
          button.append(app.icons.draw(look?.icon ?? (paths.extname(file) === 'md' ? 'file-text' : 'file'), look?.color))
          el(button, 'span', 'home-file-name', paths.extname(file) === 'md' ? paths.stripExt(paths.basename(file)) : paths.basename(file))
          button.title = file
          button.onclick = (event) => open(file, event)
        }
        const draw = () => {
          page.replaceChildren()
          tick = null
          const picture = get<string>('background')?.trim()
          const local = picture && !/^https?:/i.test(picture) ? resolve(picture) : null
          page.classList.toggle('pictured', !!picture)
          page.style.backgroundImage = picture ? `url("${(local ? app.vault.url(local) : picture).replace(/"/g, '%22')}")` : ''

          if (get<boolean>('clock')) {
            const clock = el(page, 'div', 'home-clock')
            const date = get<boolean>('date') ? el(page, 'div', 'home-date') : null
            tick = () => {
              const now = new Date()
              clock.textContent = now.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: get<boolean>('seconds') ? '2-digit' : undefined, hour12: !!get<boolean>('hour12') })
              if (date) date.textContent = now.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase())
            }
            tick()
          }
          const greeting = get<string>('greeting')?.trim()
          if (greeting) {
            const hour = new Date().getHours()
            const part = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер'
            const name = get<string>('name')?.trim() ?? ''
            // Without a name the comma and the space before it go too: "Доброе утро."
            el(page, 'div', 'home-greeting', (name ? greeting.replace(/\{name\}/g, name) : greeting.replace(/[,\s]*\{name\}/g, '')).replace(/\{part\}/g, part).trim())
          }

          if (get<boolean>('search')) {
            const box = el(page, 'div', 'home-search')
            const input = el(box, 'input')
            input.type = 'search'
            input.placeholder = 'Найти файл…  Enter — открыть, Ctrl+Enter — в новой вкладке'
            input.setAttribute('aria-label', 'Найти файл')
            const results = el(box, 'div', 'home-results')
            let found: string[] = []
            let index = 0
            const show = () => {
              const words = input.value.toLowerCase().split(/\s+/).filter(Boolean)
              results.replaceChildren()
              found = !words.length
                ? []
                : app.vault
                    .files()
                    .map((file) => file.path)
                    .filter((file) => words.every((word) => file.toLowerCase().includes(word)))
                    // A name that begins with what was typed comes before one that only has it somewhere.
                    .sort((a, b) => Number(!paths.basename(a).toLowerCase().startsWith(words[0])) - Number(!paths.basename(b).toLowerCase().startsWith(words[0])) || a.length - b.length)
                    .slice(0, 9)
              index = Math.min(index, Math.max(0, found.length - 1))
              found.forEach((file, i) => {
                const row = el(results, 'button', i === index ? 'home-result selected' : 'home-result')
                row.append(paths.extname(file) === 'md' ? paths.stripExt(paths.basename(file)) : paths.basename(file))
                el(row, 'small', '', paths.dirname(file) ? `${paths.dirname(file)}/` : '')
                row.onclick = (event) => open(file, event)
              })
            }
            input.oninput = () => {
              index = 0
              show()
            }
            input.onkeydown = (event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                index = found.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length : 0
                show()
              } else if (event.key === 'Enter' && found[index]) open(found[index], event)
            }
            // The page is for going somewhere: the field is ready as soon as the tab shows.
            setTimeout(() => page.isConnected && !page.closest('[hidden]') && input.focus(), 50)
          }

          const kept = lines(get<string>('favorites') ?? '').map(resolve).filter((file): file is string => !!file)
          if (kept.length) {
            const section = el(page, 'div', 'home-section')
            el(section, 'h3', '', 'Под рукой')
            const grid = el(section, 'div', 'home-files')
            for (const file of kept) fileButton(grid, file)
          }
          const count = Math.max(0, get<number>('recent') ?? 8)
          const recent = app.state.get<string[]>(RECENT, []).filter((file) => app.vault.get(file) && !kept.includes(file)).slice(0, count)
          if (count && recent.length) {
            const section = el(page, 'div', 'home-section')
            el(section, 'h3', '', 'Недавние')
            const grid = el(section, 'div', 'home-files')
            for (const file of recent) fileButton(grid, file)
          }
          const quotes = lines(get<string>('quote') ?? '')
          if (quotes.length) el(page, 'div', 'home-quote', quotes[Math.floor(Date.now() / 86_400_000) % quotes.length])
        }
        draw()
        const timer = setInterval(() => tick?.(), 1000)
        const offs = [app.settings.on('change', (scope) => scope === this.manifest.id && draw()), app.workspace.on('active-change', (leaf) => leaf?.path === `view:${VIEW}` && draw())]
        return {
          focus: () => page.querySelector<HTMLInputElement>('.home-search input')?.focus(),
          destroy: () => {
            clearInterval(timer)
            offs.forEach((off) => off())
            page.remove()
          },
        }
      },
      [],
    )

    /** Shows the home tab: the page, or the note chosen for it. */
    const home = (newTab = true): boolean => {
      const note = get<string>('mode') === 'note' ? resolve(get<string>('note') ?? '') : null
      if (get<string>('mode') === 'note' && !note) app.notice('Домашняя заметка не найдена — показана домашняя страница. Задайте её в настройках плагина')
      if (note) app.workspace.openFile(note, { newTab })
      else app.workspace.openView(VIEW, 'Домой')
      const leaf = app.workspace.active
      if (leaf && get<boolean>('pin') && !leaf.pinned) app.workspace.togglePin(leaf)
      return true
    }
    this.addCommand({ id: 'open', name: 'Открыть домашнюю вкладку', icon: 'house', scope: 'vault', hotkey: 'Alt+H', callback: () => void home() })
    this.addCommand({
      id: 'set-note',
      name: 'Сделать эту заметку домашней',
      icon: 'house-plus',
      scope: 'note',
      callback: () => {
        const path = app.workspace.active?.path
        if (!path || path.startsWith('view:')) return app.notice('Откройте заметку')
        this.setSetting('note', path)
        this.setSetting('mode', 'note')
        app.notice(`Домашняя заметка: ${paths.stripExt(paths.basename(path))}`)
      },
    })

    // The "+" of the tabs opens the home tab instead of making a note, if asked to.
    const before = app.workspace.newTabPage
    app.workspace.newTabPage = () => (get<boolean>('newTab') ? home() : false)
    this.register(() => (app.workspace.newTabPage = before))

    // At start: once the tabs of the last session are back.
    if (get<boolean>('onStart')) {
      setTimeout(() => {
        if (!app.workspace.leaves.length || get<boolean>('onStartAlways')) home()
      }, 600)
    }
  }
}
