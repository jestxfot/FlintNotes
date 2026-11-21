// What a type of object is and how its notes are written. Pure: no page, no vault, so it can be checked on its own.
//
// A type is itself a note (`Types/Person.md`), as in Anytype and in Tana's supertags: its frontmatter says what its
// objects look like, its body describes it and lists its objects in a `base` block that Obsidian draws too.
// An object is any note whose `type` property links to a type note. Nothing else is stored anywhere.

/** Where objects of a type belong: the user's own thinking, or things made by others (ICOR's two worlds). */
export type World = 'inner' | 'outer'

export interface TypeDef {
  /** The type's name, also the name of its note: `Человек`. */
  name: string
  /** Other names it is found by after `@`: `Person`. */
  aliases: string[]
  icon: string
  color: string
  world: World
  /** Vault folder its objects are made in. */
  folder: string
  /** Properties every object of the type has, in order. A field named after a type links to objects of that type. */
  fields: string[]
  /** Its objects can be connected to My Life: they get the `key element`, `project` and `topic` fields. */
  myLife: boolean
  /** One of the four parts of My Life (ICOR): Key Elements, Projects, Topics, Habits. */
  lifePart?: string
  /** The property under which other objects link to objects of this type: `project`. */
  key: string
  description: string
  /** The type's note; empty for a starter type not written to the vault yet. */
  path: string
}

/** The parts of My Life in the order ICOR draws them; each is a starter type below. */
export const LIFE_PARTS = ['key element', 'project', 'topic', 'habit'] as const
/** The fields an object connected to My Life gets: habits are not linked from things, they are done. */
export const LIFE_FIELDS = ['key element', 'project', 'topic']

const starter = (name: string, alias: string, icon: string, color: string, world: World, folder: string, extra: Partial<TypeDef> = {}): TypeDef => ({
  name,
  aliases: [alias],
  icon,
  color,
  world,
  folder,
  fields: [],
  myLife: true,
  key: alias.toLowerCase(),
  description: '',
  path: '',
  ...extra,
})

/**
 * The types a vault starts with: the four parts of My Life and the common objects of the two worlds. They are
 * offered after `@` before they exist; a type's note is written when its first object is made (or by a command).
 * `inner` and `outer` are the folders of the two worlds, from the settings.
 */
export function starterTypes(inner: string, outer: string): TypeDef[] {
  const life = join(inner, 'Моя жизнь')
  return [
    starter('Ключевой элемент', 'Key Element', 'key-round', 'yellow', 'inner', join(life, 'Ключевые элементы'), {
      lifePart: 'key element',
      myLife: false,
      description: 'Область жизни, за которую вы отвечаете всегда: здоровье, семья, работа, финансы.',
    }),
    starter('Проект', 'Project', 'folder-kanban', 'green', 'inner', join(life, 'Проекты'), {
      lifePart: 'project',
      fields: ['status', 'deadline'],
      description: 'Дело с результатом и сроком. Принадлежит ключевому элементу.',
    }),
    starter('Тема', 'Topic', 'hash', 'blue', 'inner', join(life, 'Темы'), {
      lifePart: 'topic',
      myLife: false,
      description: 'То, что вам интересно и о чём собираются мысли, без срока.',
    }),
    starter('Привычка', 'Habit', 'repeat', 'orange', 'inner', join(life, 'Привычки'), {
      lifePart: 'habit',
      fields: ['key element'],
      myLife: false,
      description: 'То, что вы делаете регулярно.',
    }),
    starter('Цель', 'Goal', 'target', 'red', 'inner', join(inner, 'Цели'), { fields: ['deadline'], description: 'Чего вы хотите добиться.' }),
    starter('Заметка', 'Note', 'file-text', 'gray', 'inner', join(inner, 'Заметки'), { description: 'Мысль, идея, вывод — ваше собственное.' }),
    starter('Человек', 'Person', 'user', 'pink', 'outer', join(outer, 'Люди'), { fields: ['company', 'birthday'], description: 'Человек, с которым вы связаны.' }),
    starter('Источник', 'Source', 'library', 'purple', 'outer', join(outer, 'Источники'), { fields: ['author', 'url'], description: 'Книга, статья, видео, курс.' }),
    starter('Компания', 'Company', 'building-2', 'cyan', 'outer', join(outer, 'Компании'), { fields: ['website'], description: 'Организация, команда, сообщество.' }),
  ]
}

const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/')

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)

/** A type as its note's frontmatter describes it. */
export function readType(path: string, frontmatter: Record<string, unknown> | null, body = ''): TypeDef {
  const fm = frontmatter ?? {}
  const name = path.split('/').pop()!.replace(/\.md$/, '')
  const aliases = strings(fm.aliases ?? fm.alias)
  const world: World = fm.world === 'outer' ? 'outer' : 'inner'
  const part = typeof fm['life part'] === 'string' ? fm['life part'].toLowerCase() : undefined
  return {
    name,
    aliases,
    icon: typeof fm.icon === 'string' && fm.icon ? fm.icon : 'box',
    color: typeof fm.color === 'string' ? fm.color : '',
    world,
    folder: typeof fm.folder === 'string' ? fm.folder.replace(/^\/+|\/+$/g, '') : name,
    fields: strings(fm.fields),
    myLife: fm['my life'] === true,
    lifePart: part && (LIFE_PARTS as readonly string[]).includes(part) ? part : undefined,
    key: typeof fm.key === 'string' && fm.key.trim() ? fm.key.trim().toLowerCase() : (aliases[0] ?? name).toLowerCase(),
    description: body.trim().split('\n\n')[0]?.startsWith('```') ? '' : (body.trim().split('\n\n')[0] ?? ''),
    path,
  }
}

const yamlString = (value: string) => (/^[\wЀ-ӿ][\wЀ-ӿ ./-]*$/u.test(value) && !/^(true|false|null|yes|no|~)$/i.test(value) ? value : JSON.stringify(value))
const yamlList = (items: string[]) => `[${items.map(yamlString).join(', ')}]`

/**
 * The text of a type's note. Its body lists its objects in a `base` block: the same block Obsidian's Bases draws,
 * so the type note is the type's home in both apps.
 */
export function typeNote(type: TypeDef): string {
  const lines = ['---']
  if (type.aliases.length) lines.push(`aliases: ${yamlList(type.aliases)}`)
  lines.push(`icon: ${yamlString(type.icon)}`)
  if (type.color) lines.push(`color: ${yamlString(type.color)}`)
  lines.push(`world: ${type.world}`)
  lines.push(`folder: ${yamlString(type.folder)}`)
  lines.push(`fields: ${yamlList(type.fields)}`)
  lines.push(`my life: ${type.myLife}`)
  if (type.lifePart) lines.push(`life part: ${type.lifePart}`)
  if (type.key !== (type.aliases[0] ?? type.name).toLowerCase()) lines.push(`key: ${yamlString(type.key)}`)
  lines.push('---', '')
  if (type.description) lines.push(type.description, '')
  const columns = ['file.name', ...type.fields.map((field) => propertyRef(field)), ...(type.myLife ? LIFE_FIELDS.filter((f) => !type.fields.includes(f)).map(propertyRef) : [])]
  lines.push(
    '```base',
    'filters:',
    '  and:',
    '    - file.hasLink(this.file)',
    // A note that only mentions the type in its text is not one of its objects; an object has a `type`.
    '    - file.hasProperty("type")',
    'views:',
    '  - type: table',
    `    name: ${yamlString(type.name)}`,
    '    order:',
    ...columns.map((column) => `      - ${column}`),
    '```',
    '',
  )
  return lines.join('\n')
}

/** How a base names a note's property: `note.status`, or `note["key element"]` for a name with spaces. */
const propertyRef = (name: string) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? `note.${name}` : `'note["${name}"]'`)

/** The fields of an object of the type, in order, without repeats: its own, then My Life's. */
export function objectFields(type: TypeDef): string[] {
  return [...new Set([...type.fields, ...(type.myLife ? LIFE_FIELDS : [])])].filter((field) => field !== 'type')
}

/** The text of a new object: `type` linking to its type, then the type's fields, empty. */
export function objectNote(typeLink: string, fields: string[], values: Record<string, string> = {}): string {
  const lines = ['---', `type: "${typeLink}"`]
  for (const field of fields) {
    const value = values[field]
    lines.push(value ? `${yamlKey(field)}: ${value.startsWith('[[') ? JSON.stringify(value) : yamlString(value)}` : `${yamlKey(field)}:`)
  }
  lines.push('---', '')
  return lines.join('\n')
}

const yamlKey = (key: string) => (/^[\p{L}_][\p{L}\p{N}_ -]*$/u.test(key) ? key : JSON.stringify(key))

/** A file name for an object or a type: what was typed, without the characters file systems refuse. */
export const fileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Lower case without `ё`: how typed text is compared with names. */
export const fold = (text: string) => text.toLocaleLowerCase().replace(/ё/g, 'е')

/** Whether a type is called `query`: by its name, one of its aliases, or the property that links to it. */
export const typeCalled = (type: TypeDef, query: string) => {
  const wanted = fold(query.trim())
  return [type.name, ...type.aliases, type.key].some((name) => fold(name) === wanted)
}

/** How well a name matches what is typed: 3 the same, 2 starts with it, 1 a word starts with it, 0 contains it, -1 not at all. */
export function score(name: string, query: string): number {
  const a = fold(name)
  const q = fold(query.trim())
  if (!q) return 0
  if (a === q) return 3
  if (a.startsWith(q)) return 2
  if (a.split(/[\s\-_/]+/).some((word) => word.startsWith(q))) return 1
  return a.includes(q) ? 0 : -1
}

/** The best match among several names of one thing (a type's name and aliases). */
export const bestScore = (names: string[], query: string) => Math.max(...names.map((name) => score(name, query)))

/** A folder name for a type: the type's name, which the user changes to a plural in the dialog. */
export function folderFor(name: string): string {
  const clean = fileName(name)
  if (!clean) return ''
  // English names get the usual plural, as in «Tool» → «Tools»; others stay as written.
  if (/^[A-Za-z][A-Za-z ]*$/.test(clean)) {
    // A name already in the plural («Tools») stays.
    if (/[^s]s$/i.test(clean)) return clean
    if (/(ss|x|ch|sh)$/i.test(clean)) return `${clean}es`
    if (/[^aeiou]y$/i.test(clean)) return `${clean.slice(0, -1)}ies`
    return `${clean}s`
  }
  return clean
}

/**
 * What is typed after `@` on a line up to the cursor: the type being chosen, or a type and the object of it.
 * `null` when the `@` is not one to answer (inside a word, an e-mail, a time `(@2026-11-20 10:00)`).
 */
export function atQuery(before: string): { at: number; type: string; object: string | null } | null {
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  const prev = at ? before[at - 1] : ''
  if (prev && !/[\s([{«"'“,;]/.test(prev)) return null
  const rest = before.slice(at + 1)
  if (/^\d/.test(rest) || rest.includes('[[') || rest.includes(']]')) return null
  const slash = rest.indexOf('/')
  if (slash < 0) return { at, type: rest, object: null }
  return { at, type: rest.slice(0, slash), object: rest.slice(slash + 1) }
}
