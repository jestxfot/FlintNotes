/**
 * Public API. Built-in plugins import from here; plugins loaded from the vault
 * get the same object as the global `flint`.
 */
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
export { filePath } from './core/editor/state'
export { Events, type Off } from './core/events'
export { openLink, resolvePath } from './core/links'
export { errorMessage, notice } from './core/notice'
export * as path from './core/path'
export { Plugin, type PluginManifest } from './core/plugin'
export type { BuiltinManifest } from './core/plugin-manager'
export type { SettingDef } from './core/settings'
export type { VaultEntry } from './core/vault'
export type { FileView, Leaf, ViewContext, ViewCreator } from './core/workspace'

/**
 * The app's own CodeMirror modules. Vault plugins must use these instead of
 * bundling their own copy: CodeMirror extensions only work with the instance
 * that created the editor.
 */
export const cm = { commands, language, state, view }
