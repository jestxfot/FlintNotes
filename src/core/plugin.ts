import type { CompletionSource } from '@codemirror/autocomplete'
import { EditorState, type Extension } from '@codemirror/state'
import type { MarkdownConfig } from '@lezer/markdown'
import type { App } from './app'
import type { Command } from './commands'
import type { CodeBlockProcessor, PreviewRenderer } from './editor/live-preview'
import type { EmbedRenderer } from './embeds'
import type { Off } from './events'
import type { MenuItem } from './menu'
import type { ToolbarButton, ToolbarPlace } from './toolbars'
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
 *
 * THE RULE OF COMMANDS. Every action a plugin offers must be registered with
 * `addCommand`: opening its view or panel, creating, inserting, toggling, going
 * somewhere. Buttons, menu items and shortcuts then call that command (or share
 * its function) instead of having code of their own. Only a command can be run
 * from the command palette, given a shortcut by the user, or bound to a button
 * the user places in the app's frame, so an action that is not a command is
 * out of the user's reach. `addPanel` and `addInsertCommand` register theirs
 * themselves.
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

  /** Registers an action of the plugin; see the rule of commands above. Its id gets the plugin's id in front. */
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

  /** Adds a panel to the left or right sidebar, and a command that brings it to the front. */
  addPanel(panel: PanelDef): void {
    this.register(this.app.panels.add(panel))
    this.addCommand({ id: `show-${panel.id}`, name: `Показать панель «${panel.title}»`, callback: () => this.app.panels.reveal(panel.id) })
  }

  /** Puts a button into the app's frame; see `Toolbars`. */
  addToolbarButton(place: ToolbarPlace, button: ToolbarButton): Off {
    const off = this.app.toolbars.add(place, button)
    this.register(off)
    return off
  }

  /**
   * Adds a command that inserts text at the cursor: the usual way to offer
   * "insert a block of mine". `|` in the text marks where the cursor goes.
   */
  addInsertCommand(id: string, name: string, text: string, icon?: string): void {
    this.addCommand({
      id,
      name,
      icon,
      callback: () => {
        const editor = this.app.workspace.activeEditor
        if (!editor) return this.app.notice('Откройте заметку, чтобы вставить в неё блок')
        const { from, to } = editor.state.selection.main
        const line = editor.state.doc.lineAt(from)
        // A block starts on a line of its own.
        const prefix = from === to && line.text.trim() ? '\n' : ''
        const at = text.indexOf('|')
        const insert = prefix + text.replace('|', '')
        editor.dispatch({ changes: { from, to, insert }, selection: { anchor: from + prefix.length + (at < 0 ? insert.length - prefix.length : at) } })
        editor.focus()
      },
    })
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

  /** Renders a block-level syntax element (e.g. `Table`) as UI; see `CodeBlockProcessor`. */
  registerBlockRenderer(nodeName: string, processor: CodeBlockProcessor): void {
    this.register(this.app.livePreview.addBlockRenderer(nodeName, processor))
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

  /** Adds items to context menus of a kind (`file`, `tab`, `tag`, `property`); see `Menus`. */
  registerMenu(kind: string, provider: (target: any, add: (item: MenuItem) => void) => void): void {
    this.register(this.app.menus.register(kind, provider))
  }

  /** Offers something to other plugins under a name; see `Services`. */
  provide(name: string, service: unknown): void {
    this.register(this.app.services.provide(name, service))
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
