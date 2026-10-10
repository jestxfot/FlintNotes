import { path as paths, type Look, type LookKind } from '../../api'

export interface Condition {
  source: string
  operator: string
  value: string
}

export interface Rule extends Look {
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

/** What a rule may ask about a note besides its name and place: its tags (without `#`) and the links it has. */
export interface NoteFacts {
  tags: string[]
  links: string[]
}

/** A condition on a list (tags, links), with the operators Iconic has for lists. */
function testList(condition: Condition, items: string[]): boolean {
  const negated = condition.operator.startsWith('!')
  const operator = negated ? condition.operator.slice(1) : condition.operator
  const list = items.map((item) => item.toLowerCase())
  const wanted = String(condition.value ?? '').toLowerCase()
  const regex = () => {
    const literal = /^\/(.*)\/([a-z]*)$/.exec(condition.value)
    return literal ? new RegExp(literal[1], literal[2]) : new RegExp(condition.value)
  }
  const each = (how: string): ((item: string) => boolean) =>
    how === 'Are' ? (item) => item === wanted : how.startsWith('Contain') ? (item) => item.includes(wanted) : how.startsWith('StartWith') ? (item) => item.startsWith(wanted) : how.startsWith('EndWith') ? (item) => item.endsWith(wanted) : (item) => regex().test(item)
  let result = false
  try {
    if (operator === 'includes') result = list.includes(wanted)
    else if (operator.startsWith('all')) result = list.length > 0 && list.every(each(operator.slice(3)))
    else if (operator.startsWith('any')) result = list.some(each(operator.slice(3)))
    else if (operator.startsWith('none')) result = !list.some(each(operator.slice(4)))
    else if (operator === 'countIs') result = wanted !== '' && list.length === Number(wanted)
    else if (operator === 'countIsLess') result = wanted !== '' && list.length < Number(wanted)
    else if (operator === 'countIsMore') result = wanted !== '' && list.length > Number(wanted)
  } catch {
    result = false
  }
  return negated ? !result : result
}

/** Expressions of conditions, made once: rules are asked about every file that is drawn. */
const compiled = new Map<string, RegExp | null>()
function expression(value: string): RegExp | null {
  let regex = compiled.get(value)
  if (regex === undefined) {
    try {
      const literal = /^\/(.*)\/([a-z]*)$/.exec(value)
      regex = literal ? new RegExp(literal[1], literal[2].replace(/[gy]/g, '')) : new RegExp(value)
    } catch {
      regex = null
    }
    compiled.set(value, regex)
  }
  return regex
}

function test(condition: Condition, kind: 'file' | 'folder', path: string, facts?: (path: string) => NoteFacts | undefined): boolean {
  if (condition.source === 'tags' || condition.source === 'links') {
    const known = kind === 'file' ? facts?.(path) : undefined
    return known ? testList(condition, condition.source === 'tags' ? known.tags : known.links) : false
  }
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
    result = expression(condition.value)?.test(values[condition.source]) ?? false
  }
  return negated ? !result : result
}

/** The look the first matching rule gives to a file or folder. */
export function ruleLook(data: IconicData, kind: 'file' | 'folder', path: string, facts?: (path: string) => NoteFacts | undefined): Look | undefined {
  for (const rule of (kind === 'file' ? data.fileRules : data.folderRules) ?? []) {
    if (!rule.enabled || !rule.conditions?.length || !(rule.icon || rule.color)) continue
    const hits = rule.conditions.map((condition) => test(condition, kind, path, facts))
    const matches = rule.match === 'all' ? hits.every(Boolean) : rule.match === 'none' ? !hits.some(Boolean) : hits.some(Boolean)
    if (matches) return { icon: rule.icon, color: rule.color }
  }
}
