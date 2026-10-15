import type { ExternalPluginInfo } from '../../shared/protocol'
import type { App } from './app'
import { Events } from './events'
import { errorMessage } from './notice'
import type { Plugin, PluginClass, PluginManifest } from './plugin'

/** What a built-in plugin's `manifest.ts` exports; its id is its folder name. */
export type BuiltinManifest = Omit<PluginManifest, 'id' | 'builtin'>

// Every folder in `src/plugins` is a built-in plugin. Manifests are bundled with
// the app to list the plugins; the code of each one is fetched only when enabled.
const manifests = import.meta.glob<BuiltinManifest>('../plugins/*/manifest.ts', {
  eager: true,
  import: 'default',
})
// Partial: a folder may hold a manifest but no `index.ts` yet.
const loaders: Partial<Record<string, () => Promise<PluginClass>>> = import.meta.glob<PluginClass>(
  '../plugins/*/index.ts',
  { import: 'default' },
)

const folderOf = (file: string) => file.split('/').at(-2)!

interface Available {
  manifest: PluginManifest
  load: () => Promise<PluginClass>
}

export class PluginManager extends Events<{ change: [] }> {
  private available = new Map<string, Available>()
  private active = new Map<string, Plugin>()
  private busy = new Set<string>()

  constructor(private app: App) {
    super()
  }

  /**
   * Starts fetching the code of the built-in plugins that are enabled, without
   * waiting for it. Called as early as the settings are known, so the code
   * arrives while the rest of the app is still starting.
   */
  preload(): void {
    for (const id of this.app.settings.get<string[] | undefined>('core', 'enabledPlugins') ?? []) {
      const file = Object.keys(loaders).find((key) => folderOf(key) === id)
      // A failure here is reported when the plugin is actually enabled.
      if (file) void loaders[file]!().catch(() => {})
    }
  }

  /** Finds all plugins and enables the ones that were on in the previous session. */
  /** How long each plugin took to arrive and to start, in milliseconds: what to look at when starting up is slow. */
  readonly timings = new Map<string, { load: number; start: number }>()

  async init(): Promise<void> {
    for (const [file, manifest] of Object.entries(manifests)) {
      const id = folderOf(file)
      const load = loaders[file.replace(/manifest\.ts$/, 'index.ts')]
      if (load) this.available.set(id, { manifest: { ...manifest, id, builtin: true }, load })
    }
    for (const info of await this.findExternal()) {
      if (this.available.has(info.id)) continue
      const source = this.app.vault.url(`.flint/plugins/${info.id}/main.js`)
      this.available.set(info.id, {
        manifest: { ...info, name: info.name ?? info.id, builtin: false },
        load: async () => (await import(/* @vite-ignore */ source)).default,
      })
    }
    // Switching a plugin on and off is an action like any other, so it is a command.
    for (const { manifest } of this.available.values()) {
      this.app.commands.add({
        id: `core:toggle-plugin:${manifest.id}`,
        name: `Включить или выключить плагин «${manifest.name}»`,
        icon: 'puzzle',
        callback: () => (this.active.has(manifest.id) ? this.disable(manifest.id) : void this.enable(manifest.id)),
      })
    }
    const enabled = this.app.settings.get<string[] | undefined>('core', 'enabledPlugins') ?? []
    await Promise.all(enabled.map((id) => this.enable(id, false)))
  }

  list(): { manifest: PluginManifest; enabled: boolean }[] {
    return [...this.available.values()].map(({ manifest }) => ({
      manifest,
      enabled: this.active.has(manifest.id),
    }))
  }

  async enable(id: string, persist = true): Promise<void> {
    const entry = this.available.get(id)
    if (!entry || this.active.has(id) || this.busy.has(id)) return
    this.busy.add(id)
    let plugin: Plugin | undefined
    try {
      const began = performance.now()
      const PluginClass = await entry.load()
      const loaded = performance.now()
      plugin = new PluginClass(this.app, entry.manifest)
      await plugin.onload()
      this.timings.set(id, { load: Math.round(loaded - began), start: Math.round(performance.now() - loaded) })
      this.active.set(id, plugin)
    } catch (err) {
      // Undo whatever the plugin managed to register before it failed.
      plugin?.unload()
      console.error(err)
      this.app.notice(`Плагин «${entry.manifest.name}» не загрузился: ${errorMessage(err)}`)
    } finally {
      this.busy.delete(id)
    }
    this.changed(persist)
  }

  disable(id: string): void {
    const plugin = this.active.get(id)
    if (!plugin) return
    this.active.delete(id)
    try {
      plugin.unload()
    } catch (err) {
      console.error(err)
    }
    this.changed(true)
  }

  private changed(persist: boolean): void {
    if (persist) this.app.settings.set('core', 'enabledPlugins', [...this.active.keys()])
    this.trigger('change')
  }

  private async findExternal(): Promise<ExternalPluginInfo[]> {
    try {
      return await this.app.vault.externalPlugins()
    } catch {
      return []
    }
  }
}
