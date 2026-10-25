import { Events, type Off } from './events'

/** A button somewhere in the app's frame. */
export interface ToolbarButton {
  id: string
  /** A Lucide icon name, a custom icon, or an emoji; see `Icons.draw`. */
  icon: string
  title: string
  /** A colour name of the palette or any CSS colour. */
  color?: string
  onClick(event: MouseEvent): void
}

/**
 * Where buttons can be put: the strips along the left and right edges, the
 * tab strip, the header above a note, the header of the file list, the bar over a phone's keyboard.
 */
export type ToolbarPlace = 'left-ribbon' | 'right-ribbon' | 'tab-bar' | 'page-header' | 'explorer' | 'keyboard'

/**
 * Buttons that plugins put into the app's frame. The core only shows them and
 * knows nothing about what they do; a right click on a strip or on a button
 * opens the `toolbar` menu, to which plugins add their items.
 */
export class Toolbars extends Events<{ change: [] }> {
  private buttons = new Map<ToolbarPlace, ToolbarButton[]>()

  add(place: ToolbarPlace, button: ToolbarButton): Off {
    this.buttons.set(place, [...this.list(place), button])
    this.trigger('change')
    return () => {
      this.buttons.set(place, this.list(place).filter((b) => b !== button))
      this.trigger('change')
    }
  }

  list(place: ToolbarPlace): ToolbarButton[] {
    return this.buttons.get(place) ?? []
  }
}
