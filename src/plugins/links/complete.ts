import type { CompletionSource } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { filePath, path, type App } from '../../api'

/**
 * Suggests what a wikilink can point to: after `[[` the vault's files and
 * their aliases, after `[[Note#` the headings of that note.
 */
export const wikilinkCompletion =
  (app: App): CompletionSource =>
  (context) => {
    const source = context.state.facet(filePath)
    const closed = context.state.sliceDoc(context.pos, context.pos + 2) === ']]'
    /**
     * Puts the chosen text in and leaves the cursor after the link's closing brackets,
     * whether they were there already (brackets close themselves) or are added now.
     */
    const finish = (text: string) => (view: EditorView, _completion: unknown, from: number, to: number) => {
      const insert = closed ? text : `${text}]]`
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + text.length + 2 }, userEvent: 'input.complete' })
    }

    const heading = context.matchBefore(/!?\[\[[^\[\]|#\n]*#[^\[\]|\n]*$/)
    if (heading) {
      const inner = heading.text.slice(heading.text.indexOf('[[') + 2)
      const note = inner.slice(0, inner.indexOf('#'))
      // `[[#Heading]]` is a heading of this very note.
      const target = note ? app.metadata.resolve(note, source) : source
      const headings = target ? (app.metadata.get(target)?.headings ?? []) : []
      return {
        from: heading.from + heading.text.indexOf('#') + 1,
        validFor: /^[^\[\]|\n]*$/,
        options: headings.map((h, i) => ({ label: h.text, detail: `${'#'.repeat(h.level)} заголовок`, apply: finish(h.text), type: 'heading', boost: -i })),
      }
    }

    const match = context.matchBefore(/!?\[\[[^\[\]|#\n]*$/)
    if (!match) return null
    return {
      from: match.from + match.text.indexOf('[[') + 2,
      validFor: /^[^\[\]|#\n]*$/,
      options: app.vault.files().flatMap((file) => {
        const text = app.metadata.linkText(file.path, source)
        const folder = path.dirname(file.path)
        const note = {
          label: path.extname(file.path) === 'md' ? path.stripExt(path.basename(file.path)) : path.basename(file.path),
          // The folder under the name tells notes of the same name apart.
          detail: folder ? `${folder}/` : undefined,
          apply: finish(text),
          type: 'note',
          // The core's list shows the icon of the file a suggestion names.
          path: file.path,
          // Notes before attachments.
          boost: path.extname(file.path) === 'md' ? 1 : 0,
        }
        // An alias links to its note and shows as the alias: [[Note|alias]].
        const aliases = (app.metadata.get(file.path)?.aliases ?? []).map((alias) => ({
          label: alias,
          detail: file.path.replace(/\.md$/, ''),
          apply: finish(`${text}|${alias}`),
          type: 'alias',
          path: file.path,
          boost: 0,
        }))
        return [note, ...aliases]
      }),
    }
  }
