import type { Range } from '@codemirror/state'
import type { Decoration as Deco, DecorationSet, EditorView, ViewUpdate } from '@codemirror/view'
import { cm, filePath, type App } from '../../api'
import type { Registry } from './registry'

/** Sent to the editors when what objects there are changed: their links are coloured again. */
export const objectsChanged = cm.state.StateEffect.define<null>()

/**
 * A link to an object is drawn in its type's colour, as Tana and Anytype draw a node with its tag: the person in
 * pink, the topic in blue. The icon in front of it comes from the core (the object's look is its type's); this
 * only colours the text the link shows.
 */
export function objectLinkColors(app: App, registry: Registry) {
  const { Decoration, ViewPlugin } = cm.view
  const build = (view: EditorView): DecorationSet => {
    const source = view.state.facet(filePath)
    const marks: Range<Deco>[] = []
    const tree = cm.language.syntaxTree(view.state)
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from,
        to,
        enter: (node) => {
          if (node.name !== 'Wikilink') return
          const inner = view.state.sliceDoc(node.from + 2, node.to - 2)
          const pipe = inner.indexOf('|')
          const target = (pipe < 0 ? inner : inner.slice(0, pipe)).split('#')[0]
          const dest = app.metadata.resolve(target, source)
          const type = dest ? (registry.typeOf(dest) ?? registry.typeAt(dest)) : undefined
          if (!type?.color) return false
          marks.push(
            Decoration.mark({
              class: 'obj-link',
              attributes: { style: `--obj-color: ${app.icons.css(type.color)}`, 'data-object-type': type.name },
            }).range(node.from, node.to),
          )
          return false
        },
      })
    }
    return Decoration.set(marks, true)
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(update: ViewUpdate) {
        const told = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(objectsChanged)))
        if (update.docChanged || update.viewportChanged || told) this.decorations = build(update.view)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}
