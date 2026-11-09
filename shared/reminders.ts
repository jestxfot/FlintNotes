/** The renderer sends text only; opening a task stays in the plugin. */
export interface ReminderNotice {
  key: string
  title: string
  body: string
}

export interface ReminderPresentation {
  system: boolean
  items: ReminderNotice[]
}
