import { WidgetType, type EditorView } from '@codemirror/view'
import type { EmbedContext, EmbedRenderer } from '../../embeds'
import type { Off } from '../../events'
import { errorMessage } from '../../notice'

const cleanups = new WeakMap<HTMLElement, Off>()

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

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
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
    cleanups.get(dom)?.()
  }
}
