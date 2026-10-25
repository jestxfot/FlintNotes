/** A button: which command it runs and how it looks. The fields are Commander's. */
export interface Pair {
  /** Id of the command. */
  id: string
  icon: string
  name: string
  mode: string
  color?: string
}

/** One step of a macro: `action: 0` runs a command, `action: 1` waits. */
export type Step = { action: 0; commandId: string } | { action: 1; delay: number }

export interface Macro {
  name: string
  icon: string
  macro: Step[]
}

export const PLACES = ['leftRibbon', 'rightRibbon', 'titleBar', 'pageHeader', 'explorer', 'statusBar', 'fileMenu', 'editorMenu', 'keyboardBar'] as const
export type Place = (typeof PLACES)[number]

export const PLACE_NAMES: Record<Place, string> = {
  leftRibbon: 'Полоса слева',
  rightRibbon: 'Полоса справа',
  titleBar: 'Полоса вкладок',
  pageHeader: 'Над заметкой',
  explorer: 'Список файлов',
  statusBar: 'Строка состояния',
  fileMenu: 'Меню файла',
  editorMenu: 'Меню редактора',
  keyboardBar: 'Над клавиатурой телефона',
}

/** The contents of the data file, laid out as Commander's `data.json`; fields not used here are kept. */
export type CommanderData = Record<Place, Pair[]> & { macros: Macro[] } & Record<string, unknown>

export const emptyData = (): CommanderData => ({ ...Object.fromEntries(PLACES.map((place) => [place, []])), macros: [] }) as unknown as CommanderData

/** Commands of Obsidian and its plugins that have a twin here, for taking over a Commander setup. */
const TWINS: Record<string, string> = {
  'daily-notes': 'daily-notes:today',
  'daily-notes:goto-next': 'daily-notes:next-day',
  'daily-notes:goto-prev': 'daily-notes:previous-day',
  'periodic-notes:open-daily-note': 'daily-notes:today',
  'periodic-notes:open-weekly-note': 'calendar:week',
  'periodic-notes:open-monthly-note': 'calendar:month',
  'graph:open': 'graph:open',
  'command-palette:open': 'core:command-palette',
  'switcher:open': 'quick-switcher:open',
  'global-search:open': 'search:open',
  'app:open-settings': 'core:settings',
  'app:toggle-left-sidebar': 'core:toggle-sidebar',
  'app:toggle-right-sidebar': 'core:toggle-right-sidebar',
  'app:go-back': 'core:go-back',
  'app:go-forward': 'core:go-forward',
  'app:open-help': 'core:help',
  'app:open-vault': 'core:vaults',
  'file-explorer:new-file': 'core:new-note',
  'file-explorer:reveal-active-file': 'core:reveal-active',
  'open-with-default-app:show': 'core:reveal-active',
  'workspace:close': 'core:close-tab',
  'workspace:next-tab': 'core:next-tab',
  'workspace:previous-tab': 'core:previous-tab',
  'editor:save-file': 'core:save',
  'editor:toggle-source': 'core:toggle-editor-mode',
  'insert-template': 'templates:insert',
  'templater-obsidian:insert-templater': 'templates:insert',
  'templater-obsidian:create-new-note-from-template': 'templates:create',
  'obsidian-tasks-plugin:edit-task': 'tasks:new',
  'webviewer:open': 'buttons:web-viewer',
}

/**
 * Commands a menu offers by itself. In Obsidian they come from plugins, so a
 * Commander setup may add them to the menu; here that would show them twice.
 */
const BUILT_IN: Partial<Record<Place, string[]>> = { fileMenu: ['core:reveal-active'] }

/** Takes out buttons that repeat what their place already has. Returns whether anything was removed. */
export function dropBuiltIn(data: CommanderData): boolean {
  let changed = false
  for (const [place, ids] of Object.entries(BUILT_IN) as [Place, string[]][]) {
    const kept = data[place].filter((pair) => !ids.includes(pair.id))
    changed ||= kept.length !== data[place].length
    data[place] = kept
  }
  return changed
}

/** Commands that moved to another plugin, under their old ids. */
const MOVED: Record<string, string> = {
  'calendar:today': 'daily-notes:today',
  'calendar:tomorrow': 'daily-notes:tomorrow',
  'calendar:yesterday': 'daily-notes:yesterday',
  'calendar:next-day': 'daily-notes:next-day',
  'calendar:previous-day': 'daily-notes:previous-day',
}

/** Points buttons and macro steps made for a command that moved at its new id. Returns whether anything was changed. */
export function renameMoved(data: CommanderData): boolean {
  let changed = false
  for (const place of PLACES) {
    for (const pair of data[place]) {
      if (!Object.hasOwn(MOVED, pair.id)) continue
      pair.id = MOVED[pair.id]
      changed = true
    }
  }
  for (const step of data.macros.flatMap((macro) => macro.macro)) {
    if (step.action !== 0 || !Object.hasOwn(MOVED, step.commandId)) continue
    step.commandId = MOVED[step.commandId]
    changed = true
  }
  return changed
}

/** Commander's setup with the commands that exist here; the rest is counted, not kept. */
export function importData(raw: unknown): { data: CommanderData; skipped: number } {
  const data = emptyData()
  let skipped = 0
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  for (const place of PLACES) {
    for (const pair of Array.isArray(source[place]) ? (source[place] as Pair[]) : []) {
      const twin = Object.hasOwn(TWINS, pair?.id) ? TWINS[pair.id] : undefined
      if (twin) data[place].push({ ...pair, id: twin })
      else skipped++
    }
  }
  dropBuiltIn(data)
  return { data, skipped }
}
