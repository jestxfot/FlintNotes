import { cm, errorMessage, filePath, ImageWidget, path, type App, type PreviewRenderer } from '../../api'

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

/** Opens the note a wikilink points to, creating it first if it does not exist. */
async function follow(app: App, link: string, source: string): Promise<void> {
  const [file, heading] = link.split('#')
  let dest = app.metadata.resolve(file, source)
  if (!dest) {
    const name = path.normalize(file.trim())
    if (!name) return
    try {
      dest = (await app.vault.create(path.extname(name) ? name : `${name}.md`)).path
    } catch (err) {
      app.notice(`Не удалось создать «${name}»: ${errorMessage(err)}`)
      return
    }
  }
  const wanted = heading?.trim().toLowerCase()
  const line = wanted ? app.metadata.get(dest)?.headings.find((h) => h.text.toLowerCase() === wanted)?.line : undefined
  app.workspace.openFile(dest, { line })
}

/**
 * `[[Note|alias]]` shows only its text; a link to a missing note is dimmed and
 * creates the note when clicked. `![[picture.png|300]]` shows the picture.
 */
export const wikilinkRenderer = (app: App): PreviewRenderer => {
  const target = (event: MouseEvent) =>
    event.button === 0 && event.target instanceof Element
      ? event.target.closest<HTMLElement>('.lp-wikilink')?.dataset.target
      : undefined

  return {
    name: 'wikilinks',
    nodes: ['Wikilink', 'WikiEmbed'],
    render(node, ctx) {
      const embed = node.name === 'WikiEmbed'
      const open = node.from + (embed ? 3 : 2)
      const close = node.to - 2
      const inner = ctx.text(open, close)
      const pipe = inner.indexOf('|')
      const link = pipe < 0 ? inner : inner.slice(0, pipe)
      const alias = pipe < 0 ? '' : inner.slice(pipe + 1)
      const dest = app.metadata.resolve(link.split('#')[0], ctx.path)
      const active = ctx.isActive(node.from, node.to)

      if (embed && dest && IMAGE.test(dest)) {
        const width = /^\d+$/.test(alias) ? alias : ''
        const widget = new ImageWidget(app.vault.url(dest), path.basename(dest), width, active)
        if (active) ctx.widget(node.to, widget)
        else ctx.replace(node.from, node.to, widget)
        return
      }
      if (active) return
      ctx.hide(node.from, open)
      ctx.hide(close, node.to)
      const textFrom = alias ? open + pipe + 1 : open
      ctx.hide(open, textFrom)
      ctx.mark(textFrom, close, {
        class: dest ? 'lp-wikilink' : 'lp-wikilink lp-wikilink-missing',
        attributes: { 'data-target': link.trim() },
      })
    },
    extension: cm.view.EditorView.domEventHandlers({
      // Swallowing mousedown keeps the cursor out of the link, which would reveal its source.
      mousedown: (event) => target(event) !== undefined,
      click: (event, view) => {
        const link = target(event)
        if (link === undefined) return false
        void follow(app, link, view.state.facet(filePath))
        return true
      },
    }),
  }
}
