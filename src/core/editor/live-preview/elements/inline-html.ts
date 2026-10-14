import { WidgetType } from '@codemirror/view'
import type { PreviewRenderer } from '..'

/** Tags of a line's text that are drawn as what they mean; any other tag stays as written. */
const TAGS = new Set(['mark', 'u', 'ins', 'del', 's', 'strike', 'sub', 'sup', 'kbd', 'span', 'font', 'b', 'i', 'strong', 'em', 'small', 'big', 'abbr', 'cite', 'q', 'code', 'var', 'samp'])
/** How a few old tags are drawn today. */
const AS: Record<string, string> = { font: 'span', strike: 's', big: 'span' }
const OPEN = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*>$/
const ATTRIBUTE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

class LineBreak extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    return document.createElement('br')
  }
}

/** The attributes that are kept: a style without anything that could run or load, a class, a title; `color` of `<font>` becomes a style. */
function attributesOf(tag: string, source: string): Record<string, string> {
  const out: Record<string, string> = {}
  const styles: string[] = []
  for (const m of source.matchAll(ATTRIBUTE)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    if (name === 'style' && !/expression\s*\(|javascript:|@import|behavior\s*:|url\s*\(/i.test(value)) styles.push(value)
    else if (name === 'class' || name === 'title') out[name] = value
    else if (tag === 'font' && name === 'color' && /^[#\w(),.\s%-]+$/.test(value)) styles.push(`color: ${value}`)
    else if (tag === 'font' && name === 'face' && /^[\w\s,'"-]+$/.test(value)) styles.push(`font-family: ${value}`)
  }
  if (tag === 'big') styles.push('font-size: larger')
  if (styles.length) out.style = styles.join('; ')
  return out
}

/**
 * HTML inside a line of text: `<mark>`, `<u>`, `<span style="color: red">`,
 * `<kbd>`, `<sub>`, `<br>` and the like are drawn as they read, with the tags
 * hidden; the cursor on them brings the tags back. A tag left without its
 * closing pair stays as written.
 */
export const inlineHtml: PreviewRenderer = {
  name: 'inline-html',
  nodes: ['HTMLTag'],
  render(node, ctx) {
    const source = ctx.text(node.from, node.to)
    if (/^<br\s*\/?>$/i.test(source)) {
      if (!ctx.isActive(node.from, node.to)) ctx.replace(node.from, node.to, new LineBreak())
      return
    }
    const open = OPEN.exec(source)
    if (!open) return
    const tag = open[1].toLowerCase()
    if (!TAGS.has(tag)) return
    // Its closing tag is looked for on the same line, past any of the same name opened inside it.
    const line = ctx.state.doc.lineAt(node.to)
    const rest = ctx.text(node.to, line.to)
    const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
    let depth = 0
    let close: RegExpExecArray | null = null
    for (let m = pattern.exec(rest); m; m = pattern.exec(rest)) {
      if (!m[1]) depth++
      else if (depth) depth--
      else {
        close = m
        break
      }
    }
    if (!close) return
    const inner = node.to
    const end = node.to + close.index
    ctx.mark(inner, end, { tagName: AS[tag] ?? tag, attributes: attributesOf(tag, open[2]) })
    if (ctx.isActive(node.from, end + close[0].length)) return
    ctx.hide(node.from, node.to)
    ctx.hide(end, end + close[0].length)
  },
}
