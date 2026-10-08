import { Compartment, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Off } from '../events'

/**
 * Editor extensions contributed by plugins. They live in one compartment, so
 * adding or removing one reconfigures every open editor without recreating it.
 */
export class EditorExtensions {
  private compartment = new Compartment()
  private list: Extension[] = []
  private editors = new Set<EditorView>()

  /** Include this in the state of every editor that plugins should be able to extend. */
  get extension(): Extension {
    return this.compartment.of([...this.list])
  }

  attach(editor: EditorView): void {
    this.editors.add(editor)
  }

  detach(editor: EditorView): void {
    this.editors.delete(editor)
  }

  add(extension: Extension): Off {
    this.list.push(extension)
    this.apply()
    return () => {
      this.list.splice(this.list.indexOf(extension), 1)
      this.apply()
    }
  }

  /** Runs `fn` for every open editor. */
  each(fn: (editor: EditorView) => void): void {
    this.editors.forEach(fn)
  }

  private apply(): void {
    this.each((editor) => editor.dispatch({ effects: this.compartment.reconfigure([...this.list]) }))
  }
}
