import { Facet } from '@codemirror/state'

/** Vault path of the file an editor shows. Read it with `state.facet(filePath)`. */
export const filePath = Facet.define<string, string>({ combine: (values) => values[0] ?? '' })
