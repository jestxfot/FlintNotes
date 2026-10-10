import { parse } from 'yaml'
import { path as paths, type App, type VaultEntry } from '../../api'

/** The settings of a ```folder-overview block, named as in the Folder notes plugin. */
interface Overview {
  folderPath?: string
  title?: string
  showTitle?: boolean
  depth?: number
  includeTypes?: string[]
  style?: 'list' | 'grid' | 'explorer'
  sortBy?: 'name' | 'created' | 'modified'
  sortByAsc?: boolean
  showEmptyFolders?: boolean
  onlyIncludeSubfolders?: boolean
  showFolderNotes?: boolean
}

const KINDS: Record<string, RegExp> = {
  markdown: /^md$/i,
  canvas: /^canvas$/i,
  pdf: /^pdf$/i,
  image: /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i,
  audio: /^(mp3|wav|ogg|m4a|flac)$/i,
  video: /^(mp4|webm|mkv|mov)$/i,
}

function kindOf(entry: VaultEntry): string {
  if (entry.kind === 'folder') return 'folder'
  const ext = paths.extname(entry.path)
  return Object.keys(KINDS).find((kind) => KINDS[kind].test(ext)) ?? 'other'
}

/**
 * Draws what a folder holds, as the Folder notes plugin's overview does: a
 * nested list (or a grid of the folder's items), down to a depth, of the kinds
 * of files asked for. `noteOf` tells which note belongs to a folder.
 */
export function drawOverview(app: App, el: HTMLElement, source: string, sourcePath: string, noteOf: (folder: string) => string | null): void {
  let config: Overview = {}
  try {
    const parsed: unknown = parse(source)
    if (parsed && typeof parsed === 'object') config = parsed as Overview
  } catch (err) {
    el.textContent = `folder-overview: ${err instanceof Error ? err.message : String(err)}`
    return
  }
  el.className = 'folder-overview'
  el.replaceChildren()
  // No folder named: the folder of the note the block is in.
  const written = (config.folderPath ?? '').trim().replace(/^\/+|\/+$/g, '')
  const root = written && written !== 'File’s parent folder path' && written !== "File's parent folder path" ? written : paths.dirname(sourcePath)
  const name = root ? paths.basename(root) : app.vault.name
  if (config.showTitle) {
    const title = el.appendChild(document.createElement('div'))
    title.className = 'folder-overview-title'
    title.textContent = (config.title ?? '{{folderName}} overview').replace(/\{\{folderName\}\}/g, name).replace(/\{\{folderPath\}\}/g, root)
  }
  const types = new Set(config.includeTypes?.length ? config.includeTypes : ['folder', 'markdown'])
  const depth = Math.max(1, Number(config.depth) || 3)
  const all = app.vault.all()
  const childrenOf = (folder: string) => all.filter((entry) => paths.dirname(entry.path) === folder)
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const order = (a: VaultEntry, b: VaultEntry) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    const by = config.sortBy === 'modified' || config.sortBy === 'created' ? (a.mtime ?? 0) - (b.mtime ?? 0) : collator.compare(paths.basename(a.path), paths.basename(b.path))
    return config.sortByAsc === false ? -by : by
  }
  const wanted = (entry: VaultEntry): boolean => {
    if (entry.path === sourcePath) return false
    if (entry.kind === 'folder') return types.has('folder') || types.has('all')
    if (config.onlyIncludeSubfolders) return false
    // The note of a folder stands for the folder; it is not listed beside it unless asked.
    if (!config.showFolderNotes && noteOf(paths.dirname(entry.path)) === entry.path) return false
    return types.has('all') || types.has(kindOf(entry))
  }
  const label = (entry: VaultEntry) => (paths.extname(entry.path) === 'md' ? paths.stripExt(paths.basename(entry.path)) : paths.basename(entry.path))
  const item = (entry: VaultEntry): HTMLElement => {
    const look = app.icons.look(entry.kind === 'folder' ? 'folder' : 'file', entry.path)
    const icon = app.icons.draw(look?.icon ?? (entry.kind === 'folder' ? 'folder' : 'file-text'), look?.color)
    if (entry.kind === 'folder') {
      const note = noteOf(entry.path)
      const span = document.createElement('span')
      span.className = note ? 'fo-folder fo-link' : 'fo-folder'
      span.append(icon, label(entry))
      if (note) span.onclick = () => app.workspace.openFile(note)
      return span
    }
    const link = document.createElement('a')
    link.className = 'inline-link'
    link.href = '#'
    link.append(icon, label(entry))
    link.onclick = (event) => {
      event.preventDefault()
      app.workspace.openFile(entry.path)
    }
    return link
  }
  const list = (folder: string, level: number): HTMLUListElement | null => {
    const entries = childrenOf(folder).filter(wanted).sort(order)
    const ul = document.createElement('ul')
    for (const entry of entries) {
      const inner = entry.kind === 'folder' && level < depth ? list(entry.path, level + 1) : null
      if (entry.kind === 'folder' && !inner && config.showEmptyFolders === false && !childrenOf(entry.path).some(wanted)) continue
      const li = ul.appendChild(document.createElement('li'))
      li.append(item(entry))
      if (inner) li.append(inner)
    }
    return ul.childElementCount ? ul : null
  }

  if (config.style === 'grid') {
    const grid = el.appendChild(document.createElement('div'))
    grid.className = 'folder-overview-grid'
    for (const entry of childrenOf(root).filter(wanted).sort(order)) {
      const card = grid.appendChild(document.createElement('div'))
      card.append(item(entry))
      const inner = entry.kind === 'folder' && depth > 1 ? list(entry.path, 2) : null
      if (inner) card.append(inner)
    }
    if (!grid.childElementCount) grid.replaceWith(Object.assign(document.createElement('div'), { className: 'folder-overview-empty', textContent: 'В папке пусто' }))
    return
  }
  el.append(list(root, 1) ?? Object.assign(document.createElement('div'), { className: 'folder-overview-empty', textContent: 'В папке пусто' }))
}
