import { path as paths, type Look, type LookKind } from '../../api'

interface Condition {
  source: string
  operator: string
  value: string
}

interface Rule extends Look {
  id: string
  name: string
  match: 'all' | 'any' | 'none'
  conditions: Condition[]
  enabled: boolean
}

/** The contents of Iconic's `data.json`. Fields this plugin does not use are kept as they are. */
export interface IconicData extends Record<string, unknown> {
  showAllFileIcons?: boolean
  showAllFolderIcons?: boolean
  /** Files and folders by vault path. */
  fileIcons?: Record<string, Look>
  /** Tags by name, without `#`. */
  tagIcons?: Record<string, Look>
  propertyIcons?: Record<string, Look>
  fileRules?: Rule[]
  folderRules?: Rule[]
}

const SECTION: Record<LookKind, 'fileIcons' | 'tagIcons' | 'propertyIcons'> = { file: 'fileIcons', folder: 'fileIcons', tag: 'tagIcons', property: 'propertyIcons' }

/** The look an item was given by hand. */
export function ownLook(data: IconicData, kind: LookKind, id: string): Look | undefined {
  const section = data[SECTION[kind]]
  return section && Object.hasOwn(section, id) ? section[id] : undefined
}

/** Gives an item an icon and a colour, or takes them away; other fields Iconic keeps with the item stay. */
export function setLook(data: IconicData, kind: LookKind, id: string, look: Look): void {
  const section = (data[SECTION[kind]] ??= {})
  const next: Record<string, unknown> = { ...(Object.hasOwn(section, id) ? section[id] : {}) }
  delete next.icon
  delete next.color
  if (look.icon) next.icon = look.icon
  if (look.color) next.color = look.color
  if (look.icon || look.color) section[id] = next
  else delete section[id]
}

/** Files and folders keep their looks when they are renamed or moved. */
export function renameLooks(data: IconicData, from: string, to: string): boolean {
  let changed = false
  for (const key of Object.keys(data.fileIcons ?? {})) {
    if (key !== from && !key.startsWith(`${from}/`)) continue
    data.fileIcons![to + key.slice(from.length)] = data.fileIcons![key]
    delete data.fileIcons![key]
    changed = true
  }
  return changed
}

function test(condition: Condition, kind: 'file' | 'folder', path: string): boolean {
  const name = paths.basename(path)
  const parent = paths.dirname(path)
  const values: Record<string, string> = {
    name: kind === 'file' ? paths.stripExt(name) : name,
    filename: name,
    extension: paths.extname(path),
    path,
    tree: parent,
  }
  if (!Object.hasOwn(values, condition.source)) return false
  const negated = condition.operator.startsWith('!')
  const operator = negated ? condition.operator.slice(1) : condition.operator
  const actual = values[condition.source].toLowerCase()
  const wanted = String(condition.value ?? '').toLowerCase()
  let result = false
  if (operator === 'is') {
    // "In the tree of a folder" holds for everything below it, however deep.
    result = condition.source === 'tree' ? actual === wanted || actual.startsWith(`${wanted}/`) : actual === wanted
  } else if (operator === 'contains') result = wanted !== '' && actual.includes(wanted)
  else if (operator === 'startsWith') result = wanted !== '' && actual.startsWith(wanted)
  else if (operator === 'endsWith') result = wanted !== '' && actual.endsWith(wanted)
  else if (operator === 'matches') {
    try {
      const literal = /^\/(.*)\/([a-z]*)$/.exec(condition.value)
      result = (literal ? new RegExp(literal[1], literal[2]) : new RegExp(condition.value)).test(values[condition.source])
    } catch {
      result = false
    }
  }
  return negated ? !result : result
}

/** The look the first matching rule gives to a file or folder. */
export function ruleLook(data: IconicData, kind: 'file' | 'folder', path: string): Look | undefined {
  for (const rule of (kind === 'file' ? data.fileRules : data.folderRules) ?? []) {
    if (!rule.enabled || !rule.conditions?.length || !(rule.icon || rule.color)) continue
    const hits = rule.conditions.map((condition) => test(condition, kind, path))
    const matches = rule.match === 'all' ? hits.every(Boolean) : rule.match === 'none' ? !hits.some(Boolean) : hits.some(Boolean)
    if (matches) return { icon: rule.icon, color: rule.color }
  }
}
