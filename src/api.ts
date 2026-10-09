/**
 * Public API. Built-in plugins import from here; plugins loaded from the vault
 * get the same object as the global `flint`.
 *
 * Two rules hold for every plugin:
 * - it lives in its own folder and reaches the core only through this file;
 * - every action it offers is a command (`Plugin.addCommand`), so the user can
 *   run it from the palette, give it a shortcut and put a button for it
 *   anywhere. See the `Plugin` class.
 */
import * as autocomplete from '@codemirror/autocomplete'
import * as commands from '@codemirror/commands'
import * as language from '@codemirror/language'
import * as state from '@codemirror/state'
import * as view from '@codemirror/view'

export type { App } from './core/app'
export type { Command } from './core/commands'
export type {
  CodeBlockContext,
  CodeBlockInstance,
  CodeBlockProcessor,
  PreviewRenderer,
  RenderContext,
} from './core/editor/live-preview'
export { ImageWidget } from './core/editor/live-preview/elements/images'
export { EmbedWidget } from './core/editor/live-preview/embed'
export { createPreview, type Preview } from './core/editor/preview'
export { embedDepth, filePath, staticPreview } from './core/editor/state'
export type { EmbedContext, EmbedRenderer } from './core/embeds'
export { Events, type Off } from './core/events'
export * as expr from './core/expr'
export { fileRef, propertyValue } from './core/files'
export { setProperties, setYamlValue } from './core/frontmatter'
export { renderInline } from './core/inline'
export { openLink, resolvePath } from './core/links'
export { parseMarkdown, type AffectedLinks, type CachedMetadata, type HeadingRef, type LinkRef } from './core/metadata'
export { moment, Moment, parseIsoDuration, type MomentInput } from './core/moment'
export { errorMessage, notice } from './core/notice'
export type { PanelDef } from './core/panels'
export * as path from './core/path'
export { Plugin, type PluginManifest } from './core/plugin'
export type { BuiltinManifest } from './core/plugin-manager'
export type { SettingDef } from './core/settings'
export type { SuggestOptions } from './core/suggest'
export { plural } from './core/text'
export { expandVariables } from './core/variables'
export type { Draft } from './core/creation'
export { pickLook } from './core/icon-picker'
export { pictureToSvg } from './core/icons'
export type { Look, LookKind } from './core/icons'
export type { ToolbarButton, ToolbarPlace } from './core/toolbars'
export type { MenuItem } from './core/menu'
export type { VaultEntry, VaultInfo } from './core/vault'
export type { FileView, Leaf, ViewContext, ViewCreator } from './core/workspace'

/**
 * The app's own CodeMirror modules. Vault plugins must use these instead of
 * bundling their own copy: CodeMirror extensions only work with the instance
 * that created the editor.
 */
export const cm = { autocomplete, commands, language, state, view }

/** For panels written in Svelte: re-reads a value when the named events fire. */
export { watch } from './ui/reactive.svelte'
