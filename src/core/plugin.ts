import type { CompletionSource } from '@codemirror/autocomplete'
import { EditorState, type Extension } from '@codemirror/state'
import type { MarkdownConfig } from '@lezer/markdown'
import type { App } from './app'
import type { Command } from './commands'
import type { CodeBlockProcessor, PreviewRenderer } from './editor/live-preview'
import type { EmbedRenderer } from './embeds'
import type { Off } from './events'
import type { PanelDef } from './panels'
import type { SettingDef } from './settings'
import type { ViewCreator } from './workspace'

export interface PluginManifest {
  id: string
  name: string
  description?: string
  version?: string
  author?: string
  /** Shipped with the app, as opposed to loaded from the vault's `.flint/plugins`. */
  builtin: boolean
}

/**
 * Base class of every plugin. Everything a plugin adds goes through the methods
 * below, which also record how to undo it, so disabling a plugin removes all of
 * its traces without the plugin writing any cleanup code.
 */
export abstract class Plugin {
  private cleanups: Off[] = []

  constructor(
    readonly app: App,
    readonly manifest: PluginManifest,
  ) {}

  /** Called when the plugin is enabled. Register everything here. */
  abstract onload(): void | Promise<void>

  /** Called when the plugin is disabled, before its registrations are undone. */
  onunload(): void {}

  /** Runs `off` when the plugin is disabled. Pass it whatever `.on(...)` returns. */
  register(off: Off): void {
    this.cleanups.push(off)
  }

  addCommand(command: Command): void {
    this.register(this.app.commands.add({ ...command, id: `${this.manifest.id}:${command.id}` }))
  }

  addStatusBarItem(): HTMLElement {
    const item = this.app.statusBar.addItem()
    this.register(() => item.remove())
    return item
  }

  /** Adds a CodeMirror extension to every Markdown editor, open ones included. */
  registerEditorExtension(extension: Extension): void {
    this.register(this.app.editor.add(extension))
  }

  /** Adds syntax to the Markdown parser, e.g. `[[wikilinks]]`. */
  registerMarkdownSyntax(config: MarkdownConfig): void {
    this.register(this.app.markdown.add(config))
  }

  /** Offers completions while typing in the editor. */
  registerCompletionSource(source: CompletionSource): void {
    this.registerEditorExtension(EditorState.languageData.of(() => [{ autocomplete: source }]))
  }

  /** Adds a panel to the left or right sidebar. */
  addPanel(panel: PanelDef): void {
    this.register(this.app.panels.add(panel))
  }

  /** Teaches Live Preview to draw a Markdown element. */
  registerPreviewRenderer(renderer: PreviewRenderer): void {
    this.register(this.app.livePreview.addRenderer(renderer))
  }

  /**
   * Renders fenced code blocks of the given language as UI, e.g. ```` ```table ````.
   * The block's text remains the data; see `CodeBlockProcessor`.
   */
  registerCodeBlockProcessor(lang: string, processor: CodeBlockProcessor): void {
    this.register(this.app.livePreview.addCodeBlockProcessor(lang, processor))
  }

  /** Draws `![[file]]` embeds of files with the given extensions. */
  registerEmbed(extensions: string[], renderer: EmbedRenderer): void {
    this.register(this.app.embeds.register(extensions, renderer))
  }

  /**
   * Makes files with the given extensions open in this view. With no extensions
   * the view shows no file and is opened with `workspace.openView`.
   */
  registerView(type: string, creator: ViewCreator, extensions: string[]): void {
    this.register(this.app.workspace.registerView(type, creator, extensions))
  }

  /** Declares the plugin's settings; they appear as a section of the settings screen. */
  addSettings(defs: SettingDef[]): void {
    const { id, name } = this.manifest
    this.register(this.app.settings.addSection({ id, title: name, defs }))
  }

  getSetting<T>(key: string): T {
    return this.app.settings.get<T>(this.manifest.id, key)
  }

  setSetting(key: string, value: unknown): void {
    this.app.settings.set(this.manifest.id, key, value)
  }

  onSettingChange(handler: (key: string) => void): void {
    this.register(
      this.app.settings.on('change', (scope, key) => {
        if (scope === this.manifest.id) handler(key)
      }),
    )
  }

  /** Used by the plugin manager; plugins don't call this. */
  unload(): void {
    try {
      this.onunload()
    } finally {
      for (const off of this.cleanups.reverse()) {
        try {
          off()
        } catch (err) {
          console.error(`Cleanup failed in plugin "${this.manifest.id}"`, err)
        }
      }
      this.cleanups = []
    }
  }
}

export type PluginClass = new (app: App, manifest: PluginManifest) => Plugin
