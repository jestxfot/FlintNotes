import { errorMessage, Plugin, type App } from '../../api'
import { h } from './dom'
import { mountBase } from './render'
import './style.css'

const TEMPLATE = `# Какие заметки входят в базу
filters:
  and:
    - file.ext == "md"

# Вычисляемые свойства, например:
# formulas:
#   days_left: '(due - today()) / 86400000'

views:
  - type: table
    name: Таблица
    order:
      - file.name
      - file.folder
      - file.mtime
  - type: cards
    name: Карточки
`

/** A base kept in its own `.base` file, shown in a tab or embedded in a note. */
async function fileBase(app: App, path: string, el: HTMLElement, initialView?: string, embeddedIn = path) {
  const text = await app.vault.read(path)
  const base = mountBase(
    el,
    {
      app,
      // In an embedded base `this` is the note it is embedded in, as in Obsidian.
      sourcePath: embeddedIn,
      initialView,
      setSource: (source) =>
        void app.vault.write(path, `${source}\n`).catch((err) => app.notice(`Не удалось сохранить базу: ${errorMessage(err)}`)),
    },
    text.replace(/\n$/, ''),
  )
  return base
}

export default class Bases extends Plugin {
  onload() {
    const { app } = this

    this.registerCodeBlockProcessor('base', (source, el, ctx) =>
      mountBase(el, { app, sourcePath: ctx.path, setSource: ctx.setSource }, source),
    )

    this.registerView(
      'base',
      async ({ path, containerEl }) => {
        let current = path
        const body = h('div')
        const editor = h('textarea', { hidden: true, spellcheck: false })
        const toggle = h('button', {}, 'Исходный текст')
        const wrap = containerEl.appendChild(h('div', { class: 'base-file' }, h('div', { class: 'base-file-head' }, toggle), body, editor))
        const base = await fileBase(app, current, body)

        // The YAML can be edited here too; leaving the text view applies it.
        toggle.onclick = async () => {
          if (editor.hidden) editor.value = await app.vault.read(current)
          else {
            await app.vault.write(current, editor.value)
            base.update(editor.value.replace(/\n$/, ''))
          }
          editor.hidden = !editor.hidden
          body.hidden = !editor.hidden
          toggle.textContent = editor.hidden ? 'Исходный текст' : 'Готово'
        }
        return {
          onExternalChange: async () => {
            const text = await app.vault.read(current).catch(() => null)
            if (text !== null && editor.hidden) base.update(text.replace(/\n$/, ''))
          },
          onRename: (renamed) => (current = renamed),
          destroy: () => {
            base.destroy()
            wrap.remove()
          },
        }
      },
      ['base'],
    )

    // `![[Projects.base]]` shows the base in a note; `![[Projects.base#Board]]` opens on that view.
    this.registerEmbed(['base'], (el, ctx) => {
      let destroyed = false
      let destroy = () => {}
      void fileBase(app, ctx.path, el, ctx.subpath.slice(1) || undefined, ctx.sourcePath)
        .then((base) => (destroyed ? base.destroy() : (destroy = base.destroy)))
        .catch((err) => (el.textContent = `Не удалось открыть базу: ${errorMessage(err)}`))
      return () => {
        destroyed = true
        destroy()
      }
    })

    this.addInsertCommand('insert', 'Вставить базу данных в заметку', '```base\nviews:\n  - type: table\n    name: |\n```\n', 'database')
    this.addCommand({
      id: 'new',
      icon: 'database',
      name: 'Новая база данных',
      callback: async () => {
        try {
          const entry = await app.vault.create(app.vault.uniquePath('', 'База', 'base'), TEMPLATE)
          app.workspace.openFile(entry.path)
        } catch (err) {
          app.notice(`Не удалось создать базу: ${errorMessage(err)}`)
        }
      },
    })
  }
}
