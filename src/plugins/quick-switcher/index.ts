import { errorMessage, path, Plugin, type VaultEntry } from '../../api'
import { SwitcherMemory } from './memory'

/** A file, or one of a note's aliases leading to it. */
interface Item {
  file: VaultEntry
  alias?: string
}

/** Where a word of the name may begin: after a space, a dash, a bracket and the like. */
const wordStart = (name: string, query: string) => {
  for (let at = name.indexOf(query); at > 0; at = name.indexOf(query, at + 1)) if (/[\s\-_.,(\[{/«"'#]/.test(name[at - 1])) return true
  return false
}

/**
 * How well an item matches the typed text, from 6 (the very name) down to 1 (its letters in order, with
 * anything between them: "flnt" finds "FlintNotes"); 0 means not at all. Several words match each anywhere.
 */
function match({ file, alias }: Item, query: string, words: string[]): number {
  const full = file.path.toLowerCase()
  const name = alias?.toLowerCase() ?? path.basename(full)
  const bare = alias ? name : path.stripExt(name)
  // Among equal matches a note's own name goes before an alias.
  const own = alias ? 0.5 : 0
  if (bare === query || name === query) return 6 - own
  if (name.startsWith(query)) return 5 - own
  if (wordStart(name, query)) return 4 - own
  if (name.includes(query)) return 3 - own
  if (words.length > 1 && words.every((word) => name.includes(word))) return 2.8 - own
  if (alias) return 0
  if (full.includes(query)) return 2
  if (words.length > 1 && words.every((word) => full.includes(word))) return 1.6
  let i = 0
  for (const char of name) if (char === query[i]) i++
  return i === query.length ? 1 : 0
}

/** A file that is not a note (a picture, an archive) gives way to the notes, unless its kind was typed. */
const otherKind = (file: VaultEntry, query: string) => {
  const ext = path.extname(file.path).toLowerCase()
  return ext !== 'md' && ext !== 'base' && ext !== 'canvas' && !query.includes(`.${ext}`)
}

export default class QuickSwitcher extends Plugin {
  onload() {
    const { app } = this
    // What was chosen before, and for what: it comes up first (memory.ts). Read on the side: starting waits for nothing.
    const memory = new SwitcherMemory(app)
    void memory.load()
    this.register(() => memory.flush())
    this.register(app.vault.on('rename', (entry, from) => memory.moved(from, entry.path)))
    this.register(app.vault.on('delete', (entry) => memory.moved(entry.path, null)))
    const title = (file: VaultEntry) => {
      const name = path.basename(file.path)
      return path.extname(name) === 'md' ? path.stripExt(name) : name
    }

    this.addCommand({
      id: 'open',
      name: 'Быстрый переход к файлу',
      hotkey: 'Mod+O',
      callback: () => {
        const files = app.vault.files()
        /** What is in the field now: a choice is remembered with it. */
        let typedNow = ''
        const items: Item[] = files.flatMap((file) => [
          { file },
          ...(app.metadata.get(file.path)?.aliases ?? []).map((alias) => ({ file, alias })),
        ])
        app.suggest<Item>({
          remember: 'quick-switcher',
          placeholder: 'Имя файла или алиас…',
          items: (typed) => {
            typedNow = typed
            const query = typed.trim().toLowerCase()
            const recent = app.services.get<{ list(): string[] }>('recent-files')?.list() ?? []
            // With nothing typed: the notes opened last (when the recent notes plugin keeps them), the files chosen
            // here most, then the most recently edited files.
            if (!query) {
              const first = [...recent, ...memory.favourites().slice(0, 30)]
              const seen = new Set<string>()
              const top = first.flatMap((file) => (!seen.has(file) && app.vault.get(file) && seen.add(file) ? [{ file: app.vault.get(file)! }] : []))
              return [...top, ...files.filter((file) => !seen.has(file.path)).sort((a, b) => b.mtime - a.mtime).map((file) => ({ file }))]
            }
            // How each match is weighed. A level of the match is worth 100; the memory may lift a file over a
            // level or more: chosen for these letters before, most of all.
            const words = query.split(/\s+/).filter(Boolean)
            const lift = memory.forQuery(query)
            const recentAt = new Map(recent.map((file, i) => [file, i]))
            const now = Date.now()
            const rank = (item: Item, level: number) => {
              const { file } = item
              const at = recentAt.get(file.path)
              return (
                level * 100 +
                Math.min(450, (lift.get(file.path) ?? 0) * 220) +
                Math.min(120, Math.log2(1 + memory.usage(file.path)) * 40) +
                (at === undefined ? 0 : 40 * (1 - at / Math.max(10, recent.length))) +
                // Edited this week: a little.
                Math.max(0, Math.round(12 - (now - file.mtime) / 86_400_000 / 0.6)) -
                (otherKind(file, query) ? 60 : 0)
              )
            }
            const found = new Map<string, { item: Item; rank: number }>()
            for (const item of items) {
              const level = match(item, query, words)
              if (!level) continue
              const scored = { item, rank: rank(item, level) }
              // A file comes once: by its name or by its best alias.
              const key = item.file.path
              const before = found.get(key)
              if (!before || scored.rank > before.rank) found.set(key, scored)
            }
            return [...found.values()].sort((a, b) => b.rank - a.rank || a.item.file.path.length - b.item.file.path.length).map(({ item }) => item)
          },
          stacked: true,
          label: ({ file, alias }) => alias ?? title(file),
          // Under the name: the folder, or for an alias the note it belongs to.
          detail: ({ file, alias }) => (alias ? `→ ${file.path.replace(/\.md$/, '')}` : path.dirname(file.path) ? `${path.dirname(file.path)}/` : undefined),
          // The note's own icon if it has one, otherwise one for the kind of file.
          icon: ({ file }) => app.icons.look('file', file.path) ?? { icon: path.extname(file.path) === 'md' ? 'file-text' : /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path.extname(file.path)) ? 'image' : 'file' },
          onChoose: ({ file }) => {
            memory.chose(file.path, typedNow)
            app.workspace.openFile(file.path)
          },
          createLabel: (name) => `Создать заметку «${name}»`,
          onCreate: async (name) => {
            try {
              const file = `${path.normalize(name)}.md`
              const made = await app.creation.place({ origin: 'switcher', name: path.stripExt(path.basename(file)), folder: path.dirname(file), explicit: file.includes('/') })
              const entry = made ? await app.creation.create(made) : null
              if (entry) app.workspace.openFile(entry.path)
            } catch (err) {
              app.notice(`Не удалось создать заметку: ${errorMessage(err)}`)
            }
          },
        })
      },
    })
  }
}
