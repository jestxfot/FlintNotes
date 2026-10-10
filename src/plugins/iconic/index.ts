import { errorMessage, path as paths, pickLook, pictureToSvg, Plugin, type Look, type LookKind, type VaultEntry } from '../../api'
import { drawRules } from './rules'
import './style.css'
import { ownLook, renameLooks, ruleLook, setLook, type IconicData } from './data'

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
    this.addSettings([
      { key: 'inNotes', name: 'Значки в самих заметках', desc: 'Показывать значок заметки перед ссылками на неё и рядом с её названием над текстом', type: 'toggle', default: true },
      {
        key: 'rules',
        section: 'Правила',
        name: 'Свод правил',
        desc: 'Правило даёт значок и цвет всем файлам или папкам, которые подходят под его условия. Действует первое подходящее сверху; значок, заданный самой заметке, сильнее правил. Хранятся в файле Iconic и работают в Obsidian',
        type: 'custom',
        render: (el) => {
          const holder = el.appendChild(document.createElement('div'))
          void this.read().then(() => drawRules(holder, app, () => this.data, () => this.save()))
          return () => holder.remove()
        },
      },
    ])
    const inNotes = () => {
      app.icons.inNotes = this.getSetting<boolean>('inNotes') !== false
      app.icons.refresh()
    }
    inNotes()
    this.onSettingChange((key) => key === 'inNotes' && inNotes())
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
    app.icons.pick = (kind, id) => void this.choose(kind, id, kind === 'tag' ? `#${id}` : kind === 'property' ? id : paths.basename(id))
    this.register(() => (app.icons.pick = null))
    const previous = app.icons.custom
    const previousNames = app.icons.customNames
    app.icons.custom = (name) => this.custom.get(name)
    app.icons.customNames = () => [...this.custom.keys()]
    app.icons.upload = (file) => this.upload(file)
    app.icons.own = (kind, id) => ownLook(this.data, kind, id)
    app.icons.assign = async (kind, id, look) => {
      await this.read()
      setLook(this.data, kind, id, look)
      await this.save()
    }
    this.register(() => {
      app.icons.custom = previous
      app.icons.customNames = previousNames
      app.icons.upload = null
      app.icons.own = null
      app.icons.assign = null
    })

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
      id: 'upload-icon',
      name: 'Загрузить свой значок',
      icon: 'upload',
      callback: () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
        input.onchange = async () => {
          const names: string[] = []
          for (const file of input.files ?? []) {
            const name = await this.upload(file)
            if (name) names.push(name)
          }
          if (names.length) app.notice(`Добавлены значки: ${names.join(', ')}`)
        }
        input.click()
      },
    })
    this.addCommand({
      id: 'active-file',
      name: 'Значок и цвет открытой заметки',
      icon: 'image-plus',
      callback: () => {
        const path = app.workspace.active?.path
        if (path && !path.startsWith('view:')) void this.choose('file', path, paths.basename(path))
      },
    })
  }

  private async choose(kind: LookKind, id: string, title: string): Promise<void> {
    const look = await pickLook(this.app, title, ownLook(this.data, kind, id) ?? {})
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

  /**
   * Obsidian knows icons that are not Lucide's only as SVG files among the custom icons.
   * So every icon of this app's own that the data names gets such a file, under its own name.
   */
  private async shareOwnIcons(): Promise<void> {
    const named = new Set<string>()
    for (const section of [this.data.fileIcons, this.data.tagIcons, this.data.propertyIcons]) for (const look of Object.values(section ?? {})) if (look?.icon) named.add(look.icon)
    for (const rule of [...(this.data.fileRules ?? []), ...(this.data.folderRules ?? [])]) if (rule.icon) named.add(rule.icon)
    for (const name of named) {
      const svg = this.app.icons.ownSvg(name)
      if (!svg || this.custom.has(name)) continue
      const path = `${this.config}/custom-icons/${name}.svg`
      await this.app.vault.write(path, svg)
      this.custom.set(name, this.app.vault.url(path))
    }
  }

  private async save(): Promise<void> {
    try {
      await this.shareOwnIcons()
      // Written the way Obsidian writes plugin data, so the file differs only where something changed.
      this.raw = JSON.stringify(this.data, null, 2)
      await this.app.vault.write(this.file, this.raw)
      this.app.icons.refresh()
    } catch (err) {
      this.app.notice(`Значки: не удалось сохранить: ${errorMessage(err)}`)
    }
  }

  /**
   * Keeps a picture as an icon of the user's own. It becomes an SVG in `custom-icons`,
   * where the "Add Custom Icons" plugin keeps its icons, so Obsidian sees it too.
   * A PNG or JPEG is converted; an SVG is kept as it is. Returns the icon's name.
   */
  private async upload(file: File): Promise<string | null> {
    try {
      const svg = /svg/i.test(file.type) || /\.svg$/i.test(file.name) ? await file.text() : await pictureToSvg(file)
      // The name Iconic keeps in its data is the id "Add Custom Icons" gives the file:
      // the file's name in small letters, with `_` for spaces and dots.
      const base =
        file.name
          .replace(/\.[^.]*$/, '')
          .replace(/[\\/:*?"<>|]+/g, ' ')
          .trim()
          .replace(/\s+/g, '_')
          .toLowerCase()
          .replace(/\./g, '_') || 'icon'
      // A name Lucide has would be drawn as Lucide's icon in Obsidian, and a taken one would replace a picture.
      let name = base
      for (let n = 2; this.custom.has(name) || this.app.icons.names().includes(name); n++) name = `${base}_${n}`
      const path = `${this.config}/custom-icons/${name}.svg`
      await this.app.vault.write(path, svg)
      this.custom.set(name, this.app.vault.url(path))
      this.app.icons.refresh()
      return name
    } catch (err) {
      this.app.notice(`Значки: не удалось добавить «${file.name}»: ${errorMessage(err)}`)
      return null
    }
  }

  /** Pictures of the "Add Custom Icons" plugin: every SVG in `custom-icons` is an icon named like its file. */
  private async readCustomIcons(): Promise<void> {
    const folder = `${this.config}/custom-icons`
    const files = await this.app.vault.list(folder).catch(() => [])
    this.custom = new Map(files.filter((name) => /\.svg$/i.test(name)).map((name) => [name.replace(/\.svg$/i, '').replace(/\s+/g, '_').toLowerCase().replace(/\./g, '_'), this.app.vault.url(`${folder}/${name}`)]))
    if (this.custom.size) this.app.icons.refresh()
  }
}
