import {
  cm,
  embedDepth,
  EmbedWidget,
  errorMessage,
  filePath,
  ImageWidget,
  path,
  type App,
  type PreviewRenderer,
} from '../../api'

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
// Notes may embed notes that embed notes; past this depth an embed stays a link.
const MAX_EMBED_DEPTH = 3

/** Opens the note a wikilink points to, creating it first if it does not exist. */
export async function follow(app: App, link: string, source: string): Promise<void> {
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
 * creates the note when clicked. `![[picture.png|300]]` shows the picture, and
 * `![[file]]` of any type some plugin can embed (notes, PDF, ...) shows the file.
 */
export const wikilinkRenderer = (app: App): PreviewRenderer => {
  const target = (event: MouseEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return undefined
    const rendered = event.target.closest<HTMLElement>('.lp-wikilink')?.dataset.target
    // A link under the cursor is shown as written; Ctrl+click still follows it.
    return rendered ?? (event.ctrlKey || event.metaKey ? event.target.closest<HTMLElement>('.lp-wikilink-source')?.dataset.target : undefined)
  }

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
      const depth = ctx.state.facet(embedDepth)
      const renderer = embed && dest && depth < MAX_EMBED_DEPTH ? app.embeds.get(dest) : undefined
      if (renderer && dest) {
        const subpath = link.includes('#') ? link.slice(link.indexOf('#')) : ''
        const widget = new EmbedWidget(renderer, { app, path: dest, subpath, alias, sourcePath: ctx.path, depth })
        if (active) ctx.widget(node.to, widget)
        else ctx.replace(node.from, node.to, widget)
        return
      }
      if (active) {
        if (!embed) ctx.mark(node.from, node.to, { class: 'lp-wikilink-source', attributes: { 'data-target': link.trim() } })
        return
      }
      ctx.hide(node.from, open)
      ctx.hide(close, node.to)
      // In a link the text after `|` is what to show; in an embed it is a size, so the name stays.
      const textFrom = alias && !embed ? open + pipe + 1 : open
      const textTo = alias && embed ? open + pipe : close
      ctx.hide(open, textFrom)
      ctx.hide(textTo, close)
      ctx.mark(textFrom, textTo, {
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
