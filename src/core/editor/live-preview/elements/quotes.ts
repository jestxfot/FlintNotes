import { WidgetType } from '@codemirror/view'
import type { PreviewRenderer } from '..'

// Callout types share a handful of colors; unknown types look like a note.
const KINDS: Record<string, { color: string; label: string }> = {
  note: { color: 'info', label: 'Заметка' },
  info: { color: 'info', label: 'Информация' },
  todo: { color: 'info', label: 'Сделать' },
  abstract: { color: 'info', label: 'Кратко' },
  summary: { color: 'info', label: 'Кратко' },
  tip: { color: 'good', label: 'Совет' },
  hint: { color: 'good', label: 'Подсказка' },
  success: { color: 'good', label: 'Готово' },
  done: { color: 'good', label: 'Готово' },
  important: { color: 'good', label: 'Важно' },
  question: { color: 'warn', label: 'Вопрос' },
  help: { color: 'warn', label: 'Вопрос' },
  warning: { color: 'warn', label: 'Внимание' },
  caution: { color: 'warn', label: 'Осторожно' },
  attention: { color: 'warn', label: 'Внимание' },
  danger: { color: 'bad', label: 'Опасно' },
  error: { color: 'bad', label: 'Ошибка' },
  failure: { color: 'bad', label: 'Не получилось' },
  bug: { color: 'bad', label: 'Ошибка' },
  example: { color: 'other', label: 'Пример' },
  quote: { color: 'quiet', label: 'Цитата' },
  cite: { color: 'quiet', label: 'Цитата' },
}

const CALLOUT = /^(\s*>\s*)\[!([\w-]+)\][+-]?[ \t]*(.*)$/

class CalloutLabel extends WidgetType {
  constructor(private label: string) {
    super()
  }
  eq(other: CalloutLabel) {
    return other.label === this.label
  }
  toDOM() {
    const el = document.createElement('span')
    el.textContent = this.label
    return el
  }
}

/**
 * `> quote`: lines get a side bar; the `>` is hidden unless the cursor is on the line.
 * A quote starting with `> [!note] Title` is a callout: a colored box with a title.
 */
export const quotes: PreviewRenderer = {
  name: 'quotes',
  nodes: ['Blockquote', 'QuoteMark'],
  render(node, ctx) {
    if (node.name === 'QuoteMark') {
      if (ctx.lineActive(node.from)) return
      const space = ctx.text(node.to, node.to + 1) === ' ' ? 1 : 0
      ctx.hide(node.from, node.to + space)
      return
    }
    const first = ctx.state.doc.lineAt(node.from)
    const callout = CALLOUT.exec(first.text)
    if (!callout) {
      ctx.lines(node.from, node.to, (line) => ctx.line(line.from, 'lp-quote'))
      return
    }
    const type = callout[2].toLowerCase()
    const kind = Object.hasOwn(KINDS, type) ? KINDS[type] : { color: 'info', label: callout[2] }
    const last = ctx.state.doc.lineAt(node.to).number
    ctx.lines(node.from, node.to, (line) => {
      const edge = (line.number === first.number ? ' lp-callout-title' : '') + (line.number === last ? ' lp-callout-last' : '')
      ctx.line(line.from, `lp-callout lp-callout-${kind.color}${edge}`)
    })
    if (ctx.lineActive(first.from)) return
    // `[!note]` gives way to the title; a callout without one is titled by its type.
    const from = first.from + callout[1].length
    const to = first.to - callout[3].length
    if (callout[3]) ctx.hide(from, to)
    else ctx.replace(from, to, new CalloutLabel(kind.label))
  },
}
