/** A pick-one-of-many dialog with a filter field, as used by the command palette. */
export interface SuggestOptions<T> {
  placeholder?: string
  /** Items matching the typed text, best first. */
  items(query: string): T[]
  label(item: T): string
  /** Secondary text shown on the right, or under the label in a `stacked` list. */
  detail?(item: T): string | undefined
  /** An icon in front of the item; see `Icons.draw`. */
  icon?(item: T): { icon?: string; color?: string } | undefined
  /** A big list for finding files: each item shows its detail (a folder) under its label, and the dialog takes most of the window. */
  stacked?: boolean
  /** A name under which the dialog keeps what was typed last, to open with it again (selected, so typing replaces it). */
  remember?: string
  onChoose(item: T): void
  /** The dialog was closed without a choice. */
  onCancel?(): void
  /** If set, the typed text can be turned into a new item when nothing has that label. */
  onCreate?(query: string): void
  createLabel?(query: string): string
}
