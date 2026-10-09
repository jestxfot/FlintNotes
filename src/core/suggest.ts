/** A pick-one-of-many dialog with a filter field, as used by the command palette. */
export interface SuggestOptions<T> {
  placeholder?: string
  /** Items matching the typed text, best first. */
  items(query: string): T[]
  label(item: T): string
  /** Secondary text shown on the right. */
  detail?(item: T): string | undefined
  onChoose(item: T): void
  /** The dialog was closed without a choice. */
  onCancel?(): void
  /** If set, the typed text can be turned into a new item when nothing has that label. */
  onCreate?(query: string): void
  createLabel?(query: string): string
}
