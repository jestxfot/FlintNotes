import { Events, type Off } from './events'

export type CommandScope = 'note' | 'insert' | 'vault' | 'sidebar'

export interface Command {
  id: string
  name: string
  /**
   * Shortcut such as `Mod+Shift+P`. `Mod` is Ctrl (Cmd on macOS). Letters and
   * digits are written as themselves, other keys by their `KeyboardEvent.code`
   * (`Comma`, `Backslash`).
   */
  hotkey?: string
  /** A Lucide icon name, for a button that runs the command. */
  icon?: string
  /**
   * What the command acts on. This is the language plugins and the core share: a
   * command only says what it is for, and the core puts it where such actions are
   * offered. `note`: the open note (its "⋮" menu). `insert`: puts something into
   * the open note (the "Вставить" list of that menu). `vault`: the whole vault
   * (the menu at the bottom of the left sidebar). `sidebar`: the side panels
   * (the menu of a sidebar's empty space). Without it the command is offered
   * in the command palette only.
   */
  scope?: CommandScope
  callback: () => void
}

const isMac = navigator.platform.startsWith('Mac')

/** Shortcut pressed in a keyboard event, in the same notation as `Command.hotkey`. */
export function eventHotkey(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  // `code` names the physical key, so shortcuts work in any keyboard layout
  // (Ctrl+P stays Ctrl+P while typing in Russian).
  parts.push(event.code.replace(/^(Key|Digit)/, ''))
  return parts.join('+')
}

const KEY_LABELS: Record<string, string> = { Mod: isMac ? '⌘' : 'Ctrl', Comma: ',', Backslash: '\\' }

export const formatHotkey = (hotkey: string) =>
  hotkey
    .split('+')
    .map((part) => KEY_LABELS[part] ?? part)
    .join('+')

/**
 * Everything the app can do. Each action of the core and of every plugin is
 * registered here as a command; that is what makes it available in the command
 * palette, bindable to a shortcut, and usable for a button the user puts
 * somewhere. An action that is not a command can be reached by none of these.
 */
export class Commands extends Events<{ change: [] }> {
  private commands = new Map<string, Command>()
  /** Shortcuts the user chose: command id -> shortcut, or `''` for "none". */
  private custom: Record<string, string> = {}

  /** Takes the user's shortcuts (from the settings). */
  setCustomHotkeys(custom: Record<string, string>): void {
    this.custom = { ...custom }
    this.trigger('change')
  }

  customHotkeys(): Record<string, string> {
    return { ...this.custom }
  }

  /** The shortcut a command answers to now: the user's, or its own. */
  hotkeyOf(command: Command): string | undefined {
    return Object.hasOwn(this.custom, command.id) ? this.custom[command.id] || undefined : command.hotkey
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)
  }

  /** Runs a command by id; `false` if there is none (its plugin is switched off). */
  run(id: string): boolean {
    const command = this.commands.get(id)
    command?.callback()
    return !!command
  }

  add(command: Command): Off {
    this.commands.set(command.id, command)
    this.trigger('change')
    return () => {
      this.commands.delete(command.id)
      this.trigger('change')
    }
  }

  list(): Command[] {
    return [...this.commands.values()]
  }

  /** Runs the command bound to the pressed shortcut. Returns whether one was found. */
  handleKey(event: KeyboardEvent): boolean {
    const pressed = eventHotkey(event)
    const command = this.list().find((c) => this.hotkeyOf(c) === pressed)
    if (!command) return false
    event.preventDefault()
    event.stopPropagation()
    command.callback()
    return true
  }
}
