import { notice, path, setProperties, type App } from '../../api'
import { bestScore, fileName, fold, objectFields, objectNote, readType, starterTypes, typeCalled, typeNote, type TypeDef } from './model'

export interface ObjectSettings {
  typesFolder: string
  innerFolder: string
  outerFolder: string
  starters: boolean
}

/** The link targets written in a `type` property: `"[[Person]]"`, `[[[Person]], [[Tool]]]` or a bare `Person`. */
function typeTargets(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return list
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .map((item) => /^\[\[([^\]|#]+)/.exec(item)?.[1].trim() ?? item)
}

/**
 * Every type of the vault and which notes are objects of which type. Types are the notes of the types folder (and
 * the starter types not written yet); a note is an object of the type its `type` property links to. Worked out
 * from the index when asked and kept until the index changes, so asking per link drawn costs nothing.
 */
export class Registry {
  private generation = -1
  private typeList: TypeDef[] = []
  private byPath = new Map<string, TypeDef>()
  private objectType = new Map<string, TypeDef>()
  private byType = new Map<string, string[]>()
  /** What objects there are of which type, as text: tells whether icons need drawing again. */
  signature = ''

  constructor(
    private app: App,
    private settings: () => ObjectSettings,
  ) {}

  /** Forgets what was worked out: the settings changed. */
  reset(): void {
    this.generation = -1
  }

  private fresh(): void {
    const { metadata } = this.app
    if (this.generation === metadata.generation) return
    this.generation = metadata.generation
    const { typesFolder, innerFolder, outerFolder, starters } = this.settings()
    const folder = path.normalize(typesFolder)
    const own = metadata
      .notes()
      .filter((note) => path.dirname(note) === folder)
      .map((note) => readType(note, metadata.get(note)?.frontmatter ?? null, ''))
    const taken = (type: TypeDef) => own.some((one) => [type.name, ...type.aliases].some((name) => typeCalled(one, name)))
    this.typeList = [...own, ...(starters ? starterTypes(innerFolder, outerFolder).filter((type) => !taken(type)) : [])]
    this.byPath = new Map(own.map((type) => [type.path, type]))
    this.objectType.clear()
    this.byType.clear()
    for (const note of metadata.notes()) {
      if (this.byPath.has(note)) continue
      const targets = typeTargets(metadata.get(note)?.frontmatter?.type)
      if (!targets.length) continue
      for (const target of targets) {
        const dest = metadata.resolve(target, note)
        const type = (dest && this.byPath.get(dest)) || own.find((one) => typeCalled(one, target))
        if (!type) continue
        if (!this.objectType.has(note)) this.objectType.set(note, type)
        const list = this.byType.get(type.path)
        if (list) list.push(note)
        else this.byType.set(type.path, [note])
        break
      }
    }
    this.signature = [...own.map((t) => `${t.path}:${t.icon}:${t.color}`), ...[...this.objectType].map(([note, type]) => `${note}>${type.path}`)].join('\n')
  }

  /** All types: the vault's own, then the starters it has not made. */
  types(): TypeDef[] {
    this.fresh()
    return this.typeList
  }

  /** The type a note is, if it is a type's note. */
  typeAt(note: string): TypeDef | undefined {
    this.fresh()
    return this.byPath.get(note)
  }

  /** The type of an object. */
  typeOf(note: string): TypeDef | undefined {
    this.fresh()
    return this.objectType.get(note)
  }

  /** The objects of a type, by name. */
  objects(type: TypeDef): string[] {
    this.fresh()
    return [...(this.byType.get(type.path) ?? [])].sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
  }

  /** Every object of the vault. */
  allObjects(): string[] {
    this.fresh()
    return [...this.objectType.keys()]
  }

  /** The type called so, by name, alias or property. */
  find(name: string): TypeDef | undefined {
    return this.types().find((type) => typeCalled(type, name))
  }

  /** Types matching typed text, best first. */
  matching(query: string): TypeDef[] {
    const all = this.types()
    if (!query.trim()) return all
    return all
      .map((type, i) => ({ type, i, score: bestScore([type.name, ...type.aliases], query) }))
      .filter((one) => one.score >= 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((one) => one.type)
  }

  /** The type a property links to: `company` to Company, `key element` to Key Element. */
  relationOf(field: string): TypeDef | undefined {
    return this.types().find((type) => fold(type.key) === fold(field) || typeCalled(type, field))
  }

  /** The type's note, written now if the type is a starter not made yet. */
  async ensure(type: TypeDef): Promise<TypeDef> {
    if (type.path) return type
    const at = path.join(path.normalize(this.settings().typesFolder), `${fileName(type.name)}.md`)
    if (!this.app.vault.get(at)) await this.app.vault.create(at, typeNote(type))
    this.reset()
    return { ...type, path: at }
  }

  /** Writes the note of a new type. */
  async createType(type: TypeDef): Promise<TypeDef> {
    const name = fileName(type.name)
    if (!name) throw new Error('У типа нет имени')
    if (this.find(name)?.path) throw new Error(`Тип «${name}» уже есть`)
    return this.ensure({ ...type, name, path: '' })
  }

  /** How an object links to its type: the shortest link from where the object is. */
  typeLink(type: TypeDef, from: string): string {
    return `[[${this.app.metadata.linkText(type.path, from)}]]`
  }

  /** The object of the type with this name, if there is one. */
  existing(type: TypeDef, name: string): string | undefined {
    const wanted = fold(fileName(name))
    return this.objects(type).find((note) => fold(path.stripExt(path.basename(note))) === wanted)
  }

  /**
   * Makes an object of the type: a note in the type's folder with `type` and the type's fields. Its note is not
   * opened: an object is usually made while writing about it somewhere else.
   */
  async createObject(given: TypeDef, name: string, values: Record<string, string> = {}): Promise<string> {
    const clean = fileName(name)
    if (!clean) throw new Error('У объекта нет имени')
    const type = await this.ensure(given)
    const found = this.existing(type, clean)
    if (found) return found
    const target = this.app.vault.uniquePath(path.normalize(type.folder), clean, 'md')
    const text = objectNote(this.typeLink(type, target), objectFields(type), values)
    await this.app.creation.createDraft({ path: target, text })
    this.reset()
    return target
  }

  /** Makes a note an object of a type: sets `type` and adds the type's fields it lacks. */
  async setType(note: string, given: TypeDef | null): Promise<void> {
    if (!given) return setProperties(this.app, note, { type: undefined })
    const type = await this.ensure(given)
    const frontmatter = this.app.metadata.get(note)?.frontmatter ?? {}
    const changes: Record<string, unknown> = { type: this.typeLink(type, note) }
    for (const field of objectFields(type)) if (!(field in frontmatter)) changes[field] = null
    await setProperties(this.app, note, changes)
    this.reset()
  }

  /** Gives every object of the type the fields the type has now and they lack. */
  async addMissingFields(type: TypeDef): Promise<number> {
    let changed = 0
    for (const note of this.objects(type)) {
      const frontmatter = this.app.metadata.get(note)?.frontmatter ?? {}
      const missing = objectFields(type).filter((field) => !(field in frontmatter))
      if (!missing.length) continue
      await setProperties(this.app, note, Object.fromEntries(missing.map((field) => [field, null])))
      changed++
    }
    return changed
  }

  /** Writes the starter types that are not in the vault yet. */
  async writeStarters(): Promise<number> {
    let made = 0
    for (const type of this.types()) {
      if (type.path) continue
      try {
        await this.ensure(type)
        made++
      } catch (err) {
        notice(`Не удалось создать тип «${type.name}»: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return made
  }
}
