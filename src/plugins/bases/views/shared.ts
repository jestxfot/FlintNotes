import { expr, type App } from '../../../api'
import type { BaseEngine, Group, Row, ViewResult } from '../engine'
import type { ViewConfig } from '../model'

/** What a view gets to draw itself and to change data. */
export interface ViewContext {
  app: App
  engine: BaseEngine
  view: ViewConfig
  /** The records to draw: all of them, or the first part of a long list. */
  result: ViewResult
  /** All the records of the view, for what is counted over the whole of it (totals under a table). */
  total?: ViewResult
  /** The properties to show. */
  columns: string[]
  /** The note containing the base. */
  sourcePath: string
  /** Changes this view's settings in the base's text. */
  updateView(changes: Partial<ViewConfig>): void
  /** Writes a property into a note's frontmatter; `undefined` removes it. */
  setProperty(row: Row, key: string, value: unknown): void
}

export type ViewRenderer = (ctx: ViewContext) => HTMLElement

export const groupTitle = (ctx: ViewContext, group: Group): string => {
  if (group.key === null || group.key === undefined || group.key === '') return 'Без значения'
  return typeof group.key === 'boolean' ? (group.key ? 'Да' : 'Нет') : expr.toText(group.key)
}

export const isGrouped = (ctx: ViewContext) => ctx.result.groups.some((group) => group.key !== undefined)
