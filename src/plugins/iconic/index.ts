import { errorMessage, path as paths, Plugin, type Look, type LookKind, type VaultEntry } from '../../api'
import { ownLook, renameLooks, ruleLook, setLook, type IconicData } from './data'
import { pickLook } from './picker'
import './style.css'

/**
 * Icons and colours of files, folders, tags and properties, kept in the data
 * file of the Iconic plugin for Obsidian, so that both apps show the same and
 * a change made in one appears in the other.
 */
export default class Iconic extends Plugin {
  private data: IconicData = {}
  private raw = ''
  /** Custom icons from Obsidian's settings folder: name -> address of the picture. */
  private custom = new Map<string, string>()

  /** Obsidian's settings folder of this vault; `.obsidian` if the vault has none yet. */
  private get config(): string {
    return this.app.obsidianConfig ?? '.obsidian'
  }

  private get file(): string {
    return `${this.config}/plugins/iconic/data.json`
  }

  async onload() {
    const { app } = this
    await this.read()
    void this.readCustomIcons()

    this.register(
      app.icons.provide((kind, id) => {
        const own = ownLook(this.data, kind, id)
        if (kind !== 'file' && kind !== 'folder') return own
        const ruled = ruleLook(this.data, kind, id)
        // Iconic's "show all icons" settings give every file and folder an icon; here the default is a plain one.
        const fallback = kind === 'file' ? (this.data.showAllFileIcons ? 'lucide-file' : undefined) : this.data.showAllFolderIcons ? 'lucide-folder' : undefined
        const icon = own?.icon ?? ruled?.icon ?? fallback
        const color = own?.color ?? ruled?.color
        return icon || color ? { icon, color } : undefined
      }),
    )
    const previous = app.icons.custom
    app.icons.custom = (name) => this.custom.get(name)
    this.register(() => (app.icons.custom = previous))

    // Obsidian may change the file while this app is in the background.
    const onFocus = () => void this.read()
    window.addEventListener('focus', onFocus)
    this.register(() => window.removeEventListener('focus', onFocus))

    this.register(
      app.vault.on('rename', (entry, oldPath) => {
        if (renameLooks(this.data, oldPath, entry.path)) void this.save()
      }),
    )

    const item = (kind: LookKind, id: string, title: string) => ({
      icon: 'image-plus',
      title: ownLook(this.data, kind, id) ? 'Изменить значок…' : 'Задать значок…',
      onClick: () => void this.choose(kind, id, title),
    })
    this.registerMenu('file', (entry: VaultEntry | null, add) => {
      if (entry) add(item(entry.kind === 'folder' ? 'folder' : 'file', entry.path, paths.basename(entry.path)))
    })
    this.registerMenu('tag', (tag: string, add) => add(item('tag', tag, `#${tag}`)))
    this.registerMenu('property', (key: string, add) => add(item('property', key, key)))

    this.addCommand({
      id: 'active-file',
      name: 'Значок и цвет открытой заметки',
      callback: () => {
        const path = app.workspace.active?.path
        if (path && !path.startsWith('view:')) void this.choose('file', path, paths.basename(path))
      },
    })
  }

  private async choose(kind: LookKind, id: string, title: string): Promise<void> {
    const look = await pickLook(this.app, title, ownLook(this.data, kind, id) ?? {}, [...this.custom.keys()])
    if (!look) return
    // The file is read again first: Obsidian may have saved its own changes meanwhile.
    await this.read()
    setLook(this.data, kind, id, look)
    await this.save()
  }

  private async read(): Promise<void> {
    try {
      const text = (await this.app.vault.readOptional(this.file)) ?? ''
      if (text === this.raw) return
      this.raw = text
      const parsed: unknown = text.trim() ? JSON.parse(text) : {}
      this.data = parsed && typeof parsed === 'object' ? (parsed as IconicData) : {}
      this.app.icons.refresh()
    } catch (err) {
      this.app.notice(`Значки: не удалось прочитать ${this.file}: ${errorMessage(err)}`)
    }
  }

  private async save(): Promise<void> {
    try {
      // Written the way Obsidian writes plugin data, so the file differs only where something changed.
      this.raw = JSON.stringify(this.data, null, 2)
      await this.app.vault.write(this.file, this.raw)
      this.app.icons.refresh()
    } catch (err) {
      this.app.notice(`Значки: не удалось сохранить: ${errorMessage(err)}`)
    }
  }

  /** Pictures of the "Add Custom Icons" plugin: every SVG in `custom-icons` is an icon named like its file. */
  private async readCustomIcons(): Promise<void> {
    const folder = `${this.config}/custom-icons`
    const files = await this.app.vault.list(folder).catch(() => [])
    this.custom = new Map(files.filter((name) => /\.svg$/i.test(name)).map((name) => [name.replace(/\.svg$/i, '').toLowerCase(), this.app.vault.url(`${folder}/${name}`)]))
    if (this.custom.size) this.app.icons.refresh()
  }
}
