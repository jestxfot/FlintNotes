import {
  cm,
  drawLinkBadge,
  embedDepth,
  EmbedWidget,
  errorMessage,
  filePath,
  ImageWidget,
  linkBadge,
  path,
  type App,
  type LinkBadge,
  type PreviewRenderer,
  moment,
  type Moment,
} from '../../api'

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
// Notes may embed notes that embed notes; past this depth an embed stays a link.
const MAX_EMBED_DEPTH = 3

/** Opens the note a wikilink points to, creating it first if it does not exist. */
export async function follow(app: App, link: string, source: string): Promise<void> {
  const [file, heading] = link.split('#')
  let dest = app.metadata.resolve(file, source)
  if (!dest) {
    // `[[{{date+1d:YYYY-MM-DD}}]]` in a daily note names the next day's note, also when that is yet to be made.
    const expanded = app.metadata.expandTarget(file, source).trim()
    const day = expanded !== file.trim() ? moment(expanded) : null
    // A neighbouring day belongs with the days: the calendar plugin, if it is on, makes
    // the note where daily notes go and from their template; otherwise it goes next to this one.
    const days = day?.isValid() ? app.services.get<{ ensure(period: 'daily', date: Moment): Promise<string | null> }>('periodic-notes') : undefined
    const name = path.normalize(day && !days ? path.join(path.dirname(source), expanded) : expanded)
    if (!name) return
    try {
      dest = days ? await days.ensure('daily', day!) : ((await app.creation.create(path.extname(name) ? name : `${name}.md`))?.path ?? null)
      if (!dest) return
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
  /** The icon of the note a link points to, drawn before the link's text. */
  class LinkIcon extends cm.view.WidgetType {
    constructor(
      readonly icon: string,
      readonly color: string,
    ) {
      super()
    }
    eq(other: LinkIcon) {
      return other.icon === this.icon && other.color === this.color
    }
    toDOM() {
      const el = app.icons.draw(this.icon)
      el.classList.add('lp-link-icon')
      el.style.color = this.color
      return el
    }
  }

  /** A mark after a link that a plugin gives the note it points to: a birthday coming, say. */
  class Badge extends cm.view.WidgetType {
    constructor(readonly badge: LinkBadge) {
      super()
    }
    eq(other: Badge) {
      return other.badge.text === this.badge.text && other.badge.title === this.badge.title && other.badge.tone === this.badge.tone
    }
    toDOM() {
      return drawLinkBadge(this.badge)
    }
  }

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
      // A link or embed under the cursor is shown as written; Ctrl+click on that text still follows it.
      if (active) ctx.mark(node.from, node.to, { class: 'lp-wikilink-source', attributes: { 'data-target': link.trim() } })

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
      if (active) return
      ctx.hide(node.from, open)
      ctx.hide(close, node.to)
      // In a link the text after `|` is what to show; in an embed it is a size, so the name stays.
      const textFrom = alias && !embed ? open + pipe + 1 : open
      const textTo = alias && embed ? open + pipe : close
      ctx.hide(open, textFrom)
      ctx.hide(textTo, close)
      // The note's own icon goes in front of a link to it.
      const look = dest && !embed && app.icons.inNotes ? app.icons.look('file', dest) : undefined
      if (look?.icon && look.icon !== 'lucide-file') ctx.widget(textFrom, new LinkIcon(look.icon, app.icons.css(look.color)), -1)
      ctx.mark(textFrom, textTo, {
        class: dest ? 'lp-wikilink' : 'lp-wikilink lp-wikilink-missing',
        attributes: { 'data-target': link.trim() },
      })
      const badge = dest && !embed ? linkBadge(dest) : null
      if (badge) ctx.widget(node.to, new Badge(badge), 1)
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
