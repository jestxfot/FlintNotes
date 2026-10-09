import { errorMessage, notice } from './notice'
import type { Vault } from './vault'

const FILE = '.flint/workspace.json'

/**
 * How the app was left: open tabs, expanded folders, where the widgets are.
 * Kept in the vault itself (`.flint/workspace.json`), next to its settings, so
 * every vault comes back the way it was, on any browser.
 */
export class VaultState {
  private data: Record<string, unknown> = {}
  private timer: ReturnType<typeof setTimeout> | undefined
  private dirty = false

  constructor(private vault: Vault) {}

  async load(): Promise<void> {
    try {
      this.data = JSON.parse((await this.vault.readOptional(FILE)) ?? '{}')
    } catch {
      // An unreadable state file only costs the remembered layout.
      this.data = {}
    }
  }

  get<T>(key: string, fallback: T): T {
    return Object.hasOwn(this.data, key) ? (this.data[key] as T) : fallback
  }

  set(key: string, value: unknown): void {
    const json = JSON.stringify(value)
    if (JSON.stringify(this.data[key]) === json) return
    // A copy: the caller may go on changing its own object, and the next
    // comparison must see that as a change.
    this.data[key] = JSON.parse(json)
    this.dirty = true
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 500)
  }

  /** Writes pending changes now. `unloading` means the page is closing. */
  async flush(unloading = false): Promise<void> {
    clearTimeout(this.timer)
    if (!this.dirty) return
    this.dirty = false
    try {
      await this.vault.write(FILE, JSON.stringify(this.data, null, 2), { keepalive: unloading })
    } catch (err) {
      if (!unloading) notice(`Не удалось сохранить раскладку: ${errorMessage(err)}`)
    }
  }
}
