import { WidgetType, type EditorView } from '@codemirror/view'
import type { EmbedContext, EmbedRenderer } from '../../embeds'
import type { Off } from '../../events'
import { errorMessage } from '../../notice'

const cleanups = new WeakMap<HTMLElement, Off>()
const owners = new WeakMap<HTMLElement, EditorView>()

/**
 * Embeds gone out of the editor's view, kept a while to come back to, as blocks are (see `keptBlocks`): an embedded
 * note or base made anew as it scrolled back held the scrolling up.
 */
const KEPT = 24
const kept = new Map<string, HTMLElement>()
const rendererIds = new WeakMap<EmbedRenderer, number>()
let lastRendererId = 0

function drop(key: string): void {
  const dom = kept.get(key)
  if (!dom) return
  kept.delete(key)
  cleanups.get(dom)?.()
}

/** The embeds kept for an editor that is gone go with it. */
export function forgetKeptEmbeds(view: EditorView): void {
  for (const [key, dom] of [...kept]) if (owners.get(dom) === view) drop(key)
}

/** An embedded file in the text, drawn by the renderer registered for its type. */
export class EmbedWidget extends WidgetType {
  constructor(
    private renderer: EmbedRenderer,
    private ctx: EmbedContext,
  ) {
    super()
  }

  eq(other: EmbedWidget): boolean {
    const a = this.ctx
    const b = other.ctx
    return (
      other.renderer === this.renderer &&
      a.path === b.path &&
      a.subpath === b.subpath &&
      a.alias === b.alias &&
      a.sourcePath === b.sourcePath
    )
  }

  private get key(): string {
    let id = rendererIds.get(this.renderer)
    if (id === undefined) rendererIds.set(this.renderer, (id = ++lastRendererId))
    const { path, subpath, alias, sourcePath } = this.ctx
    return [id, path, subpath, alias, sourcePath].join('\n')
  }

  toDOM(view: EditorView): HTMLElement {
    const old = kept.get(this.key)
    if (old && !old.isConnected && owners.get(old) === view) {
      kept.delete(this.key)
      return old
    }
    const el = document.createElement('div')
    owners.set(el, view)
    el.className = 'lp-embed'
    let off: Off | void
    try {
      off = this.renderer(el, this.ctx)
    } catch (err) {
      console.error(err)
      el.textContent = `Не удалось показать «${this.ctx.path}»: ${errorMessage(err)}`
    }
    // Embeds fill in after the editor has laid the line out (files load, pages render).
    const resized = new ResizeObserver(() => view.requestMeasure())
    resized.observe(el)
    cleanups.set(el, () => {
      resized.disconnect()
      off?.()
    })
    return el
  }

  destroy(dom: HTMLElement): void {
    const key = this.key
    if (kept.get(key) !== dom) drop(key)
    kept.set(key, dom)
    for (const oldest of kept.keys()) if (kept.size > KEPT) drop(oldest)
  }
}
