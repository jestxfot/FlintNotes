import { expr, path as paths, renderInline, type App } from '../../api'
import { h } from './dom'

function link(app: App, label: string, target: string, source: string): HTMLElement {
  return h(
    'a',
    {
      class: 'inline-link',
      href: '#',
      title: target,
      onclick: (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        const dest = app.metadata.resolve(target, source)
        if (dest) app.workspace.openFile(dest)
        else app.notice(`Заметка «${target}» не найдена`)
      },
    },
    label,
  )
}

const SIZES = ['Б', 'КБ', 'МБ', 'ГБ']

function fileSize(bytes: number): string {
  let unit = 0
  let value = bytes
  while (value >= 1024 && unit < SIZES.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit ? value.toFixed(1) : value} ${SIZES[unit]}`
}

/** Draws a value the way a cell shows it: links work, lists are comma-separated. */
export function renderValue(app: App, value: unknown, source: string, property = ''): Node {
  const type = expr.typeOf(value)
  if (type === 'null') return document.createTextNode('')
  if (type === 'boolean') return h('input', { type: 'checkbox', checked: value as boolean, disabled: true })
  if (type === 'link') {
    const target = (value as expr.Link).target
    return link(app, (value as expr.Link).display ?? paths.stripExt(paths.basename(target)), target, source)
  }
  if (type === 'file') return link(app, (value as expr.FileRef).basename, (value as expr.FileRef).path, source)
  if (type === 'list') {
    const out = document.createDocumentFragment()
    ;(value as unknown[]).forEach((item, i) => {
      if (i) out.append(', ')
      // Tags are stored without `#`; showing it makes them read as tags.
      const tag = property === 'file.tags' && typeof item === 'string'
      out.append(tag ? h('span', { class: 'inline-tag' }, `#${item}`) : renderValue(app, item, source))
    })
    return out
  }
  if (type === 'number' && property === 'file.size') return document.createTextNode(fileSize(value as number))
  if (type === 'string') return renderInline(app, value as string, source)
  return document.createTextNode(expr.toText(value))
}
