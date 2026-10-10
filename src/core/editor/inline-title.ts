import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { App } from '../app'
import { errorMessage } from '../notice'
import { basename, dirname, extname, stripExt } from '../path'
import { filePath } from './state'

class TitleWidget extends WidgetType {
  constructor(
    private app: App,
    readonly path: string,
  ) {
    super()
  }

  eq(other: TitleWidget): boolean {
    return other.path === this.path
  }

  toDOM(view: EditorView): HTMLElement {
    const { app, path } = this
    const name = stripExt(basename(path))
    // A field of its own: text typed here is the note's name, not a part of the note.
    const el = document.createElement('input')
    el.className = 'inline-title'
    el.spellcheck = false
    el.value = name
    el.setAttribute('aria-label', 'Название заметки')
    // In a note that is being read the name is not to be changed either, by a click or from the keyboard.
    el.onfocus = () => (el.readOnly = view.state.readOnly)
    const rename = async () => {
      if (view.state.readOnly) return void (el.value = name)
      const next = el.value.replace(/[\\/:*?"<>|]/g, ' ').trim()
      if (!next || next === name) return void (el.value = name)
      const folder = dirname(path)
      try {
        await app.vault.rename(path, `${folder ? `${folder}/` : ''}${next}.${extname(path)}`)
      } catch (err) {
        el.value = name
        app.notice(`Не удалось переименовать: ${errorMessage(err)}`)
      }
    }
    el.onblur = () => void rename()
    el.onkeydown = (event) => {
      // Keys typed in the title belong to it, not to the editor around it.
      event.stopPropagation()
      if (event.key === 'Escape') el.value = name
      if (event.key !== 'Enter' && event.key !== 'Escape' && event.key !== 'ArrowDown') return
      // Enter confirms the name and goes on to the text, as in Obsidian.
      event.preventDefault()
      view.focus()
    }
    // The note's icon, if it has one and icons are shown in notes, stands before its name.
    const look = app.icons.inNotes ? app.icons.look('file', path) : undefined
    if (!look?.icon || look.icon === 'lucide-file') return el
    const row = document.createElement('div')
    row.className = 'inline-title-row'
    const icon = app.icons.clickable(app.icons.draw(look.icon, look.color), 'file', path)
    icon.classList.add('inline-title-icon')
    row.append(icon, el)
    return row
  }

  ignoreEvent(): boolean {
    return true
  }
}

/** The note's name as a large heading above its text; editing it renames the note. */
export function inlineTitle(app: App): Extension {
  const build = (state: EditorState): DecorationSet =>
    Decoration.set([Decoration.widget({ widget: new TitleWidget(app, state.facet(filePath)), side: -1, block: true }).range(0)])
  return StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => (tr.startState.facet(filePath) === tr.state.facet(filePath) ? value : build(tr.state)),
    provide: (field) => EditorView.decorations.from(field),
  })
}
