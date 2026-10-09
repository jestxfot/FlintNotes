import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

/** Marks of Markdown that go around text: typing one with text selected wraps the selection in it. */
const WRAPS = new Set(['*', '_', '=', '~'])

/**
 * Typing as in Obsidian: an opening bracket or quote brings its closing one
 * (`[` gives `[]`, a second `[` gives `[[]]`), typing the closing one steps over
 * it, Backspace between the two removes both; and with text selected, a
 * bracket, quote or Markdown mark (`*`, `_`, `=`, `~`) is put around it.
 */
export const autoPairs: Extension = [
  closeBrackets(),
  EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', '"', "'", '`'] } }]),
  Prec.high(keymap.of(closeBracketsKeymap)),
  EditorView.inputHandler.of((view, _from, _to, text) => {
    if (!WRAPS.has(text) || view.state.selection.ranges.every((range) => range.empty)) return false
    view.dispatch(
      view.state.changeByRange((range) =>
        range.empty
          ? { range, changes: [] }
          : {
              changes: [
                { from: range.from, insert: text },
                { from: range.to, insert: text },
              ],
              range: EditorSelection.range(range.anchor + 1, range.head + 1),
            },
      ),
      { userEvent: 'input.type', scrollIntoView: true },
    )
    return true
  }),
]
