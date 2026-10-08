import { errorMessage, path, Plugin, type VaultEntry } from '../../api'

/** How well a file matches the typed text; 0 means not at all. */
function score(file: VaultEntry, query: string): number {
  const full = file.path.toLowerCase()
  const name = path.basename(full)
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
    const label = (file: VaultEntry) => {
      const name = path.basename(file.path)
      return path.extname(name) === 'md' ? path.stripExt(name) : name
    }

    this.addCommand({
      id: 'open',
      name: 'Быстрый переход к файлу',
      hotkey: 'Mod+O',
      callback: () => {
        const files = app.vault.files()
        app.suggest<VaultEntry>({
          placeholder: 'Имя файла…',
          items: (typed) => {
            const query = typed.trim().toLowerCase()
            // With nothing typed, the most recently edited files.
            if (!query) return [...files].sort((a, b) => b.mtime - a.mtime)
            return files
              .map((file) => ({ file, rank: score(file, query) }))
              .filter(({ rank }) => rank > 0)
              .sort((a, b) => b.rank - a.rank || a.file.path.length - b.file.path.length)
              .map(({ file }) => file)
          },
          label,
          detail: (file) => path.dirname(file.path) || undefined,
          onChoose: (file) => app.workspace.openFile(file.path),
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
