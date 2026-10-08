import { Events } from '../../api'

/** The tag picked in the editor, shared between the plugin and its panel. */
export class TagSelection extends Events<{ change: [] }> {
  selected: string | null = null

  select(tag: string): void {
    this.selected = tag.toLowerCase()
    this.trigger('change')
  }
}
