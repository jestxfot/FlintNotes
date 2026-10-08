import { tags as t } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

const BANG = 33
const OPEN = 91
const CLOSE = 93
const NEWLINE = 10

/** `[[target#heading|alias]]` and the embed form `![[target]]`. */
export const wikilinkSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'Wikilink', style: t.link },
    { name: 'WikiEmbed', style: t.link },
    { name: 'WikilinkMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Wikilink',
      // Ahead of the standard link and image parsers, which also start at `[` and `![`.
      before: 'Link',
      parse(cx, next, pos) {
        const embed = next === BANG
        const open = pos + (embed ? 1 : 0)
        if (cx.char(open) !== OPEN || cx.char(open + 1) !== OPEN) return -1
        const inner = open + 2
        for (let i = inner; i < cx.end - 1; i++) {
          const char = cx.char(i)
          if (char === NEWLINE || char === OPEN) return -1
          if (char !== CLOSE) continue
          if (i === inner || cx.char(i + 1) !== CLOSE) return -1
          const marks = [cx.elt('WikilinkMark', pos, inner), cx.elt('WikilinkMark', i, i + 2)]
          return cx.addElement(cx.elt(embed ? 'WikiEmbed' : 'Wikilink', pos, i + 2, marks))
        }
        return -1
      },
    },
  ],
}
