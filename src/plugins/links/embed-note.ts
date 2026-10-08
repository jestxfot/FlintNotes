import { createPreview, path, type CachedMetadata, type EmbedRenderer, type Preview } from '../../api'

const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

/**
 * The part of a note an embed shows: the section under `#Heading` (up to the
 * next heading of the same or a higher level), or the whole note without its
 * frontmatter.
 */
function sectionRange(text: string, meta: CachedMetadata | undefined, subpath: string) {
  let from = FRONTMATTER.exec(text)?.[0].length ?? 0
  let to = text.length
  const wanted = subpath.slice(1).trim().toLowerCase()
  const headings = meta?.headings ?? []
  const index = wanted ? headings.findIndex((h) => h.text.toLowerCase() === wanted) : -1
  if (index >= 0) {
    const starts = [0]
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
    const next = headings.slice(index + 1).find((h) => h.level <= headings[index].level)
    from = starts[headings[index].line]
    if (next) to = starts[next.line]
  }
  return { from, to: from + text.slice(from, to).trimEnd().length }
}

/**
 * `![[Note]]` and `![[Note#Heading]]`: the note is shown in place and follows
 * its file. Controls inside it (checkboxes, rendered blocks) edit that file.
 */
export const noteEmbed: EmbedRenderer = (el, ctx) => {
  const { app } = ctx
  el.classList.add('lp-embed-note')

  const heading = ctx.subpath.slice(1).trim()
  const title = el.appendChild(document.createElement('button'))
  title.className = 'lp-embed-title'
  title.textContent = path.stripExt(path.basename(ctx.path)) + (heading ? ` › ${heading}` : '')
  title.onclick = () => {
    const line = app.metadata.get(ctx.path)?.headings.find((h) => h.text.toLowerCase() === heading.toLowerCase())?.line
    app.workspace.openFile(ctx.path, { line: heading ? line : undefined })
  }

  const body = el.appendChild(document.createElement('div'))
  let preview: Preview | undefined
  let full = ''
  let range = { from: 0, to: 0 }

  const save = (section: string) => {
    const eol = full.includes('\r\n') ? '\r\n' : '\n'
    const next = section.replace(/\r?\n/g, eol)
    full = full.slice(0, range.from) + next + full.slice(range.to)
    range = { from: range.from, to: range.from + next.length }
    void app.vault.write(ctx.path, full)
  }

  const render = () => {
    full = app.metadata.text(ctx.path) ?? ''
    range = sectionRange(full, app.metadata.get(ctx.path), ctx.subpath)
    const section = full.slice(range.from, range.to).replace(/\r\n/g, '\n')
    if (preview) preview.update(section)
    else preview = createPreview(app, body, section, ctx.path, { depth: ctx.depth + 1, onEdit: save })
  }

  render()
  const off = app.metadata.on('changed', (changed) => changed === ctx.path && render())
  return () => {
    off()
    preview?.destroy()
  }
}
