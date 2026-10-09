import { errorMessage, parseMarkdown, path as paths, setProperties, type App, type VaultEntry } from '../../api'

/**
 * The part of Obsidian's API that templates written for Obsidian use, backed by
 * FlintNotes. Inside a template `app` is this object, so
 * `app.vault.getAbstractFileByPath(...)` or `app.vault.adapter.read(...)` work
 * here as they do there. The real app is available as `app.flint`.
 */

export interface TAbstractFile {
  path: string
  name: string
  parent: { path: string; name: string } | null
}

export interface TFile extends TAbstractFile {
  basename: string
  extension: string
  stat: { ctime: number; mtime: number; size: number }
}

export interface TFolder extends TAbstractFile {
  children: TAbstractFile[]
  isRoot(): boolean
}

const clean = (path: string) => paths.normalize(path.replace(/\\/g, '/'))

const parentOf = (path: string) => {
  const dir = paths.dirname(path)
  return { path: dir || '/', name: paths.basename(dir) }
}

export function toTFile(entry: VaultEntry): TFile {
  const name = paths.basename(entry.path)
  const extension = paths.extname(name)
  return {
    path: entry.path,
    name,
    basename: extension ? name.slice(0, -extension.length - 1) : name,
    extension,
    stat: { ctime: entry.ctime, mtime: entry.mtime, size: entry.size },
    parent: parentOf(entry.path),
  }
}

export type ObsidianApp = ReturnType<typeof obsidianApp>

export function obsidianApp(app: App) {
  const { vault, metadata } = app
  const pathOf = (file: TAbstractFile | string) => clean(typeof file === 'string' ? file : file.path)

  const folder = (path: string): TFolder => ({
    path: path || '/',
    name: paths.basename(path),
    parent: path ? parentOf(path) : null,
    isRoot: () => !path,
    get children() {
      return vault
        .all()
        .filter((entry) => paths.dirname(entry.path) === path)
        .map((entry) => (entry.kind === 'folder' ? folder(entry.path) : toTFile(entry)))
    },
  })

  const abstract = (raw: string): TFile | TFolder | null => {
    const path = clean(raw)
    if (!path) return folder('')
    const entry = vault.get(path)
    return entry ? (entry.kind === 'folder' ? folder(entry.path) : toTFile(entry)) : null
  }
  const file = (raw: string) => {
    const found = abstract(raw)
    return found && 'extension' in found ? found : null
  }
  const files = () => vault.files().map(toTFile)

  const read = (target: TAbstractFile | string) => vault.read(pathOf(target))
  const write = async (target: TAbstractFile | string, data: string) => toTFile(await vault.write(pathOf(target), data))

  return {
    /** The FlintNotes app itself, for what Obsidian's API does not cover. */
    flint: app,

    vault: {
      getName: () => vault.name,
      getRoot: () => folder(''),
      getAbstractFileByPath: abstract,
      getFileByPath: file,
      getFolderByPath: (path: string) => {
        const found = abstract(path)
        return found && 'children' in found ? found : null
      },
      getFiles: files,
      getMarkdownFiles: () => files().filter((f) => f.extension === 'md'),
      getAllLoadedFiles: () => vault.all().map((entry) => (entry.kind === 'folder' ? folder(entry.path) : toTFile(entry))),
      read,
      cachedRead: read,
      modify: write,
      create: async (path: string, data = '') => toTFile(await vault.create(clean(path), data)),
      createFolder: async (path: string) => folder((await vault.createFolder(clean(path))).path),
      append: async (target: TFile, data: string) => write(target, (await read(target)) + data),
      process: async (target: TFile, change: (data: string) => string) => {
        const next = change(await read(target))
        await write(target, next)
        return next
      },
      rename: (target: TAbstractFile, newPath: string) => vault.rename(target.path, clean(newPath)),
      delete: (target: TAbstractFile) => vault.trash(target.path),
      trash: (target: TAbstractFile) => vault.trash(target.path),
      // The low-level file access of Obsidian; paths are relative to the vault.
      adapter: {
        basePath: vault.path,
        getName: () => vault.name,
        read: (path: string) => vault.read(clean(path)),
        write: async (path: string, data: string) => void (await vault.write(clean(path), data)),
        append: async (path: string, data: string) => void (await vault.write(clean(path), ((await vault.readOptional(clean(path))) ?? '') + data)),
        exists: async (path: string) => !!vault.get(clean(path)) || (await vault.readOptional(clean(path))) !== null,
        mkdir: async (path: string) => void (vault.get(clean(path)) ?? (await vault.createFolder(clean(path)))),
        remove: (path: string) => vault.trash(clean(path)),
        list: async (path: string) => {
          const inside = vault.all().filter((entry) => paths.dirname(entry.path) === clean(path))
          return {
            files: inside.filter((e) => e.kind === 'file').map((e) => e.path),
            folders: inside.filter((e) => e.kind === 'folder').map((e) => e.path),
          }
        },
      },
    },

    metadataCache: {
      getFileCache: (target: TFile) => {
        const meta = metadata.get(target.path)
        if (!meta) return null
        return {
          frontmatter: meta.frontmatter ?? undefined,
          tags: meta.tags.map((tag) => ({ tag: `#${tag}` })),
          headings: meta.headings.map((h) => ({ heading: h.text, level: h.level, position: { start: { line: h.line } } })),
          links: meta.links.filter((l) => !l.embed).map((l) => ({ link: l.target + l.subpath, position: { start: { line: l.line } } })),
          embeds: meta.links.filter((l) => l.embed).map((l) => ({ link: l.target + l.subpath, position: { start: { line: l.line } } })),
        }
      },
      getCache: (path: string) => {
        const target = file(path)
        return target ? parseMarkdown(metadata.text(target.path) ?? '') : null
      },
      getFirstLinkpathDest: (link: string, source: string) => {
        const dest = metadata.resolve(link.split('#')[0], clean(source))
        return dest ? file(dest) : null
      },
      get resolvedLinks() {
        return Object.fromEntries([...metadata.resolvedLinks].map(([source, links]) => [source, Object.fromEntries(links)]))
      },
      get unresolvedLinks() {
        return Object.fromEntries([...metadata.unresolvedLinks].map(([source, links]) => [source, Object.fromEntries(links)]))
      },
    },

    fileManager: {
      /** Lets `change` edit the note's properties as a plain object, then saves what it changed. */
      processFrontMatter: async (target: TFile, change: (frontmatter: Record<string, unknown>) => void) => {
        const before = parseMarkdown(await vault.read(target.path)).frontmatter ?? {}
        const after: Record<string, unknown> = structuredClone(before)
        change(after)
        const changes: Record<string, unknown> = {}
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (!Object.hasOwn(after, key)) changes[key] = undefined
          else if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) changes[key] = after[key]
        }
        if (Object.keys(changes).length) await setProperties(app, target.path, changes)
      },
      renameFile: (target: TAbstractFile, newPath: string) => vault.rename(target.path, clean(newPath)),
    },

    workspace: {
      getActiveFile: () => {
        const active = app.workspace.active?.path
        return active ? file(active) : null
      },
      openLinkText: async (link: string, source = '') => {
        const dest = metadata.resolve(link.split('#')[0], clean(source))
        if (dest) app.workspace.openFile(dest)
      },
      getLeaf: () => ({ openFile: async (target: TFile) => app.workspace.openFile(target.path) }),
    },

    commands: {
      executeCommandById: (id: string) => {
        const command = app.commands.list().find((c) => c.id === id)
        if (!command) return false
        try {
          command.callback()
        } catch (err) {
          app.notice(`Команда «${id}»: ${errorMessage(err)}`)
        }
        return true
      },
    },
  }
}
