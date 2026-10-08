import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, type Extension } from '@codemirror/state'
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

/**
 * The Markdown language of the editor: GitHub flavour, frontmatter, and
 * whatever syntax plugins add (wikilinks, tags). Adding syntax re-parses the
 * open editors.
 */
export class MarkdownSyntax {
  private configs: MarkdownConfig[] = [frontmatter]
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
    return markdown({ base: markdownLanguage, extensions: [...this.configs], completeHTMLTags: false })
  }

  private apply(): void {
    this.editors.each((editor) => editor.dispatch({ effects: this.compartment.reconfigure(this.language()) }))
  }
}
