import { moment, Moment, path as paths, type App } from '../../api'
import { Link, parseDate, parseValue } from './values'

/** A list item or task of a note, as queries see it. */
export interface ListItem extends Record<string, unknown> {
  text: string
  line: number
  path: string
  link: Link
  task: boolean
  status: string
  checked: boolean
  completed: boolean
  tags: string[]
  children: ListItem[]
}

/** A note as queries see it: its fields, plus everything about the file under `file`. */
export type Page = Record<string, unknown> & { file: Record<string, unknown> }

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/
const LINE_FIELD = /^\s*(?:[-*+]\s+(?:\[.\]\s+)?)?([\p{L}\p{N}_][^:\n`\[\]()]*?)::[ \t]*(.*)$/u
const INLINE_FIELD = /[[(]([^\[\]()\n:]+?)::[ \t]*([^\])\n]*)[\])]/g
const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[(.)\]\s+)?(.*)$/
const TAG = /(?<![\p{L}\p{N}_/#&;])#([\p{L}\p{N}_/-]+)/gu
// Dates that Obsidian Tasks writes with emoji are fields of the task too.
const EMOJI_FIELDS: [string, string][] = [['📅', 'due'], ['✅', 'completion'], ['➕', 'created'], ['🛫', 'start'], ['⏳', 'scheduled']]

/** `side dish` is also reachable as `side-dish`, the way Dataview normalises names. */
export const sanitize = (key: string) => key.trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-')

function setField(target: Record<string, unknown>, key: string, value: unknown): void {
  const put = (name: string) => {
    // A field written several times becomes a list of its values.
    if (Object.hasOwn(target, name) && target[name] !== null) target[name] = [target[name]].flat().concat(value === null ? [] : [value])
    else target[name] = value
  }
  put(key)
  const clean = sanitize(key)
  if (clean && clean !== key) put(clean)
}

/** Reads `key:: value` fields and list items from a note's text. */
function parseBody(path: string, text: string) {
  const fields: Record<string, unknown> = {}
  const items: ListItem[] = []
  const stack: { indent: number; item: ListItem }[] = []
  const lines = text.split(/\r?\n/)
  let start = 0
  const front = FRONTMATTER.exec(text)
  if (front) start = front[0].split('\n').length - 1
  let fence: string | null = null
  for (let n = start; n < lines.length; n++) {
    const line = lines[n]
    const fenced = FENCE.exec(line)
    if (fence) {
      if (fenced && fenced[1].startsWith(fence) && !fenced[2].trim()) fence = null
      continue
    }
    if (fenced) {
      fence = fenced[1]
      continue
    }
    const own: Record<string, unknown> = {}
    const whole = LINE_FIELD.exec(line)
    if (whole) setField(own, whole[1].trim(), parseValue(whole[2]))
    else for (const m of line.matchAll(INLINE_FIELD)) setField(own, m[1].trim(), parseValue(m[2]))

    const listed = ITEM.exec(line)
    if (listed) {
      const [, indent, status, body] = listed
      const item: ListItem = {
        ...own,
        text: body,
        line: n,
        path,
        link: new Link(path),
        task: status !== undefined,
        status: status ?? '',
        checked: status !== undefined && status !== ' ',
        completed: status === 'x' || status === 'X',
        tags: [...body.matchAll(TAG)].map((m) => `#${m[1]}`),
        children: [],
      }
      for (const [emoji, name] of EMOJI_FIELDS) {
        const date = new RegExp(`${emoji}\\uFE0F?\\s*(\\d{4}-\\d{2}-\\d{2})`, 'u').exec(body)
        if (date) item[name] = parseDate(date[1])
      }
      while (stack.length && stack[stack.length - 1].indent >= indent.length) stack.pop()
      stack[stack.length - 1]?.item.children.push(item)
      stack.push({ indent: indent.length, item })
      items.push(item)
    } else if (line.trim()) {
      stack.length = 0
    }
    // Fields of a list item belong to the item; the rest belong to the note.
    if (!listed) for (const [key, value] of Object.entries(own)) setField(fields, key, value)
  }
  return { fields, items }
}

const LIVE = new Set(['size', 'ctime', 'cday', 'mtime', 'mday'])

/** Builds and caches the page objects of the vault. */
export class Pages {
  private cache = new Map<string, { text: string; page: Page }>()
  // Reading fields and tasks out of a note is the costly part, and it depends on the note's text alone.
  private bodies = new Map<string, { text: string; body: ReturnType<typeof parseBody> }>()
  private generation = -1

  constructor(private app: App) {}

  all(): Page[] {
    return this.app.metadata.notes().map((path) => this.get(path)!)
  }

  get(path: string): Page | undefined {
    const { metadata, vault } = this.app
    if (this.generation !== metadata.generation) {
      // Links and tags of other notes show up in a page (`file.inlinks`), so all pages are stale together.
      this.generation = metadata.generation
      this.cache.clear()
    }
    const text = metadata.text(path)
    const meta = metadata.get(path)
    if (text === undefined || !meta) return undefined
    const cached = this.cache.get(path)
    if (cached?.text === text) return cached.page

    const name = paths.stripExt(paths.basename(path))
    const page: Page = { file: {} }
    for (const [key, value] of Object.entries(meta.frontmatter ?? {})) setField(page, key, parseValue(value))
    const parsed = () => {
      let body = this.bodies.get(path)
      if (body?.text !== text) this.bodies.set(path, (body = { text, body: parseBody(path, text) }))
      return body.body
    }
    for (const [key, value] of Object.entries(parsed().fields)) setField(page, key, value)

    const entry = () => vault.get(path)
    const time = (stamp: number | undefined): Moment => moment(stamp ?? 0)
    const links = (list: Iterable<string>) => [...list].map((target) => new Link(target))
    // A page stands for a day if its name carries a date, or if it has a `date` field.
    const day = (): Moment | null => {
      const inName = /\d{4}-\d{2}-\d{2}/.exec(name)?.[0] ?? /\d{8}/.exec(name)?.[0].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
      const fromName = inName ? parseDate(inName) : null
      return fromName ?? (page.date instanceof Moment ? page.date : null)
    }
    const tags = () => {
      const all = new Set<string>()
      // A nested tag also counts as each of its parents: #a/b is #a too.
      for (const tag of meta.tags) tag.split('/').forEach((_, i, parts) => all.add(`#${parts.slice(0, i + 1).join('/')}`))
      return [...all]
    }
    const lazy: Record<string, () => unknown> = {
      name: () => name,
      path: () => path,
      folder: () => paths.dirname(path),
      ext: () => paths.extname(path),
      link: () => new Link(path),
      size: () => entry()?.size ?? 0,
      ctime: () => time(entry()?.ctime),
      cday: () => time(entry()?.ctime).startOf('day'),
      mtime: () => time(entry()?.mtime),
      mday: () => time(entry()?.mtime).startOf('day'),
      tags,
      etags: () => meta.tags.map((tag) => `#${tag}`),
      aliases: () => meta.aliases,
      inlinks: () => links(metadata.backlinks(path).keys()),
      outlinks: () => links(metadata.resolvedLinks.get(path)?.keys() ?? []),
      lists: () => parsed().items,
      tasks: () => parsed().items.filter((item) => item.task),
      frontmatter: () => meta.frontmatter ?? {},
      day,
      starred: () => false,
    }
    for (const [key, make] of Object.entries(lazy)) {
      let value: unknown
      let made = false
      // Most queries touch two or three of these, so each is worked out when first read.
      // Sizes and times change without the note's fields changing, so they are always read afresh.
      Object.defineProperty(page.file, key, { enumerable: true, get: () => (LIVE.has(key) ? make() : made ? value : ((made = true), (value = make()))) })
    }
    this.cache.set(path, { text, page })
    return page
  }
}
