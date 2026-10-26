import { cm, errorMessage, filePath, path, Plugin } from '../../api'

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const pad = (n: number) => String(n).padStart(2, '0')

/** A screenshot from the clipboard arrives as `image.png`; it is named the way Obsidian names it, by when it was pasted. */
function nameFor(file: File, template: string): string {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name.replace(/[\\/:*?"<>|]/g, '-')
  const now = new Date()
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const base = (template.trim() || 'Pasted image {date}').replace(/\{date\}/g, stamp).replace(/[\\/:*?"<>|]/g, '-')
  return `${base.includes(stamp) ? base : `${base} ${stamp}`}.${file.type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'png'}`
}

export default class Attachments extends Plugin {
  onload() {
    const { app } = this
    this.addSettings([
      {
        key: 'location',
        name: 'Куда сохранять вложения',
        desc: 'Куда попадают картинки и файлы, вставленные или перетащенные в заметку',
        type: 'select',
        default: 'subfolder',
        options: [
          { value: 'subfolder', label: 'В подпапку рядом с заметкой' },
          { value: 'same', label: 'В ту же папку, что и заметка' },
          { value: 'folder', label: 'В указанную папку хранилища' },
          { value: 'root', label: 'В корень хранилища' },
        ],
      },
      { key: 'subfolder', name: 'Имя подпапки', desc: 'Для варианта «В подпапку рядом с заметкой». Для life/people/Анна.md вложения лягут в life/people/attachments', type: 'text', default: 'attachments', placeholder: 'attachments' },
      { key: 'folder', name: 'Указанная папка', desc: 'Для варианта «В указанную папку хранилища», например attachments', type: 'text', default: 'Вложения' },
      {
        key: 'format',
        name: 'Вид ссылки на вложение',
        desc: 'Wiki-ссылки короче и привычны Obsidian; Markdown-ссылки понимают и другие редакторы',
        type: 'select',
        default: 'wiki',
        options: [
          { value: 'wiki', label: 'Wiki: ![[Pasted image 20251002153930.png]]' },
          { value: 'markdown', label: 'Markdown: ![имя](путь)' },
        ],
      },
      { key: 'pasteName', name: 'Имя вставленной картинки', desc: 'Имя файла картинки из буфера обмена. {date} — дата и время вставки, например 20251002153930', type: 'text', default: 'Pasted image {date}', placeholder: 'Pasted image {date}' },
    ])
    void this.importFromObsidian()

    /** The folder attachments of a note go to. */
    const folderFor = (source: string): string => {
      const beside = path.dirname(source)
      const clean = (text: string) => text.trim().replace(/^\/+|\/+$/g, '')
      const where = this.getSetting<string>('location')
      if (where === 'same') return beside
      if (where === 'root') return ''
      if (where === 'folder') return clean(this.getSetting<string>('folder')) || beside
      return path.join(beside, clean(this.getSetting<string>('subfolder')) || 'attachments')
    }

    /** Saves the files into the vault and puts links to them at `pos`. */
    const insert = async (view: InstanceType<typeof cm.view.EditorView>, files: File[], pos: number) => {
      const source = view.state.facet(filePath)
      const folder = folderFor(source)
      const links: string[] = []
      for (const file of files) {
        try {
          const name = nameFor(file, this.getSetting<string>('pasteName') ?? '')
          const ext = path.extname(name)
          const target = app.vault.uniquePath(folder, ext ? name.slice(0, -ext.length - 1) : name, ext)
          await app.vault.write(target, await file.arrayBuffer(), { create: true })
          const image = IMAGE.test(target)
          if (this.getSetting<string>('format') !== 'markdown') links.push(`${image ? '!' : ''}[[${path.basename(target)}]]`)
          else links.push(`${image ? '!' : ''}[${path.basename(target)}](${encodeURI(path.relative(path.dirname(source), target))})`)
        } catch (err) {
          app.notice(`Не удалось сохранить «${file.name}»: ${errorMessage(err)}`)
        }
      }
      if (!links.length) return
      const text = links.join(view.state.lineBreak)
      const at = Math.min(pos, view.state.doc.length)
      view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } })
    }

    this.registerEditorExtension(
      cm.view.EditorView.domEventHandlers({
        paste: (event, view) => {
          const files = [...(event.clipboardData?.files ?? [])]
          if (!files.length) return false
          event.preventDefault()
          void insert(view, files, view.state.selection.main.head)
          return true
        },
        drop: (event, view) => {
          const files = [...(event.dataTransfer?.files ?? [])]
          if (!files.length) return false
          event.preventDefault()
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
          void insert(view, files, pos)
          return true
        },
      }),
    )
  }

  /** Takes where attachments go and how they are linked from Obsidian's own settings, once. */
  private async importFromObsidian(): Promise<void> {
    const { app } = this
    if (this.getSetting<boolean>('imported') || !app.obsidianConfig) return
    this.setSetting('imported', true)
    try {
      const text = await app.vault.readOptional(`${app.obsidianConfig}/app.json`)
      const config = text ? (JSON.parse(text) as { attachmentFolderPath?: string; useMarkdownLinks?: boolean }) : null
      if (!config) return
      const where = config.attachmentFolderPath
      // Obsidian writes: "/" the root, "./" beside the note, "./name" a subfolder beside it, "name" a folder of the vault.
      if (where === '/' ) this.setSetting('location', 'root')
      else if (where === './') this.setSetting('location', 'same')
      else if (where?.startsWith('./')) {
        this.setSetting('location', 'subfolder')
        this.setSetting('subfolder', where.slice(2))
      } else if (where) {
        this.setSetting('location', 'folder')
        this.setSetting('folder', where)
      }
      if (typeof config.useMarkdownLinks === 'boolean') this.setSetting('format', config.useMarkdownLinks ? 'markdown' : 'wiki')
    } catch {
      // A broken file is the same as none: the defaults stay.
    }
  }
}
