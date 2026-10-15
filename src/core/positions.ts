import type { Vault } from './vault'
import type { VaultState } from './state'

/** Where a note was left: the cursor (or selection) and the place at the top of the screen. */
export interface NotePosition {
  anchor: number
  head: number
  /** Document position of the first line seen at the top of the editor. */
  top: number
}

const KEY = 'note-positions'
/** How many notes' places are kept: the oldest give way. */
const KEEP = 500

/**
 * The place each note was left at, so that a note opens where it was left:
 * by Back and Forward, from the file list, from anywhere. Kept with the
 * vault's state, so it lasts from one visit to the next.
 */
export class NotePositions {
  private places: Map<string, NotePosition> | null = null

  constructor(
    private state: VaultState,
    vault: Vault,
  ) {
    vault.on('rename', (entry, from) => {
      const place = this.all().get(from)
      if (!place) return
      this.all().delete(from)
      this.put(entry.path, place)
    })
    vault.on('delete', (entry) => this.all().delete(entry.path) && this.save())
  }

  private all(): Map<string, NotePosition> {
    if (!this.places) {
      const saved = this.state.get<[string, NotePosition][]>(KEY, [])
      this.places = new Map(Array.isArray(saved) ? saved : [])
    }
    return this.places
  }

  get(path: string): NotePosition | undefined {
    return this.all().get(path)
  }

  put(path: string, place: NotePosition): void {
    const all = this.all()
    // The latest goes last: the order is the order of use, and the oldest are dropped first.
    all.delete(path)
    all.set(path, place)
    while (all.size > KEEP) all.delete(all.keys().next().value!)
    this.save()
  }

  private save(): void {
    this.state.set(KEY, [...this.all()])
  }
}
