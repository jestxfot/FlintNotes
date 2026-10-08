import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { MarkdownConfig } from '@lezer/markdown'

/**
 * YAML frontmatter: a block between `---` lines at the very top of a note.
 * Without this the parser reads it as a horizontal rule followed by a heading.
 * An unclosed block runs to the end of the note, as the closing line is being typed.
 */
const frontmatter: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true }],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false
        let end = line.text.length
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length
          if (/^(---|\.\.\.)\s*$/.test(line.text)) {
            cx.nextLine()
            break
          }
        }
        cx.addElement(cx.elt('Frontmatter', 0, end))
        return true
      },
    },
  ],
}

/** The Markdown language of the editor: GitHub flavour plus FlintNotes syntax. */
export const markdownLanguageSupport = () => markdown({ base: markdownLanguage, extensions: [frontmatter] })
