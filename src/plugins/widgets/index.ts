import { moment, Plugin, type CodeBlockProcessor } from '../../api'
import './style.css'

type Options = Record<string, string>
/** Draws a widget into `el`; the returned function stops its timer. */
type Widget = (el: HTMLElement, options: Options, path: string) => (() => void) | void

/** `key: value` on every line; quotes around a value are optional. */
function parseOptions(source: string): Options {
  const options: Options = {}
  for (const line of source.split('\n')) {
    const at = line.indexOf(':')
    if (at < 0) continue
    options[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return options
}

function el(parent: HTMLElement, className: string, text = ''): HTMLElement {
  const node = parent.appendChild(document.createElement('div'))
  node.className = className
  node.textContent = text
  return node
}

const every = (ms: number, tick: () => void) => {
  tick()
  const timer = setInterval(tick, ms)
  return () => clearInterval(timer)
}

/**
 * ```widgets
 * type: clock            type: countdown        type: counter       type: quote
 * format: 12hr | 24hr    date: 2027-01-01       text: Выпито воды   quote: …
 * hideSeconds: true      to: Новый год          startValue: 0       author: …
 *                        show: days, hours      increment: 1
 *                        completedLabel: …      id: water
 * ```
 */
export default class Widgets extends Plugin {
  onload() {
    const { app } = this

    const clock: Widget = (box, options) => {
      const face = el(box, 'widget-clock')
      const row = el(face, 'widget-clock-row')
      const time = el(row, 'widget-clock-time')
      const half = options.format === '12hr' ? el(row, 'widget-clock-half') : null
      const date = el(face, 'widget-clock-date')
      const seconds = !options.hideSeconds || options.hideSeconds === 'false'
      return every(500, () => {
        const now = moment()
        time.textContent = now.format(`${half ? 'hh' : 'HH'}:mm${seconds ? ':ss' : ''}`)
        if (half) half.textContent = now.format('A')
        const day = now.format('dddd, D MMMM YYYY')
        date.textContent = day[0].toUpperCase() + day.slice(1)
      })
    }

    const UNITS: [name: string, label: string, seconds: number][] = [
      ['years', 'лет', 31_536_000],
      ['days', 'дней', 86_400],
      ['hours', 'часов', 3600],
      ['minutes', 'минут', 60],
      ['seconds', 'секунд', 1],
    ]
    const countdown: Widget = (box, options) => {
      const face = el(box, 'widget-countdown')
      const row = el(face, 'widget-countdown-row')
      if (options.to) el(face, 'widget-countdown-to', options.to)
      // `+10m` counts from the moment the widget appears; otherwise it is a date.
      const relative = /^\+(\d+)([smhdy])$/.exec(options.date ?? '')
      const unit = { s: 'second', m: 'minute', h: 'hour', d: 'day', y: 'year' } as const
      const end = relative ? moment().add(Number(relative[1]), unit[relative[2] as keyof typeof unit]) : moment(options.date ?? '')
      if (!end.isValid()) {
        row.textContent = 'Неверная дата'
        return
      }
      const shown = options.show ? options.show.split(',').map((item) => item.trim()) : UNITS.map(([name]) => name)
      return every(500, () => {
        let left = Math.floor((end.valueOf() - Date.now()) / 1000)
        row.replaceChildren()
        if (left < 0) {
          row.textContent = options.completedLabel || 'Готово! 🎉'
          return
        }
        for (const [name, label, size] of UNITS) {
          const amount = Math.floor(left / size)
          left -= amount * size
          if (!shown.includes(name)) continue
          const item = el(row, 'widget-countdown-item')
          el(item, 'widget-countdown-number', String(amount))
          el(item, 'widget-countdown-label', label)
        }
      })
    }

    const counter: Widget = (box, options, path) => {
      // The number is kept with the vault's state, as the Obsidian plugin keeps it in its own data: the note is not changed.
      const key = `widget-counter:${path}${options.id ? `-${options.id}` : ''}`
      const step = parseInt(options.increment || '1') || 1
      let count = app.state.get<number>(key, parseInt(options.startValue || '0') || 0)
      const face = el(box, 'widget-counter')
      if (options.text) el(face, 'widget-counter-text', options.text)
      const row = el(face, 'widget-counter-row')
      const button = (label: string, by: number, title: string) => {
        const node = row.appendChild(document.createElement('button'))
        node.textContent = label
        node.title = title
        node.onclick = () => {
          count += by
          value.textContent = String(count)
          app.state.set(key, count)
        }
      }
      button('−', -step, 'Меньше')
      const value = el(row, 'widget-counter-value', String(count))
      button('+', step, 'Больше')
    }

    const quote: Widget = (box, options) => {
      const face = el(box, 'widget-quote')
      el(face, 'widget-quote-text', `«${options.quote ?? ''}»`)
      if (options.author) el(face, 'widget-quote-author', options.author)
    }

    const widgets: Record<string, Widget> = { clock, countdown, counter, quote }

    const processor: CodeBlockProcessor = (source, target, { path }) => {
      target.classList.add('widget-block')
      let stop: (() => void) | void
      const draw = (text: string) => {
        stop?.()
        target.replaceChildren()
        const options = parseOptions(text)
        const widget = Object.hasOwn(widgets, options.type ?? '') ? widgets[options.type] : null
        if (widget) stop = widget(target, options, path)
        else el(target, 'widget-error', `Нет виджета «${options.type ?? ''}». Есть: ${Object.keys(widgets).join(', ')}`)
      }
      draw(source)
      return { update: draw, destroy: () => stop?.() }
    }
    this.registerCodeBlockProcessor('widgets', processor)
    this.addInsertCommand('insert-clock', 'Вставить виджет: часы', '```widgets\ntype: clock\nformat: 24hr\n```\n', 'clock')
    this.addInsertCommand('insert-countdown', 'Вставить виджет: обратный отсчёт', '```widgets\ntype: countdown\ndate: |\nto: \n```\n', 'timer')
    this.addInsertCommand('insert-counter', 'Вставить виджет: счётчик', '```widgets\ntype: counter\ntext: |\n```\n', 'circle-plus')
    this.addInsertCommand('insert-quote', 'Вставить виджет: цитата', '```widgets\ntype: quote\nquote: |\nauthor: \n```\n', 'quote')
  }
}
