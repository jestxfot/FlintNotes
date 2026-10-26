import { cm, errorMessage, Plugin, type CodeBlockProcessor, type PreviewRenderer } from '../../api'
import { evaluate } from './evaluate'
import { runInlineScript, runScript } from './js'
import { Pages } from './pages'
import { parseExpression } from './parser'
import { parseQuery, runQuery, scopeFor, type Result } from './query'
import { PAGE, renderResult, renderValue, stamp, type DrawEnv, type DrawState } from './render'
import './style.css'

/** How long the vault must stay quiet before queries are worked out again. */
const SETTLE = 300

export default class Dataview extends Plugin {
  onload() {
    const { app } = this
    const pages = new Pages(app)
    const env = (origin: string): DrawEnv => ({ app, pages, origin, dateFormat: this.getSetting<string>('dateFormat') || 'D MMMM YYYY' })

    this.addSettings([
      { key: 'dateFormat', name: 'Формат дат', desc: 'Как показывать даты в запросах, в обозначениях moment.js, например D MMMM YYYY', type: 'text', default: 'D MMMM YYYY', placeholder: 'D MMMM YYYY' },
      { key: 'inlinePrefix', name: 'Начало встроенного запроса', desc: 'Код `= выражение` в тексте заметки показывает вычисленное значение. Здесь можно сменить «=» на другой знак', type: 'text', default: '=' },
      {
        key: 'js',
        name: 'Скрипты dataviewjs',
        desc: 'Блоки ```dataviewjs и `$= выражения` выполняют JavaScript из заметок с полным доступом к хранилищу. Включайте, только если доверяете своим заметкам',
        type: 'toggle',
        default: true,
      },
    ])

    /** Redraws `draw` when the vault changes, but only while the block is on screen. */
    const live = (el: HTMLElement, draw: () => void) => {
      let stale = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const run = () => {
        if (!el.isConnected || el.offsetParent === null) {
          stale = true
          return
        }
        stale = false
        draw()
      }
      const later = () => {
        clearTimeout(timer)
        timer = setTimeout(run, SETTLE)
      }
      // The element is not in the page yet while the block is being created.
      requestAnimationFrame(run)
      const offs = [app.metadata.on('changed', later), app.metadata.on('resolved', later)]
      const visible = new IntersectionObserver((entries) => {
        if (stale && entries.some((entry) => entry.isIntersecting)) run()
      })
      visible.observe(el)
      return {
        run,
        destroy() {
          clearTimeout(timer)
          offs.forEach((off) => off())
          visible.disconnect()
        },
      }
    }

    const showError = (el: HTMLElement, err: unknown) => {
      el.replaceChildren()
      const box = el.appendChild(document.createElement('div'))
      box.className = 'dv-error'
      box.textContent = `Dataview: ${errorMessage(err)}`
    }

    const query: CodeBlockProcessor = (source, el, { path }) => {
      el.classList.add('dv-block')
      let current = source
      let drawn = ''
      const state: DrawState = { shown: PAGE, redraw: () => draw(true) }
      const draw = (force = false) => {
        let result: Result
        try {
          result = runQuery(parseQuery(current), env(path))
        } catch (err) {
          drawn = ''
          return showError(el, err)
        }
        // Most changes in the vault leave a given result as it was; then the page is not touched.
        const signature = stamp([result.type, result.type === 'table' ? [result.headers, result.rows] : result.type === 'list' ? result.items : result.type === 'task' ? result.groups : result.days])
        if (signature === drawn && !force) return
        drawn = signature
        renderResult(env(path), result, el, state)
      }
      const block = live(el, () => draw())
      return {
        update(next) {
          current = next
          state.shown = PAGE
          state.month = undefined
          block.run()
        },
        destroy: block.destroy,
      }
    }
    this.registerCodeBlockProcessor('dataview', query)

    const script: CodeBlockProcessor = (source, el, { path }) => {
      el.classList.add('dv-block')
      let current = source
      let run = 0
      const draw = () => {
        if (!this.getSetting<boolean>('js')) return showError(el, 'скрипты выключены в настройках плагина')
        // A script draws as it goes, so it gets a fresh box that replaces the old one when it is done.
        const box = document.createElement('div')
        const mine = ++run
        runScript(current, env(path), box).then(
          () => mine === run && el.replaceChildren(box),
          (err) => mine === run && showError(el, err),
        )
      }
      const block = live(el, draw)
      return {
        update(next) {
          current = next
          block.run()
        },
        destroy: block.destroy,
      }
    }
    this.registerCodeBlockProcessor('dataviewjs', script)
    this.addInsertCommand('insert-table', 'Вставить запрос Dataview: таблица', '```dataview\nTABLE |\nFROM ""\n```\n', 'table')
    this.addInsertCommand('insert-list', 'Вставить запрос Dataview: список', '```dataview\nLIST\nFROM "|"\n```\n', 'list')
    this.addInsertCommand('insert-task', 'Вставить запрос Dataview: задачи', '```dataview\nTASK\nWHERE !completed|\n```\n', 'list-checks')
    this.addInsertCommand('insert-calendar', 'Вставить запрос Dataview: календарь', '```dataview\nCALENDAR file.day\nFROM "|"\n```\n', 'calendar')
    this.addInsertCommand('insert-js', 'Вставить скрипт dataviewjs', '```dataviewjs\n|\n```\n', 'braces')

    // ---- `= expression` in the text shows its value
    const plugin = this
    let version = 0
    let used = false
    /** The value of an inline query (`= expression`, or `$= script`) of the note at `path`. */
    const drawValue = (source: string, js: boolean, path: string) => {
      const el = document.createElement('span')
      el.className = 'dv-inline'
      const scope = env(path)
      const fail = (err: unknown) => {
        el.classList.add('dv-inline-error')
        el.textContent = `Dataview: ${errorMessage(err)}`
      }
      try {
        if (!js) el.append(renderValue(scope, evaluate(parseExpression(source), scopeFor(scope, pages.get(path) ?? {}))))
        else if (!plugin.getSetting<boolean>('js')) fail('скрипты выключены')
        else runInlineScript(source, scope, el).then((value) => value !== undefined && el.append(renderValue(scope, value)), fail)
      } catch (err) {
        fail(err)
      }
      return el
    }
    /** Which kind of inline query a piece of inline code is, if any. */
    const inlineQuery = (text: string): { source: string; js: boolean } | null => {
      const prefix = this.getSetting<string>('inlinePrefix') || '='
      if (text.startsWith('$=')) return { source: text.slice(2).trim(), js: true }
      return text.startsWith(prefix) ? { source: text.slice(prefix.length).trim(), js: false } : null
    }
    // Outside the editor too: a task's text in the planner, the task manager, reminders, a table's cell.
    this.registerInlineCode((code, path) => {
      const query = inlineQuery(code)
      return query ? drawValue(query.source, query.js, path) : null
    })
    class InlineValue extends cm.view.WidgetType {
      constructor(
        readonly source: string,
        readonly js: boolean,
        readonly path: string,
        readonly version: number,
      ) {
        super()
      }
      eq(other: InlineValue) {
        return other.source === this.source && other.js === this.js && other.path === this.path && other.version === this.version
      }
      toDOM() {
        return drawValue(this.source, this.js, this.path)
      }
    }
    const inline: PreviewRenderer = {
      name: 'dataview-inline',
      nodes: ['InlineCode'],
      render: (node, ctx) => {
        const marks = node.node.getChildren('CodeMark')
        if (marks.length < 2) return
        const query = inlineQuery(ctx.text(marks[0].to, marks[marks.length - 1].from))
        if (!query) return
        used = true
        if (ctx.isActive(node.from, node.to)) return
        ctx.replace(node.from, node.to, new InlineValue(query.source, query.js, ctx.path, version))
      },
    }
    this.registerPreviewRenderer(inline)
    // Values in the text follow the vault too, if any note on screen has them.
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (!used) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        used = false
        version++
        app.livePreview.refresh()
      }, SETTLE)
    }
    this.register(app.metadata.on('changed', refresh))
    this.register(() => clearTimeout(timer))
  }
}
