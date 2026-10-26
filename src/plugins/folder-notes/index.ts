import { errorMessage, path as paths, Plugin, type VaultEntry } from '../../api'
import { drawOverview } from './overview'
import './style.css'

const lines = (text: string) => text.split('\n').map((line) => line.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean)

/**
 * A folder may have a note of its own, as with the Folder notes plugin for
 * Obsidian: a note named after the folder, kept inside it (or beside it).
 * A click on the folder opens the note, the note itself is left out of the
 * list of files, and the two are renamed together. The settings carry the
 * names that plugin gives them, and are taken from its file on first use, so
 * both apps treat the same notes as folder notes.
 */
export default class FolderNotes extends Plugin {
  /** Renames this plugin makes itself, which must not be answered with another rename. */
  private syncing = false
  /** Makes the other of the pair (folder and its note) take the new name. */
  private follow: (entry: VaultEntry, oldPath: string) => void = () => {}

  async onload() {
    const { app } = this
    this.addSettings([
      { key: 'folderNoteName', section: 'Заметка папки', name: 'Имя заметки папки', desc: '{{folder_name}} — имя папки. Например «{{folder_name}}» или «index»', type: 'text', default: '{{folder_name}}' },
      {
        key: 'storageLocation',
        section: 'Заметка папки',
        name: 'Где лежит заметка',
        desc: 'Внутри папки — Папка/Папка.md; рядом с папкой — Папка.md возле неё',
        type: 'select',
        default: 'insideFolder',
        options: [
          { value: 'insideFolder', label: 'Внутри папки' },
          { value: 'parentFolder', label: 'Рядом с папкой' },
        ],
      },
      { key: 'templatePath', section: 'Заметка папки', name: 'Шаблон новой заметки папки', desc: 'Путь к шаблону; работает с плагином «Шаблоны». Пусто — пустая заметка', type: 'text', default: '', placeholder: 'Templates/Folder.md' },
      { key: 'autoCreate', section: 'Заметка папки', name: 'Создавать заметку вместе с папкой', desc: 'Новая папка сразу получает свою заметку', type: 'toggle', default: false },
      { key: 'syncFolderName', section: 'Заметка папки', name: 'Переименовывать вместе', desc: 'Переименование папки переименовывает её заметку, и наоборот', type: 'toggle', default: true },
      { key: 'showDeleteConfirmation', section: 'Заметка папки', name: 'Спрашивать перед удалением заметки папки', desc: 'Удаление заметки папки из меню папки сначала переспрашивает', type: 'toggle', default: true },

      { key: 'openByClick', section: 'Открытие', name: 'Открывать заметку щелчком по папке', desc: 'Щелчок по папке в списке файлов открывает её заметку', type: 'toggle', default: true },
      { key: 'openWithCtrl', section: 'Открытие', name: 'Открывать только с Ctrl', desc: 'Обычный щелчок только раскрывает папку, заметку открывает Ctrl+щелчок', type: 'toggle', default: false },
      { key: 'openWithAlt', section: 'Открытие', name: 'Открывать только с Alt', desc: 'Обычный щелчок только раскрывает папку, заметку открывает Alt+щелчок', type: 'toggle', default: false },
      { key: 'enableCollapsing', section: 'Открытие', name: 'Щелчок также раскрывает папку', desc: 'Выключено — папку раскрывает только стрелка слева от неё', type: 'toggle', default: false },
      { key: 'openInNewTab', section: 'Открытие', name: 'Открывать в новой вкладке', desc: 'Заметка папки открывается в новой вкладке, а не вместо текущей', type: 'toggle', default: false },
      { key: 'ctrlKey', section: 'Открытие', name: 'Ctrl+щелчок по папке без заметки создаёт заметку', desc: 'Ctrl+щелчок по папке, у которой ещё нет заметки, создаёт её', type: 'toggle', default: true },
      { key: 'altKey', section: 'Открытие', name: 'Alt+щелчок по папке без заметки создаёт заметку', desc: 'Alt+щелчок по папке, у которой ещё нет заметки, создаёт её', type: 'toggle', default: false },
      { key: 'openFolderNoteOnClickInPath', section: 'Открытие', name: 'Открывать щелчком по папке в пути над заметкой', desc: 'Щелчок по папке в пути над заметкой открывает заметку этой папки', type: 'toggle', default: true },

      { key: 'hideFolderNote', section: 'Вид', name: 'Скрывать заметку папки в списке файлов', desc: 'Заметка папки не видна отдельным файлом: её открывает сама папка', type: 'toggle', default: true },
      { key: 'underlineFolder', section: 'Вид', name: 'Подчёркивать папки с заметкой', desc: 'Так в списке файлов видно, у каких папок есть заметка', type: 'toggle', default: true },
      { key: 'boldName', section: 'Вид', name: 'Жирное имя папки с заметкой', desc: 'Ещё один знак папки с заметкой в списке файлов', type: 'toggle', default: false },
      { key: 'cursiveName', section: 'Вид', name: 'Курсивное имя папки с заметкой', desc: 'Ещё один знак папки с заметкой в списке файлов', type: 'toggle', default: false },
      { key: 'underlineFolderInPath', section: 'Вид', name: 'Подчёркивать в пути над заметкой', desc: 'То же в пути над заметкой', type: 'toggle', default: true },
      { key: 'boldNameInPath', section: 'Вид', name: 'Жирное имя в пути', desc: 'То же в пути над заметкой', type: 'toggle', default: false },
      { key: 'cursiveNameInPath', section: 'Вид', name: 'Курсивное имя в пути', desc: 'То же в пути над заметкой', type: 'toggle', default: false },

      { key: 'excludeFolders', section: 'Исключения', name: 'Папки без заметок', desc: 'По одной в строке; вложенные папки тоже исключаются', type: 'lines', default: '' },
      { key: 'whitelistFolders', section: 'Исключения', name: 'Только эти папки', desc: 'Если список не пуст, заметки папок работают только в них', type: 'lines', default: '' },
    ])
    await this.importFromObsidian(false)
    this.onSettingChange(() => app.explorer.refresh())

    const on = <T>(key: string) => this.getSetting<T>(key)
    const hasNote = (entry: VaultEntry) => entry.kind === 'folder' && !!this.noteOf(entry.path)

    this.register(app.explorer.hide((entry) => entry.kind === 'file' && on<boolean>('hideFolderNote') && this.folderOf(entry.path) !== null))
    this.register(
      app.explorer.decorate((entry) => {
        if (!hasNote(entry)) return undefined
        return [
          'fn-has-note',
          on<boolean>('underlineFolder') && 'fn-underline',
          on<boolean>('boldName') && 'fn-bold',
          on<boolean>('cursiveName') && 'fn-cursive',
          on<boolean>('underlineFolderInPath') && 'fn-underline-path',
          on<boolean>('boldNameInPath') && 'fn-bold-path',
          on<boolean>('cursiveNameInPath') && 'fn-cursive-path',
        ]
          .filter(Boolean)
          .join(' ')
      }),
    )
    this.register(
      app.explorer.onFolderClick((entry, event) => {
        if (!this.allowed(entry.path)) return false
        const inPath = event.target instanceof Element && !!event.target.closest('.crumb')
        if (inPath && !on<boolean>('openFolderNoteOnClickInPath')) return false
        const note = this.noteOf(entry.path)
        const ctrl = event.ctrlKey || event.metaKey
        if (!note) {
          // A folder without a note gets one by the chosen key.
          if (inPath || !((ctrl && on<boolean>('ctrlKey')) || (event.altKey && on<boolean>('altKey')))) return false
          void this.create(entry.path)
          return true
        }
        const wanted = on<boolean>('openWithCtrl') ? ctrl : on<boolean>('openWithAlt') ? event.altKey : on<boolean>('openByClick') && !event.altKey
        if (!wanted) return false
        app.workspace.openFile(note, on<boolean>('openInNewTab') ? { newTab: true } : {})
        return inPath || !on<boolean>('enableCollapsing')
      }),
    )
    // Notes come and go: the list of files is asked again which folders have one.
    for (const event of ['create', 'delete', 'rename'] as const) this.register(app.vault.on(event, () => app.explorer.refresh()))

    this.register(
      app.vault.on('create', (entry) => {
        if (entry.kind === 'folder' && on<boolean>('autoCreate') && this.allowed(entry.path) && !this.noteOf(entry.path)) void this.create(entry.path, false)
      }),
    )
    this.register(
      app.vault.on('rename', (entry, oldPath) => {
        if (this.syncing || !on<boolean>('syncFolderName')) return
        const renamed = paths.basename(entry.path) !== paths.basename(oldPath)
        if (!renamed) return
        // A folder is reported before the files in it; they are looked at once the whole move is known.
        setTimeout(() => this.follow(entry, oldPath), 50)
      }),
    )
    this.follow = (entry, oldPath) => {
      {
        if (entry.kind === 'folder') {
          // The note still carries the folder's old name.
          const stale = this.pathFor(entry.path, paths.basename(oldPath))
          const fresh = this.pathFor(entry.path)
          if (stale !== fresh && app.vault.get(stale)?.kind === 'file' && !app.vault.get(fresh)) void this.sync(() => app.vault.rename(stale, fresh))
        } else if (on<string>('storageLocation') !== 'parentFolder' && on<string>('folderNoteName').includes('{{folder_name}}')) {
          // A folder's note was renamed: the folder takes the name too.
          const folder = paths.dirname(oldPath)
          if (!folder || this.pathFor(folder) !== oldPath) return
          const name = this.folderNameFrom(paths.stripExt(paths.basename(entry.path)))
          const target = paths.join(paths.dirname(folder), name)
          if (name && !app.vault.get(target)) void this.sync(() => app.vault.rename(folder, target))
        }
      }
    }

    this.registerMenu('file', (entry: VaultEntry | null, add) => {
      if (!entry) return
      if (entry.kind === 'folder') {
        if (!this.allowed(entry.path)) return
        const note = this.noteOf(entry.path)
        if (note) {
          add({ icon: 'file-text', title: 'Открыть заметку папки', onClick: () => app.workspace.openFile(note) })
          add({ icon: 'file-x', title: 'Удалить заметку папки', onClick: () => void this.remove(note) })
        } else add({ icon: 'file-plus', title: 'Создать заметку папки', onClick: () => void this.create(entry.path) })
      } else if (paths.extname(entry.path) === 'md' && this.folderOf(entry.path) === null) {
        add({ icon: 'folder-input', title: 'Сделать заметкой папки', command: 'folder-notes:turn-into-folder', onClick: () => void this.turnIntoFolder(entry.path) })
      }
    })

    const active = () => {
      const path = app.workspace.active?.path
      return path && !path.startsWith('view:') ? path : null
    }
    this.addCommand({
      id: 'create-for-active',
      name: 'Создать или открыть заметку папки, в которой лежит эта заметка',
      icon: 'folder-open',
      scope: 'note',
      callback: () => {
        const folder = active() ? paths.dirname(active()!) : ''
        if (!folder) return app.notice('Заметка лежит в корне хранилища')
        const note = this.noteOf(folder)
        if (note) app.workspace.openFile(note)
        else void this.create(folder)
      },
    })
    this.addCommand({
      id: 'turn-into-folder',
      name: 'Сделать эту заметку заметкой папки',
      icon: 'folder-input',
      scope: 'note',
      callback: () => {
        const path = active()
        if (path && paths.extname(path) === 'md') void this.turnIntoFolder(path)
      },
    })
    this.addCommand({ id: 'import', name: 'Взять настройки заметок папок из Obsidian', scope: 'vault', icon: 'import', callback: () => void this.importFromObsidian(true) })
    this.addInsertCommand('insert-overview', 'Вставить обзор папки', '```folder-overview\nshowTitle: false\ndepth: 3\nincludeTypes:\n  - folder\n  - markdown\nstyle: list\n```\n|', 'list-tree')

    this.registerCodeBlockProcessor('folder-overview', (source, el, ctx) => {
      let current = source
      const draw = () => drawOverview(app, el, current, ctx.path, (folder) => this.noteOf(folder))
      draw()
      const offs = (['create', 'delete', 'rename'] as const).map((event) => app.vault.on(event, draw))
      return {
        update: (next) => {
          current = next
          draw()
        },
        destroy: () => offs.forEach((off) => off()),
      }
    })
  }

  // ---- which note belongs to which folder

  /** Where the note of a folder is, or would be. `name` stands in for the folder's own name. */
  private pathFor(folder: string, name = paths.basename(folder)): string {
    const file = `${this.getSetting<string>('folderNoteName').replace(/\{\{folder_name\}\}/g, name) || name}.md`
    return paths.join(this.getSetting<string>('storageLocation') === 'parentFolder' ? paths.dirname(folder) : folder, file)
  }

  /** The folder's name that a note's name was made of. */
  private folderNameFrom(noteName: string): string {
    const [before, after] = this.getSetting<string>('folderNoteName').split('{{folder_name}}')
    return noteName.startsWith(before ?? '') && noteName.endsWith(after ?? '') ? noteName.slice((before ?? '').length, noteName.length - (after ?? '').length) : ''
  }

  private allowed(folder: string): boolean {
    const under = (list: string[]) => list.some((one) => folder === one || folder.startsWith(`${one}/`))
    const only = lines(this.getSetting<string>('whitelistFolders') ?? '')
    if (only.length && !under(only)) return false
    return !under(lines(this.getSetting<string>('excludeFolders') ?? ''))
  }

  /** The existing note of a folder, or `null`. */
  noteOf(folder: string): string | null {
    if (!folder || !this.allowed(folder)) return null
    const path = this.pathFor(folder)
    return this.app.vault.get(path)?.kind === 'file' ? path : null
  }

  /** The folder a note is the note of, or `null` if it is an ordinary note. */
  folderOf(note: string): string | null {
    if (paths.extname(note) !== 'md') return null
    const { vault } = this.app
    const inside = paths.dirname(note)
    if (inside && this.getSetting<string>('storageLocation') !== 'parentFolder') return this.allowed(inside) && this.pathFor(inside) === note ? inside : null
    if (this.getSetting<string>('storageLocation') !== 'parentFolder') return null
    const name = this.folderNameFrom(paths.stripExt(paths.basename(note)))
    const folder = name ? paths.join(inside, name) : ''
    return folder && vault.get(folder)?.kind === 'folder' && this.allowed(folder) ? folder : null
  }

  // ---- actions

  private async sync(action: () => Promise<unknown>): Promise<void> {
    this.syncing = true
    try {
      await action()
    } catch (err) {
      this.app.notice(`Заметки папок: ${errorMessage(err)}`)
    } finally {
      this.syncing = false
    }
  }

  /** Creates the note of a folder, from the template if one is set, and opens it. */
  private async create(folder: string, open = true): Promise<void> {
    const { app } = this
    const path = this.pathFor(folder)
    try {
      let text = ''
      let done: (() => Promise<void>) | undefined
      const template = this.getSetting<string>('templatePath').trim()
      const templates = app.services.get<{ resolve(name: string): string | null; render(template: string, target: string): Promise<{ text: string; done(): Promise<void> }> }>('templates')
      if (template) {
        const found = templates?.resolve(template) ?? (app.vault.get(template)?.kind === 'file' ? template : null)
        if (!found) app.notice(`Шаблон «${template}» не найден`)
        else if (templates) ({ text, done } = await templates.render(found, path))
        else text = (await app.vault.read(found)).replace(/\{\{folder_name\}\}/g, paths.basename(folder))
      }
      await app.vault.create(path, text)
      await done?.()
      if (open) app.workspace.openFile(path, this.getSetting<boolean>('openInNewTab') ? { newTab: true } : {})
    } catch (err) {
      app.notice(`Не удалось создать заметку папки: ${errorMessage(err)}`)
    }
  }

  private async remove(note: string): Promise<void> {
    if (this.getSetting<boolean>('showDeleteConfirmation') && !confirm(`Переместить заметку папки «${paths.stripExt(paths.basename(note))}» в корзину? Сама папка останется.`)) return
    await this.app.vault.trash(note).catch((err) => this.app.notice(errorMessage(err)))
  }

  /** A note becomes the note of a new folder of the same name, made where the note is. */
  private async turnIntoFolder(note: string): Promise<void> {
    const { app } = this
    const name = paths.stripExt(paths.basename(note))
    const folder = paths.join(paths.dirname(note), name)
    if (app.vault.get(folder)) return app.notice(`Папка «${name}» уже есть`)
    await this.sync(async () => {
      await app.vault.createFolder(folder)
      const target = this.pathFor(folder)
      if (target !== note) await app.vault.rename(note, target)
    })
  }

  /** Takes the settings of the Folder notes plugin from the vault, once by itself and again on request. */
  private async importFromObsidian(asked: boolean): Promise<void> {
    const { app } = this
    if (!asked && this.getSetting<boolean>('imported')) return
    this.setSetting('imported', true)
    let data: Record<string, unknown> | null = null
    try {
      const text = await app.vault.readOptional(`${app.obsidianConfig ?? '.obsidian'}/plugins/folder-notes/data.json`)
      data = text ? (JSON.parse(text) as Record<string, unknown>) : null
    } catch {
      data = null
    }
    if (!data) {
      if (asked) app.notice('В хранилище не найдены настройки Folder notes')
      return
    }
    const plain = ['folderNoteName', 'storageLocation', 'templatePath', 'autoCreate', 'syncFolderName', 'showDeleteConfirmation', 'openByClick', 'openWithCtrl', 'openWithAlt', 'enableCollapsing', 'openInNewTab', 'ctrlKey', 'altKey', 'openFolderNoteOnClickInPath', 'hideFolderNote', 'underlineFolder', 'boldName', 'cursiveName', 'underlineFolderInPath', 'boldNameInPath', 'cursiveNameInPath']
    for (const key of plain) if (key in data && ['string', 'boolean'].includes(typeof data[key])) this.setSetting(key, data[key])
    // There the lists hold objects with a path; here they are lines of paths.
    const folders = (value: unknown) => (Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : (item as { path?: string })?.path ?? '')).filter(Boolean).join('\n') : '')
    this.setSetting('excludeFolders', folders(data.excludeFolders))
    this.setSetting('whitelistFolders', folders(data.whitelistFolders))
    if (asked) app.notice('Настройки заметок папок взяты из Obsidian')
  }
}
