import { mount, unmount } from 'svelte'
import { cm, Plugin, type PreviewRenderer } from '../../api'
import { TagSelection } from './state'
import './style.css'
import { tagSyntax } from './syntax'
import TagsPanel from './TagsPanel.svelte'

const PANEL = 'tags'

export default class Tags extends Plugin {
  onload() {
    const { app } = this
    const selection = new TagSelection()

    const clicked = (event: MouseEvent) =>
      event.button === 0 && event.target instanceof Element
        ? event.target.closest<HTMLElement>('.lp-tag')?.dataset.tag
        : undefined

    /** The icon a tag was given, drawn in front of it. */
    class TagIcon extends cm.view.WidgetType {
      constructor(
        readonly icon: string,
        readonly color: string,
        readonly tag: string,
      ) {
        super()
      }
      eq(other: TagIcon) {
        return other.icon === this.icon && other.color === this.color && other.tag === this.tag
      }
      ignoreEvent() {
        return true
      }
      toDOM() {
        const el = app.icons.clickable(app.icons.draw(this.icon), 'tag', this.tag)
        el.classList.add('lp-tag-icon')
        el.style.color = this.color || 'var(--accent)'
        return el
      }
    }
    this.register(app.icons.on('change', () => app.livePreview.refresh()))

    /** `#tag` is drawn as a pill; clicking it shows the tag's notes in the panel. */
    const renderer: PreviewRenderer = {
      name: 'tags',
      nodes: ['Hashtag'],
      render(node, ctx) {
        if (ctx.isActive(node.from, node.to)) return
        const tag = ctx.text(node.from + 1, node.to)
        const look = app.icons.look('tag', tag)
        const color = app.icons.css(look?.color)
        if (look?.icon) ctx.widget(node.from, new TagIcon(look.icon, color, tag), -1)
        ctx.mark(node.from, node.to, {
          class: 'lp-tag',
          attributes: { 'data-tag': tag, ...(color ? { style: `--tag-color: ${color}` } : {}) },
        })
      },
      extension: cm.view.EditorView.domEventHandlers({
        contextmenu: (event) => {
          const tag = event.target instanceof Element ? event.target.closest<HTMLElement>('.lp-tag')?.dataset.tag : undefined
          if (tag === undefined) return false
          app.menus.show(event, 'tag', tag)
          return true
        },
        mousedown: (event) => clicked(event) !== undefined,
        click: (event) => {
          const tag = clicked(event)
          if (tag === undefined) return false
          selection.select(tag)
          app.panels.reveal(PANEL)
          return true
        },
      }),
    }

    this.registerMarkdownSyntax(tagSyntax)
    this.registerPreviewRenderer(renderer)
    this.registerCompletionSource((context) => {
      const match = context.matchBefore(/(?<![\p{L}\p{N}_/#&;])#[\p{L}\p{N}_/-]*$/u)
      if (!match) return null
      return {
        from: match.from + 1,
        validFor: /^[\p{L}\p{N}_/-]*$/u,
        options: app.metadata.tags().map(({ tag, files }) => ({ label: tag, detail: String(files.length) })),
      }
    })
    this.addPanel({
      id: PANEL,
      title: 'Теги',
      side: 'left',
      icon: 'M2 2.5h5.5L14 9l-5 5-6.5-6.5zM5 5.5v.1',
      mount: (target) => {
        const panel = mount(TagsPanel, { target, props: { app, selection } })
        return () => void unmount(panel)
      },
    })
  }
}
