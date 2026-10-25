import type { App } from './app'
import { dirname, normalize } from './path'
import type { VaultEntry } from './vault'

/** The ways a new note comes to be, each of which asks where it is to go. */
export type CreationOrigin =
  /** The «+» of the tabs and the «Новая заметка» command. */
  | 'new'
  /** The file list: «new note» in a folder. */
  | 'tree'
  /** A click on a link to a note that does not exist yet. */
  | 'link'
  /** A name typed into the quick switcher that no note has. */
  | 'switcher'
  /** «Create a note from a template». */
  | 'template'
  /** «New record» of a base. */
  | 'base'

/** Where a note is about to be made, and what is known of the request. */
export interface Placement {
  origin: CreationOrigin
  /** The note's name without its extension. */
  name: string
  ext: string
  /** The folder this way of creating would use on its own. */
  folder: string
  /** The folder was named by the user (the one right-clicked, the one written in the link), not only a default. */
  explicit: boolean
  /** The note the request comes from: the open one, or the one holding the link. Empty if there is none. */
  source: string
}

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
  /**
   * Chooses the folder for a note about to be made, whichever way it is made; `null` means it is not to be
   * made after all (the user backed out of a question). Set by a plugin; with none, each way uses its own folder.
   */
  locate: ((placement: Placement) => Promise<string | null> | string | null) | null = null

  /** How the paths of notes about to be made were chosen, until they are made. */
  private placements = new Map<string, Placement>()

  constructor(private app: App) {}

  /** How `place` chose this path for a note about to be made: for whoever prepares the note (a template may have a folder of its own). */
  placementOf(path: string): Placement | undefined {
    return this.placements.get(path)
  }

  /** The note the user is in: the open one, if it is a file of the vault. */
  activeNote(): string {
    const path = this.app.workspace.active?.path
    return path && this.app.vault.get(path)?.kind === 'file' ? path : ''
  }

  /** The folder new notes go to as the main settings say: the root, the open note's folder, or one named there. */
  defaultFolder(): string {
    const { settings } = this.app
    const where = settings.get<string>('core', 'newNoteLocation')
    const active = this.activeNote()
    if (where === 'current' && active) return dirname(active)
    return where === 'folder' ? normalize(settings.get<string>('core', 'newNoteFolder').trim()) : ''
  }

  /**
   * The path for a new note: the folder a plugin chooses for it, or the one the way of creating would use,
   * and the first free name there. `null`: the note is not to be made.
   */
  async place(request: Omit<Placement, 'ext' | 'source'> & { ext?: string; source?: string }): Promise<string | null> {
    const placement: Placement = { ext: 'md', source: this.activeNote(), ...request }
    const chosen = this.locate ? await this.locate(placement) : placement.folder
    if (chosen === null) return null
    const path = this.app.vault.uniquePath(normalize(chosen), placement.name, placement.ext)
    if (this.placements.size > 50) this.placements.clear()
    this.placements.set(path, placement)
    return path
  }

  /** Creates the note at `path` (or where its template moves it). `null`: nothing was created. */
  async create(path: string): Promise<VaultEntry | null> {
    const draft = this.prepare ? await this.prepare(path) : { path, text: '' }
    this.placements.delete(path)
    if (!draft) return null
    const entry = await this.app.vault.create(draft.path, draft.text)
    await draft.after?.(entry)
    return entry
  }
}
