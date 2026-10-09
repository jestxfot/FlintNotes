import { isSeq, parseDocument, type Document } from 'yaml'
import type { App } from './app'
import { isoDate, Link } from './expr'

const BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

function toYaml(value: unknown): unknown {
  if (value instanceof Date) return isoDate(value)
  if (value instanceof Link) return `[[${value.target}${value.display ? `|${value.display}` : ''}]]`
  if (Array.isArray(value)) return value.map(toYaml)
  return value
}

/**
 * Sets one key of a YAML document. A list written on one line (`[a, b]`) stays
 * on one line; without this the library would rewrite it as a bulleted list.
 */
export function setYamlValue(doc: Document, key: string, value: unknown): void {
  const node = doc.createNode(toYaml(value))
  const previous = doc.get(key, true)
  if (isSeq(node) && isSeq(previous) && previous.flow) node.flow = true
  doc.set(key, node)
}

/**
 * Sets properties in a note's frontmatter and saves the note. A value of
 * `undefined` removes the property. Other properties, their order and comments
 * are left as they are; a note without frontmatter gets one.
 */
export async function setProperties(app: App, path: string, changes: Record<string, unknown>): Promise<void> {
  // Unsaved edits of an open note must reach the disk before it is rewritten there.
  await app.workspace.flushAll()
  const text = await app.vault.read(path)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const match = BLOCK.exec(text)
  const doc = parseDocument(match?.[1] ?? '')
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) doc.delete(key)
    else setYamlValue(doc, key, value)
  }
  const body = match ? text.slice(match[0].length) : text
  // Without this the library pads untouched lists: `[a, b]` would become `[ a, b ]`.
  const written = doc.toString({ flowCollectionPadding: false })
  const yaml = doc.contents && written.trim() !== '{}' ? written : ''
  const block = yaml ? `---\n${yaml.endsWith('\n') ? yaml : `${yaml}\n`}---\n`.replace(/\n/g, eol) : ''
  await app.vault.write(path, block + body)
}
