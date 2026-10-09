import { errorMessage, path, Plugin, type VaultEntry } from '../../api'

/** A file, or one of a note's aliases leading to it. */
interface Item {
  file: VaultEntry
  alias?: string
}

/** How well an item matches the typed text; 0 means not at all. */
function score({ file, alias }: Item, query: string): number {
  const full = file.path.toLowerCase()
  const name = alias?.toLowerCase() ?? path.basename(full)
  // Among equal matches a note's own name goes before an alias.
  if (alias) return name.startsWith(query) ? 3.5 : name.includes(query) ? 2.5 : 0
  if (name.startsWith(query)) return 4
  if (name.includes(query)) return 3
  if (full.includes(query)) return 2
  // The typed letters in order, with anything between them: "flnt" finds "FlintNotes".
  let i = 0
  for (const char of name) if (char === query[i]) i++
  return i === query.length ? 1 : 0
}

export default class QuickSwitcher extends Plugin {
  onload() {
    const { app } = this
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
        const items: Item[] = files.flatMap((file) => [
          { file },
          ...(app.metadata.get(file.path)?.aliases ?? []).map((alias) => ({ file, alias })),
        ])
        app.suggest<Item>({
          placeholder: 'Имя файла или алиас…',
          items: (typed) => {
            const query = typed.trim().toLowerCase()
            // With nothing typed, the most recently edited files.
            if (!query) return files.map((file) => ({ file })).sort((a, b) => b.file.mtime - a.file.mtime)
            return items
              .map((item) => ({ item, rank: score(item, query) }))
              .filter(({ rank }) => rank > 0)
              .sort((a, b) => b.rank - a.rank || a.item.file.path.length - b.item.file.path.length)
              .map(({ item }) => item)
          },
          stacked: true,
          label: ({ file, alias }) => alias ?? title(file),
          // Under the name: the folder, or for an alias the note it belongs to.
          detail: ({ file, alias }) => (alias ? `→ ${file.path.replace(/\.md$/, '')}` : path.dirname(file.path) ? `${path.dirname(file.path)}/` : undefined),
          // The note's own icon if it has one, otherwise one for the kind of file.
          icon: ({ file }) => app.icons.look('file', file.path) ?? { icon: path.extname(file.path) === 'md' ? 'file-text' : /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path.extname(file.path)) ? 'image' : 'file' },
          onChoose: ({ file }) => app.workspace.openFile(file.path),
          createLabel: (name) => `Создать заметку «${name}»`,
          onCreate: async (name) => {
            try {
              const entry = await app.vault.create(`${path.normalize(name)}.md`)
              app.workspace.openFile(entry.path)
            } catch (err) {
              app.notice(`Не удалось создать заметку: ${errorMessage(err)}`)
            }
          },
        })
      },
    })
  }
}
