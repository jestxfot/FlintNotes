import { comments } from './comments'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { App } from '../app'
import { embedDepth, filePath, staticPreview } from './state'
import { editorLook } from './theme'

export interface Preview {
  /** Shows new text. */
  update(text: string): void
  destroy(): void
}

const external = Annotation.define<boolean>()

/**
 * Renders Markdown read-only inside `parent`, exactly as Live Preview draws it
 * and with every enabled plugin applied (wikilinks, tags, rendered blocks).
 * Used for embedded notes.
 *
 * The text cannot be typed into, but rendered controls still work: ticking a
 * checkbox or editing a rendered block changes the text, which is reported
 * through `onEdit`.
 */
export function createPreview(
  app: App,
  parent: HTMLElement,
  text: string,
  path: string,
  options: { depth?: number; onEdit?: (text: string) => void } = {},
): Preview {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        app.markdown.extension,
        editorLook,
        filePath.of(path),
        staticPreview.of(true),
        comments,
        embedDepth.of(options.depth ?? 0),
        app.livePreview.extension,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) {
            options.onEdit?.(update.state.doc.toString())
          }
        }),
      ],
    }),
  })
  // Attached so that syntax and renderers added later reach this view too.
  app.editor.attach(view)
  return {
    update(next) {
      if (next === view.state.doc.toString()) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        annotations: external.of(true),
      })
    },
    destroy() {
      app.editor.detach(view)
      view.destroy()
    },
  }
}
