import { stringify } from 'yaml'
import { errorMessage, expr, type App } from '../../api'
import type { FilterNode } from './model'

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
export async function createRecord(app: App, filters: (FilterNode | undefined)[], extra: Record<string, unknown> = {}): Promise<void> {
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
  const text = Object.keys(data).length ? `---\n${stringify(data)}---\n\n` : ''
  try {
    const entry = await app.vault.create(app.vault.uniquePath(defaults.folder, 'Без названия', 'md'), text)
    app.workspace.openFile(entry.path)
  } catch (err) {
    app.notice(`Не удалось создать запись: ${errorMessage(err)}`)
  }
}
