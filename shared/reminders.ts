/** The renderer sends text only; opening a task stays in the plugin. */
export interface ReminderNotice {
  key: string
  title: string
  body: string
}

/** One reminder as the separate alert window draws it: text and ready-made markup, nothing it can act on by itself. */
export interface AlertItem {
  key: string
  /** When it was due, in words: `25 ноября, 09:00`. */
  time: string
  /** The task's text, already rendered (links, icons) by the notes page. */
  html: string
  /** The note it comes from. */
  source: string
  /** The "overdue by a day" chip. */
  statusHtml: string
  /** A priority task: putting it off asks for a slide to confirm. */
  urgent: boolean
  /** A plain line: its button says "Готово" rather than "Выполнено". */
  plain: boolean
}

/** What the alert window shows, and the colours of the notes page so that it looks the same. */
export interface AlertModel {
  items: AlertItem[]
  /** The labels of "remind me later", in the order the page knows them by. */
  later: string[]
  theme: Record<string, string>
}

/** What the person did in the alert window; the notes page does it (it has the tasks and the settings). */
export type AlertAction =
  | { type: 'done' | 'open'; key: string }
  | { type: 'later'; key: string; option: number }
  | { type: 'all-later' }

export interface ReminderPresentation {
  items: ReminderNotice[]
  model?: AlertModel
}
