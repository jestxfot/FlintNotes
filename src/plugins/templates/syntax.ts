import { parseMixed } from '@lezer/common'
import { tags as t } from '@lezer/highlight'
import { parser as javascript } from '@lezer/javascript'
import type { MarkdownConfig } from '@lezer/markdown'

const LESS = 60
const PERCENT = 37
// `<%*` runs code, `<%+` is worked out every time the note is shown, `<%-` and `<%_` trim whitespace.
const FLAGS = new Set(['*', '+', '-', '_'])

/** Where the code of a command starts and ends inside `text`, which begins with `<%`. */
function inner(text: string, close: number): [from: number, to: number] {
  let from = 2
  while (FLAGS.has(text[from])) from++
  let to = close
  if (to > from && (text[to - 1] === '-' || text[to - 1] === '_')) to--
  return [from, Math.max(from, to)]
}

/**
 * Templater commands, `<% tp.date.now() %>` in a line and `<%* ... %>` over
 * several lines, as elements of their own with the code inside highlighted as
 * JavaScript. Without this the Markdown parser reads the code as text: a `*`
 * in it starts italics, an indented line becomes a code block.
 */
export const templateSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'TemplateCommand' },
    { name: 'TemplateBlock', block: true },
    { name: 'TemplateMark', style: t.processingInstruction },
    { name: 'TemplateCode' },
  ],
  parseInline: [
    {
      name: 'TemplateCommand',
      before: 'Escape',
      parse(cx, next, pos) {
        if (next !== LESS || cx.char(pos + 1) !== PERCENT) return -1
        const text = cx.slice(pos, cx.end)
        const close = text.indexOf('%>', 2)
        if (close < 0) return -1
        const [from, to] = inner(text, close)
        return cx.addElement(
          cx.elt('TemplateCommand', pos, pos + close + 2, [
            cx.elt('TemplateMark', pos, pos + from),
            cx.elt('TemplateCode', pos + from, pos + to),
            cx.elt('TemplateMark', pos + to, pos + close + 2),
          ]),
        )
      },
    },
  ],
  parseBlock: [
    {
      name: 'TemplateBlock',
      before: 'HTMLBlock',
      parse(cx, line) {
        if (line.next !== LESS || line.text.charCodeAt(line.pos + 1) !== PERCENT) return false
        // A command that ends on its own line is left to the inline parser.
        if (line.text.includes('%>', line.pos + 2)) return false
        const start = cx.lineStart + line.pos
        let source = line.text.slice(line.pos)
        let end = start + source.length
        let close = -1
        while (close < 0 && cx.nextLine()) {
          const at = line.text.indexOf('%>')
          source += `\n${line.text}`
          if (at >= 0) close = source.length - line.text.length + at
          end = cx.lineStart + line.text.length
        }
        if (close >= 0) cx.nextLine()
        // A command that is never closed runs to the end of the note, like an unclosed code block.
        const [from, to] = inner(source, close < 0 ? source.length : close)
        const parts = [cx.elt('TemplateMark', start, start + from), cx.elt('TemplateCode', start + from, start + to)]
        if (close >= 0) parts.push(cx.elt('TemplateMark', start + to, start + close + 2))
        cx.addElement(cx.elt('TemplateBlock', start, close >= 0 ? start + close + 2 : end, parts))
        return true
      },
    },
  ],
  wrap: parseMixed((node) => (node.name === 'TemplateCode' && node.from < node.to ? { parser: javascript } : null)),
}
