import { tags as t } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

const HASH = 35

/** `#tag` and nested `#area/topic`. A tag needs a non-digit and may not continue a word. */
export const tagSyntax: MarkdownConfig = {
  defineNodes: [{ name: 'Hashtag', style: t.labelName }],
  parseInline: [
    {
      name: 'Hashtag',
      parse(cx, next, pos) {
        if (next !== HASH) return -1
        const before = pos > cx.offset ? cx.slice(pos - 1, pos) : ' '
        if (/[\p{L}\p{N}_/#&;]/u.test(before)) return -1
        const name = /^[\p{L}\p{N}_/-]+/u.exec(cx.slice(pos + 1, cx.end))?.[0]
        if (!name || /^\d+$/.test(name)) return -1
        return cx.addElement(cx.elt('Hashtag', pos, pos + 1 + name.length))
      },
    },
  ],
}
