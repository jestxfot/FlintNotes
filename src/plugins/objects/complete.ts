import type { Completion, CompletionSource } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { cm, errorMessage, filePath, path, type App } from '../../api'
import { atQuery, bestScore, fileName, fold } from './model'
import type { Registry } from './registry'
import type { TypeDef } from './model'

export interface CompletionHooks {
  /** Opens the «new type» dialog with a name; resolves with the type made, or `null`. */
  newType(name: string): Promise<TypeDef | null>
  /** Asks which type a new object is of. */
  pickType(name: string): Promise<TypeDef | null>
}

/** The list's rows get classes of their own: the keys are explained under it, «create» rows stand out. */
const marked = (options: Completion[]) => options.map((option) => ({ ...option, class: option.type === 'object-new' ? 'obj-option obj-new' : 'obj-option' }))

/** How many objects are offered at once; typing narrows them down. */
const SHOWN = 60

/**
 * `@` in a note links objects: `@` offers the types, `@person/` the people, and Enter puts in a link to the one
 * chosen — or makes it first, when no such object exists. What lands in the note is an ordinary `[[link]]`, so the
 * note reads the same in Obsidian.
 */
export const objectCompletion =
  (app: App, registry: Registry, hooks: CompletionHooks): CompletionSource =>
  (context) => {
    const line = context.state.doc.lineAt(context.pos)
    const before = context.state.sliceDoc(line.from, context.pos)
    const query = atQuery(before)
    if (!query) return null
    const source = context.state.facet(filePath)
    const atPos = line.from + query.at

    /** Replaces `@…` up to the cursor with a link to the note, and a space after it unless one follows. */
    const insertLink = (view: EditorView, note: string) => {
      const head = view.state.selection.main.head
      const name = path.stripExt(path.basename(note))
      const text = app.metadata.linkText(note, source)
      const link = text === name ? `[[${text}]]` : `[[${text}|${name}]]`
      const next = view.state.sliceDoc(head, head + 1)
      const insert = link + (next === ' ' ? '' : ' ')
      view.dispatch({ changes: { from: atPos, to: head, insert }, selection: { anchor: atPos + link.length + 1 }, userEvent: 'input.complete' })
    }
    const make = async (view: EditorView, type: TypeDef, name: string) => {
      try {
        insertLink(view, await registry.createObject(type, name))
      } catch (err) {
        app.notice(`Не удалось создать «${name}»: ${errorMessage(err)}`)
      }
    }
    /** Puts `@Type/` in and opens the list of its objects. */
    const enterType = (view: EditorView, type: TypeDef) => {
      const head = view.state.selection.main.head
      const insert = `@${type.name}/`
      view.dispatch({ changes: { from: atPos, to: head, insert }, selection: { anchor: atPos + insert.length }, userEvent: 'input.complete' })
      setTimeout(() => cm.autocomplete.startCompletion(view))
    }
    const objectOption = (note: string, boost: number, detail?: string): Completion => ({
      label: path.stripExt(path.basename(note)),
      detail,
      type: 'object',
      // The core's list draws the icon of the file a suggestion names: the object's type's icon.
      path: note,
      boost,
      apply: (view) => insertLink(view, note),
    } as Completion)

    if (query.object === null) {
      const typed = query.type
      const types = registry.matching(typed)
      // `@` before a word that is no type nor object is just text: nothing is offered for `@ the` or `@2026-11-20`.
      if (/\s/.test(typed) && !types.length) return null
      const options: Completion[] = types.map((type, i) => ({
        label: type.name,
        detail: type.aliases[0] && fold(type.aliases[0]) !== fold(type.name) ? type.aliases[0] : 'тип',
        type: 'object-type',
        ...(type.path ? { path: type.path } : { icon: type.icon, color: type.color }),
        boost: 100 - i,
        apply: (view: EditorView) => enterType(view, type),
      }))
      if (typed.trim()) {
        const found = registry
          .allObjects()
          .map((note) => ({ note, score: bestScore([path.stripExt(path.basename(note))], typed) }))
          .filter((one) => one.score >= 1)
          .sort((a, b) => b.score - a.score)
          .slice(0, SHOWN)
        for (const { note } of found) options.push(objectOption(note, 0, registry.typeOf(note)?.name))
        const name = fileName(typed)
        if (!registry.find(name))
          options.push({
            label: `Новый тип «${name}»…`,
            detail: 'тип',
            type: 'object-new',
            icon: 'shapes',
            boost: -50,
            apply: (view: EditorView) =>
              void hooks.newType(name).then((type) => {
                if (type) enterType(view, type)
              }),
          } as Completion)
        options.push({
          label: `Новый «${name}» как…`,
          type: 'object-new',
          icon: 'plus',
          boost: -60,
          apply: (view: EditorView) =>
            void hooks.pickType(name).then((type) => {
              if (type) void make(view, type, name)
            }),
        } as Completion)
      }
      // Every option is kept whatever its label: the list is already the one for the typed text.
      return { from: atPos + 1, options: marked(options), filter: false }
    }

    const type = registry.find(query.type)
    if (!type) return null
    const typed = query.object
    const all = registry.objects(type)
    const recent = new Map(app.positions.recent().map((note, i) => [note, i]))
    const shown = typed.trim()
      ? all
          .map((note) => ({ note, score: bestScore([path.stripExt(path.basename(note)), ...(app.metadata.get(note)?.aliases ?? [])], typed) }))
          .filter((one) => one.score >= 0)
          .sort((a, b) => b.score - a.score || (recent.get(a.note) ?? Infinity) - (recent.get(b.note) ?? Infinity))
          .map((one) => one.note)
      : // Before anything is typed, the ones opened lately come first.
        [...all].sort((a, b) => (recent.get(a) ?? Infinity) - (recent.get(b) ?? Infinity))
    const options: Completion[] = shown.slice(0, SHOWN).map((note, i) => objectOption(note, SHOWN - i))
    const name = fileName(typed)
    if (name && !registry.existing(type, name))
      options.push({
        label: `Создать «${name}»`,
        detail: type.name,
        type: 'object-new',
        icon: 'plus',
        boost: -100,
        apply: (view: EditorView) => void make(view, type, name),
      } as Completion)
    if (!options.length) return null
    return { from: atPos + 1 + query.type.length + 1, options: marked(options), filter: false }
  }
