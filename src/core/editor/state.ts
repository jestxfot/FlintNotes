import { Facet } from '@codemirror/state'

/** Vault path of the file an editor shows. Read it with `state.facet(filePath)`. */
export const filePath = Facet.define<string, string>({ combine: (values) => values[0] ?? '' })

/**
 * Set in read-only previews (embedded notes). There is no cursor to reveal
 * source for, so Live Preview draws every element rendered.
 */
export const staticPreview = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) })

/** How many embeds deep this editor sits; guards against notes embedding each other forever. */
export const embedDepth = Facet.define<number, number>({ combine: (values) => values[0] ?? 0 })
