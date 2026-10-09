import { cm, errorMessage, filePath, path, Plugin } from '../../api'

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const pad = (n: number) => String(n).padStart(2, '0')

/** A screenshot from the clipboard arrives as `image.png`; it gets a name that says when it was pasted. */
function nameFor(file: File): string {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name.replace(/[\\/:*?"<>|]/g, '-')
  const now = new Date()
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `Вставка ${stamp}.${file.type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'png'}`
}

export default class Attachments extends Plugin {
  onload() {
    const { app } = this
    this.addSettings([
      {
        key: 'folder',
        name: 'Папка для вложений',
        desc: 'Пустое значение сохраняет файл рядом с заметкой',
        type: 'text',
        default: 'Вложения',
      },
      {
        key: 'format',
        name: 'Вид ссылки на вложение',
        type: 'select',
        default: 'markdown',
        options: [
          { value: 'markdown', label: 'Markdown: ![имя](путь)' },
          { value: 'wiki', label: 'Wiki: ![[имя]] (нужен плагин «Wiki-ссылки»)' },
        ],
      },
    ])

    /** Saves the files into the vault and puts links to them at `pos`. */
    const insert = async (view: InstanceType<typeof cm.view.EditorView>, files: File[], pos: number) => {
      const source = view.state.facet(filePath)
      const folder = this.getSetting<string>('folder').trim().replace(/^\/|\/$/g, '') || path.dirname(source)
      const links: string[] = []
      for (const file of files) {
        try {
          const name = nameFor(file)
          const ext = path.extname(name)
          const target = app.vault.uniquePath(folder, ext ? name.slice(0, -ext.length - 1) : name, ext)
          await app.vault.write(target, await file.arrayBuffer(), { create: true })
          const image = IMAGE.test(target)
          if (this.getSetting<string>('format') === 'wiki') links.push(`${image ? '!' : ''}[[${path.basename(target)}]]`)
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
}
