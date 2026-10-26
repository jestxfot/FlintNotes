import type { App } from './app'
import { FileRef, Link, parseDate, type FileInfo } from './expr'

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

/**
 * What expressions learn about a vault file, asked of the index each time. One small object per file,
 * its ways shared: a base looks at every file of the vault, tens of thousands of them.
 */
class VaultFileInfo implements FileInfo {
  private props: Record<string, unknown> | undefined

  constructor(
    private app: App,
    readonly path: string,
  ) {}

  // Size and times are read when asked for, so they are current even for a cached value.
  get size(): number {
    return this.app.vault.get(this.path)?.size ?? 0
  }

  get ctime(): number {
    return this.app.vault.get(this.path)?.ctime ?? 0
  }

  get mtime(): number {
    return this.app.vault.get(this.path)?.mtime ?? 0
  }

  tags(): string[] {
    return this.app.metadata.get(this.path)?.tags ?? []
  }

  links(): Link[] {
    return (this.app.metadata.get(this.path)?.links ?? []).map((link) => new Link(link.target))
  }

  backlinks(): Link[] {
    return [...this.app.metadata.backlinks(this.path).keys()].map((source) => new Link(source))
  }

  properties(): Record<string, unknown> {
    if (!this.props) {
      const data = this.app.metadata.get(this.path)?.frontmatter ?? {}
      this.props = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, propertyValue(value)]))
    }
    return this.props
  }

  resolve(target: string): string | null {
    return this.app.metadata.resolve(target, this.path)
  }

  linksTo(target: string, subpath?: string): boolean {
    const { metadata } = this.app
    if (!subpath) return metadata.resolvedLinks.get(this.path)?.has(target) ?? false
    const part = subpath.toLowerCase()
    return (metadata.get(this.path)?.links ?? []).some((link) => link.subpath.toLowerCase() === part && metadata.resolve(link.target, this.path) === target)
  }
}

/** A vault file as a value for expressions (`file.name`, `file.hasTag(...)`). */
export function fileRef(app: App, path: string): FileRef {
  if (cached.generation !== app.metadata.generation) cached = { generation: app.metadata.generation, refs: new Map() }
  let ref = cached.refs.get(path)
  if (!ref) cached.refs.set(path, (ref = new FileRef(new VaultFileInfo(app, path))))
  return ref
}
