import type { App } from './app'
import { FileRef, Link, parseDate } from './expr'

const WIKILINK = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/

/**
 * Turns a raw frontmatter value into a value for expressions: text that is a
 * date becomes a date, `[[wikilinks]]` become links, lists are converted item
 * by item.
 */
export function propertyValue(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(propertyValue)
  if (raw instanceof Date) return raw
  if (typeof raw !== 'string') return raw ?? null
  const link = WIKILINK.exec(raw.trim())
  if (link) return new Link(link[1].trim(), link[2]?.trim())
  return parseDate(raw) ?? raw
}

// Values of files for the current state of the index; rebuilt when links or properties change.
let cached = { generation: -1, refs: new Map<string, FileRef>() }

/** A vault file as a value for expressions (`file.name`, `file.hasTag(...)`). */
export function fileRef(app: App, path: string): FileRef {
  const { metadata, vault } = app
  if (cached.generation !== metadata.generation) cached = { generation: metadata.generation, refs: new Map() }
  let ref = cached.refs.get(path)
  if (ref) return ref
  let properties: Record<string, unknown> | undefined
  ref = new FileRef({
    path,
    // Size and times are read when asked for, so they are current even for a cached value.
    get size() {
      return vault.get(path)?.size ?? 0
    },
    get ctime() {
      return vault.get(path)?.ctime ?? 0
    },
    get mtime() {
      return vault.get(path)?.mtime ?? 0
    },
    tags: () => metadata.get(path)?.tags ?? [],
    links: () => (metadata.get(path)?.links ?? []).map((link) => new Link(link.target)),
    backlinks: () => [...metadata.backlinks(path).keys()].map((source) => new Link(source)),
    properties: () => {
      if (!properties) {
        const data = metadata.get(path)?.frontmatter ?? {}
        properties = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, propertyValue(value)]))
      }
      return properties
    },
    resolve: (target) => metadata.resolve(target, path),
    linksTo: (target) => metadata.resolvedLinks.get(path)?.has(target) ?? false,
  })
  cached.refs.set(path, ref)
  return ref
}
