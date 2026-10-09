import type { App } from './app'
import type { VaultEntry } from './vault'

/** What a new note is to be: where it goes and what it says. `after` runs once it exists. */
export interface Draft {
  path: string
  text: string
  after?: (entry: VaultEntry) => void | Promise<void>
}

/**
 * The one way a new, empty note comes to be, whoever asks for it: the "+" of
 * the tabs, the file list, a link to a note that does not exist yet, the quick
 * switcher.
 *
 * A plugin may prepare the note first (the Templates plugin lets the user
 * choose a template and answers its questions). The file is written only when
 * that has ended well: if the user backs out, or a template fails, there is
 * no note, rather than an empty or half-filled one.
 */
export class NoteCreation {
  /** Prepares the note; `null` means it is not to be created. Set by a plugin. */
  prepare: ((path: string) => Promise<Draft | null>) | null = null

  constructor(private app: App) {}

  /** Creates the note at `path` (or where its template moves it). `null`: nothing was created. */
  async create(path: string): Promise<VaultEntry | null> {
    const draft = this.prepare ? await this.prepare(path) : { path, text: '' }
    if (!draft) return null
    const entry = await this.app.vault.create(draft.path, draft.text)
    await draft.after?.(entry)
    return entry
  }
}
