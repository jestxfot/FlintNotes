import { Events, type Off } from './events'

export interface Command {
  id: string
  name: string
  /**
   * Shortcut such as `Mod+Shift+P`. `Mod` is Ctrl (Cmd on macOS). Letters and
   * digits are written as themselves, other keys by their `KeyboardEvent.code`
   * (`Comma`, `Backslash`).
   */
  hotkey?: string
  callback: () => void
}

const isMac = navigator.platform.startsWith('Mac')

/** Shortcut pressed in a keyboard event, in the same notation as `Command.hotkey`. */
function eventHotkey(event: KeyboardEvent): string {
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

export class Commands extends Events<{ change: [] }> {
  private commands = new Map<string, Command>()

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
    const command = this.list().find((c) => c.hotkey === pressed)
    if (!command) return false
    event.preventDefault()
    event.stopPropagation()
    command.callback()
    return true
  }
}
