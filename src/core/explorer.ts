import { Events, type Off } from './events'
import type { VaultEntry } from './vault'

type Hide = (entry: VaultEntry) => boolean
type Decorate = (entry: VaultEntry) => string | undefined
type FolderClick = (entry: VaultEntry, event: MouseEvent) => boolean

/**
 * What plugins may say about the list of files and the path above a note,
 * without knowing how either is drawn: which entries are not listed, which
 * get a look of their own (CSS classes), and what a click on a folder's name
 * does. The core draws; plugins only answer these questions.
 */
export class Explorer extends Events<{ change: [] }> {
  private hides: Hide[] = []
  private decorators: Decorate[] = []
  private clicks: FolderClick[] = []
  private pins: Hide[] = []

  private add<T>(list: T[], item: T): Off {
    list.push(item)
    this.trigger('change')
    return () => {
      list.splice(list.indexOf(item), 1)
      this.trigger('change')
    }
  }

  /** Entries for which `test` is true are left out of the list of files. */
  hide(test: Hide): Off {
    return this.add(this.hides, test)
  }

  /** Entries for which `test` is true are listed first in their folder, before the rest. */
  pin(test: Hide): Off {
    return this.add(this.pins, test)
  }

  pinned(entry: VaultEntry): boolean {
    return this.pins.some((test) => test(entry))
  }

  /** Gives entries CSS classes (space-separated), in the list of files and in the path above a note. */
  decorate(decorator: Decorate): Off {
    return this.add(this.decorators, decorator)
  }

  /** Handles a click on a folder's name; returns `true` if the folder should not also be opened or closed. */
  onFolderClick(handler: FolderClick): Off {
    return this.add(this.clicks, handler)
  }

  /** The answers changed (a setting, a file): the list is drawn again. */
  refresh(): void {
    this.trigger('change')
  }

  hidden(entry: VaultEntry): boolean {
    return this.hides.some((test) => test(entry))
  }

  classes(entry: VaultEntry): string {
    return this.decorators.map((decorator) => decorator(entry)).filter(Boolean).join(' ')
  }

  folderClick(entry: VaultEntry, event: MouseEvent): boolean {
    return this.clicks.some((handler) => handler(entry, event))
  }
}
