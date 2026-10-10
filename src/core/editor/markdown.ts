import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { Compartment, type Extension } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'
import type { Off } from '../events'
import type { EditorExtensions } from './extensions'

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

const EQUALS = 61

/** `==highlighted text==`, as in Obsidian. The text may not start or end with a space. */
const highlight: MarkdownConfig = {
  defineNodes: [{ name: 'Highlight' }, { name: 'HighlightMark', style: t.processingInstruction }],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS) return -1
        const rest = cx.slice(pos + 2, cx.end)
        const length = rest.indexOf('==')
        const inner = rest.slice(0, length)
        if (length <= 0 || inner.includes('\n') || inner !== inner.trim()) return -1
        const close = pos + 2 + length
        const marks = [cx.elt('HighlightMark', pos, pos + 2), cx.elt('HighlightMark', close, close + 2)]
        return cx.addElement(cx.elt('Highlight', pos, close + 2, marks))
      },
    },
  ],
}

/**
 * The Markdown language of the editor: GitHub flavour, frontmatter, and
 * whatever syntax plugins add (wikilinks, tags). Adding syntax re-parses the
 * open editors.
 */
export class MarkdownSyntax {
  private configs: MarkdownConfig[] = [frontmatter, highlight]
  private compartment = new Compartment()

  constructor(private editors: EditorExtensions) {}

  /** Include this in the state of every Markdown editor. */
  get extension(): Extension {
    return this.compartment.of(this.language())
  }

  add(config: MarkdownConfig): Off {
    this.configs.push(config)
    this.apply()
    return () => {
      this.configs.splice(this.configs.indexOf(config), 1)
      this.apply()
    }
  }

  private language(): Extension {
    return markdown({
      base: markdownLanguage,
      // `:name:` is an emoji in GitHub's Markdown, not in Obsidian's: there `17:44:36` is plain text,
      // so that reading of colons is taken out (it painted the minutes of every time of day).
      extensions: [{ remove: ['Emoji'] }, ...this.configs],
      // Code in ```js, ```python, ... is highlighted; each language's parser is fetched when first used.
      codeLanguages: languages,
      completeHTMLTags: false,
    })
  }

  private apply(): void {
    this.editors.each((editor) => editor.dispatch({ effects: this.compartment.reconfigure(this.language()) }))
  }
}
