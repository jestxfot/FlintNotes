import type { CompletionSource } from '@codemirror/autocomplete'
import { filePath, path, type App } from '../../api'

/** Suggests the vault's files after `[[`. */
export const wikilinkCompletion =
  (app: App): CompletionSource =>
  (context) => {
    const match = context.matchBefore(/!?\[\[[^\[\]|#\n]*$/)
    if (!match) return null
    const source = context.state.facet(filePath)
    const closed = context.state.sliceDoc(context.pos, context.pos + 2) === ']]'
    return {
      from: match.from + match.text.indexOf('[[') + 2,
      validFor: /^[^\[\]|#\n]*$/,
      options: app.vault.files().map((file) => {
        const text = app.metadata.linkText(file.path, source)
        return {
          label: text,
          detail: path.dirname(file.path) || undefined,
          apply: closed ? text : `${text}]]`,
          // Notes before attachments.
          boost: path.extname(file.path) === 'md' ? 1 : 0,
        }
      }),
    }
  }
