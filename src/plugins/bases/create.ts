import { stringify } from 'yaml'
import { errorMessage, expr, parseMarkdown, setProperties, type App } from '../../api'
import type { FilterNode } from './model'

/** What the Templates plugin lends to bases. */
interface Templates {
  list(): string[]
  render(template: string, target: string): Promise<{ text: string; target: string; done(): Promise<void> }>
  folderOf(template: string): string | null
}

export const templatesOf = (app: App) => app.services.get<Templates>('templates') ?? null

/**
 * The template each base makes its new records from. It is kept in FlintNotes' own settings, not in the
 * base's YAML: Obsidian reads that YAML too and knows no such key. A `.base` file goes by its path; a base
 * written in a note, by the note and the name of its first view.
 */
const KEY = 'recordTemplates'
export const recordTemplates = (app: App): Record<string, string> => ({ ...(app.settings.get<Record<string, string> | undefined>('bases', KEY) ?? {}) })
export const recordTemplate = (app: App, base: string): string | null => recordTemplates(app)[base] ?? null
export function setRecordTemplate(app: App, base: string, template: string | null): void {
  const all = recordTemplates(app)
  if (template) all[base] = template
  else delete all[base]
  app.settings.set('bases', KEY, all)
}

interface Defaults {
  folder: string
  tags: string[]
  props: Record<string, unknown>
}

/** The conditions that must all hold: a filter's own expression or the parts of its `and`. */
function required(filter: FilterNode | undefined): string[] {
  if (typeof filter === 'string') return [filter]
  return filter && typeof filter === 'object' ? (filter.and ?? []).flatMap(required) : []
}

const literal = (node: expr.Node | undefined) => (node?.type === 'literal' ? node.value : undefined)

/** Reads from one condition what a new note needs in order to satisfy it. */
function learn(node: expr.Node, into: Defaults): void {
  if (node.type === 'binary' && node.op === '&&') {
    learn(node.left, into)
    learn(node.right, into)
  } else if (node.type === 'call' && node.callee.type === 'member') {
    const { object, property } = node.callee
    const value = literal(node.args[0])
    if (object.type !== 'ident' || object.name !== 'file' || typeof value !== 'string') return
    if (property === 'inFolder') into.folder = value.replace(/^\/|\/$/g, '')
    else if (property === 'hasTag') into.tags.push(value.replace(/^#/, ''))
  } else if (node.type === 'binary' && node.op === '==') {
    const { left } = node
    const name =
      left.type === 'ident' && !['file', 'formula', 'this'].includes(left.name)
        ? left.name
        : left.type === 'member' && left.object.type === 'ident' && left.object.name === 'note'
          ? left.property
          : null
    const value = literal(node.right)
    if (name && value !== undefined && value !== null) into.props[name] = value
  }
}

/**
 * Creates a note that will appear in the base: in the folder, with the tags
 * and property values that the base's filters ask for. Conditions it cannot
 * read (`or`, comparisons, formulas) are left to the user.
 */
export async function createRecord(app: App, filters: (FilterNode | undefined)[], extra: Record<string, unknown> = {}, template: string | null = null): Promise<void> {
  const defaults: Defaults = { folder: '', tags: [], props: {} }
  for (const source of filters.flatMap(required)) {
    try {
      learn(expr.parse(source), defaults)
    } catch {
      // A condition that does not parse is reported by the base itself.
    }
  }
  const data: Record<string, unknown> = { ...defaults.props, ...extra }
  if (defaults.tags.length) data.tags = defaults.tags
  const templates = template ? templatesOf(app) : null
  if (template && !templates) app.notice('Шаблон базы не применён: плагин «Шаблоны» выключен')
  try {
    // The folder the base's filters ask for is the base's word; then the template's own folder; a plugin may still choose where new notes go.
    const folder = defaults.folder || (templates && template ? (templates.folderOf(template) ?? '') : '')
    const path = await app.creation.place({ origin: 'base', name: 'Без названия', folder, explicit: !!folder })
    if (!path) return
    if (templates && template) {
      // The note is the template's; what the base's filters ask for is written over its properties, its tags added to the template's.
      const made = await templates.render(template, path)
      const entry = await app.vault.create(made.target, made.text)
      const own = parseMarkdown(made.text).frontmatter?.tags
      const tags = [...new Set([...(Array.isArray(own) ? own.map(String) : typeof own === 'string' ? own.split(/[,\s]+/).filter(Boolean) : []), ...defaults.tags])]
      const wanted = { ...defaults.props, ...extra, ...(defaults.tags.length ? { tags } : {}) }
      if (Object.keys(wanted).length) await setProperties(app, entry.path, wanted)
      app.workspace.openFile(entry.path)
      await made.done()
      return
    }
    const text = Object.keys(data).length ? `---\n${stringify(data)}---\n\n` : ''
    const entry = await app.vault.create(path, text)
    app.workspace.openFile(entry.path)
  } catch (err) {
    app.notice(`Не удалось создать запись: ${errorMessage(err)}`)
  }
}
