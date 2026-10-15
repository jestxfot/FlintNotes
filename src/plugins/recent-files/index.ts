import { errorMessage, path as paths, Plugin } from '../../api'
import './style.css'

const PANEL = 'recent-files'
/** The Recent Files plugin's own default length of the list. */
const DEFAULT_LENGTH = 50

/** One entry of the list, as the Recent Files plugin writes it. */
interface Recent {
  basename: string
  path: string
}

/** Its data.json: the list, newest first, and its settings. */
interface RecentData {
  recentFiles: Recent[]
  omittedPaths: string[]
  omittedTags: string[]
  updateOn: 'file-open' | 'file-edit'
  omitBookmarks: boolean
  maxLength?: number
}

/**
 * The notes opened last, newest first, as a widget of a sidebar. The list is
 * the one of the Recent Files plugin for Obsidian, kept in its own data.json
 * (in the folder of Obsidian's settings), so both apps add to one list.
 */
export default class RecentFiles extends Plugin {
  private data: RecentData = { recentFiles: [], omittedPaths: [], omittedTags: [], updateOn: 'file-open', omitBookmarks: false }
  private saving: ReturnType<typeof setTimeout> | undefined
  private redraw = new Set<() => void>()

  private get file(): string {
    const config = this.app.obsidianConfig
    return config ? `${config}/plugins/recent-files-obsidian/data.json` : '.flint/recent-files.json'
  }

  async onload() {
    const { app } = this
    this.addSettings([
      { key: 'maxLength', name: 'Сколько заметок помнить', type: 'number', default: DEFAULT_LENGTH, min: 5, max: 500, step: 5 },
      {
        key: 'updateOn',
        name: 'Заметка попадает в список, когда её',
        type: 'select',
        default: 'file-open',
        options: [
          { value: 'file-open', label: 'открыли' },
          { value: 'file-edit', label: 'изменили' },
        ],
      },
      { key: 'omittedPaths', name: 'Не показывать пути', desc: 'По одному образцу в строке (регулярное выражение), например ^Templates/', type: 'lines', default: '' },
      { key: 'omittedTags', name: 'Не показывать заметки с тегами', desc: 'По одному тегу в строке, без #', type: 'lines', default: '' },
    ])
    await this.read()
    this.register(() => clearTimeout(this.saving))

    // ---- what goes into the list
    const take = (file: string) => {
      if (!app.vault.get(file) || this.omitted(file)) return
      const list = this.data.recentFiles.filter((entry) => entry.path !== file)
      list.unshift({ basename: paths.stripExt(paths.basename(file)), path: file })
      this.data.recentFiles = list.slice(0, this.length())
      this.changed()
    }
    this.register(
      app.workspace.on('active-change', (leaf) => {
        if (leaf && !leaf.path.startsWith('view:') && this.getSetting<string>('updateOn') !== 'file-edit') take(leaf.path)
        // The mark of the open note moves even when the list itself stays as it was.
        this.redraw.forEach((draw) => draw())
      }),
    )
    this.register(app.vault.on('written', (entry) => this.getSetting<string>('updateOn') === 'file-edit' && take(entry.path)))
    this.register(
      app.vault.on('rename', (entry, from) => {
        const found = this.data.recentFiles.find((item) => item.path === from)
        if (!found) return
        found.path = entry.path
        found.basename = paths.stripExt(paths.basename(entry.path))
        this.changed()
      }),
    )
    this.register(
      app.vault.on('delete', (entry) => {
        const left = this.data.recentFiles.filter((item) => item.path !== entry.path && !item.path.startsWith(`${entry.path}/`))
        if (left.length === this.data.recentFiles.length) return
        this.data.recentFiles = left
        this.changed()
      }),
    )
    this.onSettingChange(() => this.changed())

    // Others (the quick switcher with nothing typed) list the recent notes through this.
    this.provide('recent-files', { list: () => this.data.recentFiles.map((item) => item.path).filter((file) => app.vault.get(file)) })

    // ---- the widget
    this.addPanel({
      id: PANEL,
      title: 'Недавние заметки',
      side: 'left',
      icon: 'M2.6 8a5.4 5.4 0 1 0 1.6-3.8M2.6 2.9v2.6h2.6M8 5.2V8l2 1.6',
      mount: (target) => {
        const root = target.appendChild(document.createElement('div'))
        root.className = 'recent-files'
        const draw = () => {
          root.replaceChildren()
          const active = app.workspace.active?.path
          const list = this.data.recentFiles.filter((item) => app.vault.get(item.path) && !this.omitted(item.path))
          if (!list.length) {
            const empty = root.appendChild(document.createElement('p'))
            empty.className = 'recent-files-empty'
            empty.textContent = 'Здесь появятся заметки, которые вы открываете'
            return
          }
          for (const item of list) {
            const row = root.appendChild(document.createElement('div'))
            row.className = `recent-files-row${item.path === active ? ' active' : ''}`
            row.title = item.path
            row.tabIndex = 0
            const look = app.icons.look('file', item.path)
            row.append(app.icons.draw(look?.icon ?? (paths.extname(item.path) === 'md' ? 'file-text' : 'file'), look?.color))
            const name = row.appendChild(document.createElement('span'))
            name.className = 'recent-files-name'
            name.textContent = item.basename || paths.basename(item.path)
            const folder = paths.dirname(item.path)
            if (folder) {
              const where = row.appendChild(document.createElement('span'))
              where.className = 'recent-files-folder'
              where.textContent = folder
            }
            const remove = row.appendChild(document.createElement('button'))
            remove.className = 'recent-files-remove'
            remove.title = 'Убрать из списка'
            remove.setAttribute('aria-label', 'Убрать из списка')
            remove.append(app.icons.draw('x'))
            remove.onclick = (event) => {
              event.stopPropagation()
              this.forget(item.path)
            }
            const open = (newTab: boolean) => app.workspace.openFile(item.path, { newTab })
            row.onclick = (event) => open(event.ctrlKey || event.metaKey)
            row.onauxclick = (event) => event.button === 1 && open(true)
            row.onkeydown = (event) => event.key === 'Enter' && open(event.ctrlKey || event.metaKey)
            row.oncontextmenu = (event) =>
              app.menus.show(event, 'recent-files', item.path, [
                { icon: 'file-plus', title: 'Открыть в новой вкладке', onClick: () => open(true) },
                { icon: 'x', title: 'Убрать из списка', onClick: () => this.forget(item.path) },
                { section: 'edit', icon: 'trash', title: 'Очистить список', onClick: () => this.clear() },
              ])
          }
        }
        draw()
        this.redraw.add(draw)
        const offIcons = app.icons.on('change', draw)
        return () => {
          this.redraw.delete(draw)
          offIcons()
          root.remove()
        }
      },
    })

    this.addCommand({ id: 'open', name: 'Показать недавние заметки', icon: 'history', scope: 'sidebar', callback: () => app.panels.reveal(PANEL) })
    this.addCommand({ id: 'clear', name: 'Очистить список недавних заметок', icon: 'trash', callback: () => this.clear() })
  }

  private length(): number {
    return Math.max(1, this.getSetting<number>('maxLength') ?? DEFAULT_LENGTH)
  }

  /** Paths and tags the settings leave out of the list. */
  private omitted(file: string): boolean {
    const lines = (key: string) => (this.getSetting<string>(key) ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
    for (const pattern of lines('omittedPaths')) {
      try {
        if (new RegExp(pattern).test(file)) return true
      } catch {
        if (file.startsWith(pattern)) return true
      }
    }
    const tags = lines('omittedTags').map((tag) => tag.replace(/^#/, '').toLowerCase())
    if (!tags.length) return false
    return (this.app.metadata.get(file)?.tags ?? []).some((tag) => tags.includes(tag.toLowerCase()))
  }

  private forget(file: string): void {
    this.data.recentFiles = this.data.recentFiles.filter((item) => item.path !== file)
    this.changed()
  }

  private clear(): void {
    this.data.recentFiles = []
    this.changed()
  }

  private changed(): void {
    this.data.recentFiles = this.data.recentFiles.slice(0, this.length())
    this.redraw.forEach((draw) => draw())
    clearTimeout(this.saving)
    this.saving = setTimeout(() => void this.write(), 800)
  }

  /** Reads the list and, the first time, the settings of the Recent Files plugin. */
  private async read(): Promise<void> {
    try {
      const text = await this.app.vault.readOptional(this.file)
      if (!text) return
      const saved = JSON.parse(text) as Partial<RecentData>
      this.data = { ...this.data, ...saved, recentFiles: Array.isArray(saved.recentFiles) ? saved.recentFiles.filter((item) => item && typeof item.path === 'string') : [] }
      if (!this.getSetting<boolean>('imported')) {
        this.setSetting('imported', true)
        if (typeof saved.maxLength === 'number') this.setSetting('maxLength', saved.maxLength)
        if (saved.updateOn === 'file-open' || saved.updateOn === 'file-edit') this.setSetting('updateOn', saved.updateOn)
        if (Array.isArray(saved.omittedPaths)) this.setSetting('omittedPaths', saved.omittedPaths.join('\n'))
        if (Array.isArray(saved.omittedTags)) this.setSetting('omittedTags', saved.omittedTags.join('\n'))
      }
    } catch (err) {
      this.app.notice(`Недавние заметки: не удалось прочитать ${this.file}: ${errorMessage(err)}`)
    }
  }

  /** Writes the list back in the Recent Files plugin's form, with the settings as they are here. */
  private async write(): Promise<void> {
    const lines = (key: string) => (this.getSetting<string>(key) ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
    const data: RecentData = {
      ...this.data,
      omittedPaths: lines('omittedPaths'),
      omittedTags: lines('omittedTags'),
      updateOn: this.getSetting<string>('updateOn') === 'file-edit' ? 'file-edit' : 'file-open',
    }
    if (this.length() !== DEFAULT_LENGTH || this.data.maxLength !== undefined) data.maxLength = this.length()
    await this.app.vault.write(this.file, JSON.stringify(data, null, 2)).catch(() => {})
  }
}
