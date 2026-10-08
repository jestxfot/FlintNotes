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

    /** `#tag` is drawn as a pill; clicking it shows the tag's notes in the panel. */
    const renderer: PreviewRenderer = {
      name: 'tags',
      nodes: ['Hashtag'],
      render(node, ctx) {
        if (ctx.isActive(node.from, node.to)) return
        ctx.mark(node.from, node.to, {
          class: 'lp-tag',
          attributes: { 'data-tag': ctx.text(node.from + 1, node.to) },
        })
      },
      extension: cm.view.EditorView.domEventHandlers({
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
      mount: (target) => {
        const panel = mount(TagsPanel, { target, props: { app, selection } })
        return () => void unmount(panel)
      },
    })
  }
}
