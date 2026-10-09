import { Events, type Off } from './events'
import { errorMessage, notice } from './notice'
import type { Vault } from './vault'

interface SettingBase {
  key: string
  name: string
  desc?: string
}

/** Declarative description of one setting; the settings screen renders it. */
export type SettingDef = SettingBase &
  (
    | { type: 'toggle'; default: boolean }
    | { type: 'text'; default: string; placeholder?: string }
    /** Several lines of text, one item or rule per line. */
    | { type: 'lines'; default: string; placeholder?: string }
    | { type: 'number'; default: number; min?: number; max?: number; step?: number }
    | { type: 'select'; default: string; options: { value: string; label: string }[] }
  )

export interface SettingsSection {
  /** Scope the values are stored under: `core` or a plugin id. */
  id: string
  title: string
  defs: SettingDef[]
}

type SettingsEvents = {
  change: [scope: string, key: string]
  sections: []
}

const FILE = '.flint/settings.json'

/** All settings of the app and its plugins, stored in the vault as `.flint/settings.json`. */
export class Settings extends Events<SettingsEvents> {
  private data: Record<string, Record<string, unknown>> = {}
  private sections = new Map<string, SettingsSection>()
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private vault: Vault) {
    super()
  }

  async load(): Promise<void> {
    const raw = await this.vault.readOptional(FILE)
    if (!raw) return
    try {
      this.data = JSON.parse(raw)
    } catch {
      // Keep the unreadable file: the next save would otherwise overwrite it.
      await this.vault.write('.flint/settings.broken.json', raw)
      notice('Файл настроек повреждён. Он сохранён как settings.broken.json, настройки сброшены.')
    }
  }

  /** Stored value, or the default declared for this key. */
  get<T>(scope: string, key: string): T {
    const stored = this.data[scope]?.[key]
    if (stored !== undefined) return stored as T
    return this.sections.get(scope)?.defs.find((def) => def.key === key)?.default as T
  }

  set(scope: string, key: string, value: unknown): void {
    ;(this.data[scope] ??= {})[key] = value
    this.trigger('change', scope, key)
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.vault
        .write(FILE, JSON.stringify(this.data, null, 2))
        .catch((err) => notice(`Не удалось сохранить настройки: ${errorMessage(err)}`))
    }, 300)
  }

  addSection(section: SettingsSection): Off {
    this.sections.set(section.id, section)
    this.trigger('sections')
    return () => {
      this.sections.delete(section.id)
      this.trigger('sections')
    }
  }

  listSections(): SettingsSection[] {
    return [...this.sections.values()]
  }
}
