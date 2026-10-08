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

/** A vault file as a value for expressions (`file.name`, `file.hasTag(...)`). */
export function fileRef(app: App, path: string): FileRef {
  const { metadata, vault } = app
  const entry = vault.get(path)
  return new FileRef({
    path,
    size: entry?.size ?? 0,
    ctime: entry?.ctime ?? 0,
    mtime: entry?.mtime ?? 0,
    tags: () => metadata.get(path)?.tags ?? [],
    links: () => (metadata.get(path)?.links ?? []).map((link) => new Link(link.target)),
    backlinks: () => [...metadata.backlinks(path).keys()].map((source) => new Link(source)),
    properties: () => {
      const data = metadata.get(path)?.frontmatter ?? {}
      return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, propertyValue(value)]))
    },
    resolve: (target) => metadata.resolve(target, path),
  })
}
