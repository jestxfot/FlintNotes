import { BlockType, layer, RectangleMarker, type BlockInfo, type EditorView } from '@codemirror/view'

/**
 * The selection, drawn over the note rather than under it, along what is
 * really on the page.
 *
 * CodeMirror paints the selection on a layer behind the text. Whatever in the
 * note has a background of its own (the lines of a code block, a table, a
 * callout, a card) covered it, so the selection there could not be seen, or
 * showed only as a strip beside the block. Its shapes are worked out from the
 * editor's own idea of the lines too, which is not where a code block's
 * lines, with their padding and smaller type, really are.
 *
 * Here it is a see-through layer above everything, and its shapes come from
 * the drawn page: a line selected whole is the box of that line (so a code
 * line is covered exactly as far as the block's background goes), a part of a
 * line is the boxes the browser gives for that text (wrapped rows included),
 * and a drawn block (a table, a card) is the box of the block. The layer
 * behind the text is left empty (see the theme).
 */

/** The element of the line at `pos`, if it is on the page. */
function lineElement(view: EditorView, pos: number): HTMLElement | null {
  try {
    const { node } = view.domAtPos(pos)
    const el = node instanceof HTMLElement ? node : node.parentElement
    return el?.closest<HTMLElement>('.cm-line') ?? null
  } catch {
    return null
  }
}

/** The boxes of the text between two positions, one per row it takes. */
function textRows(view: EditorView, from: number, to: number): DOMRect[] {
  try {
    const start = view.domAtPos(from)
    const end = view.domAtPos(to)
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    const rows: DOMRect[] = []
    for (const rect of range.getClientRects()) {
      if (rect.width < 0.5 && from !== to) continue
      // Boxes of one row (a word in bold, a link) become one.
      const row = rows.find((other) => Math.abs(other.top - rect.top) < 3 || (rect.top < other.bottom - 2 && rect.bottom > other.top + 2))
      if (row) {
        const left = Math.min(row.left, rect.left)
        const right = Math.max(row.right, rect.right)
        const top = Math.min(row.top, rect.top)
        const bottom = Math.max(row.bottom, rect.bottom)
        rows[rows.indexOf(row)] = new DOMRect(left, top, right - left, bottom - top)
      } else rows.push(DOMRect.fromRect(rect))
    }
    return rows.sort((a, b) => a.top - b.top)
  } catch {
    return []
  }
}

function shapes(view: EditorView): RectangleMarker[] {
  const boxes: { left: number; top: number; right: number; bottom: number }[] = []
  const scroller = view.scrollDOM.getBoundingClientRect()
  // Places on the layer are measured from the scrolled content's corner.
  const baseLeft = scroller.left - view.scrollDOM.scrollLeft
  const baseTop = scroller.top - view.scrollDOM.scrollTop
  const content = view.contentDOM.getBoundingClientRect()
  const style = getComputedStyle(view.contentDOM)
  const textLeft = content.left + parseFloat(style.paddingLeft)
  const textRight = content.right - parseFloat(style.paddingRight)
  const add = (left: number, top: number, right: number, bottom: number) => {
    if (right - left > 0.5 && bottom - top > 0.5) boxes.push({ left: Math.round(left - baseLeft), top: Math.round(top - baseTop), right: Math.round(right - baseLeft), bottom: Math.round(bottom - baseTop) })
  }

  for (const range of view.state.selection.ranges) {
    if (range.empty) continue
    for (const block of view.viewportLineBlocks) {
      if (block.to < range.from || block.from > range.to) continue
      if (block.to === range.from && block.from !== block.to) continue
      // A drawn block (a table, a card, a picture) is covered whole.
      if (!isTextLine(block)) {
        add(textLeft, view.documentTop + block.top, textRight, view.documentTop + block.bottom)
        continue
      }
      const line = lineElement(view, block.from)
      const box = line?.getBoundingClientRect()
      const from = Math.max(range.from, block.from)
      const to = Math.min(range.to, block.to)
      const throughEnd = range.to > block.to
      if (!line || !box) {
        add(textLeft, view.documentTop + block.top, textRight, view.documentTop + block.bottom)
        continue
      }
      const lineStyle = getComputedStyle(line)
      const innerTop = box.top + parseFloat(lineStyle.paddingTop)
      const innerBottom = box.bottom - parseFloat(lineStyle.paddingBottom)
      // Where the selection goes on past the end of a line, its line break shows as a short piece after the text.
      const nub = throughEnd ? (parseFloat(lineStyle.fontSize) || 16) * 0.45 : 0
      const rows = from < to ? textRows(view, from, to) : []
      if (!rows.length) {
        // No text of the line is selected (an empty line, or only its end): the short piece alone.
        const at = view.coordsAtPos(from)
        if (at && nub) add(at.left, innerTop, at.left + nub, innerBottom)
        continue
      }
      // The text itself is covered, row by row; each row reaches from the line's top to its bottom,
      // so that rows following one another have no gaps between them.
      const lineHeight = parseFloat(lineStyle.lineHeight) || rows[0].height
      rows.forEach((row, i) => {
        const pad = Math.max(0, (lineHeight - row.height) / 2)
        const top = i === 0 ? Math.max(innerTop, row.top - pad) : row.top - pad
        const bottom = i === rows.length - 1 ? Math.min(innerBottom, row.bottom + pad) : row.bottom + pad
        add(row.left, Math.min(top, row.top), row.right + (i === rows.length - 1 ? nub : 0), Math.max(bottom, row.bottom))
      })
    }
  }
  // Shapes that meet do not overlap: the see-through colour laid twice would show as a darker seam.
  boxes.sort((a, b) => a.top - b.top || a.left - b.left)
  for (let i = 1; i < boxes.length; i++) {
    for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
      const [above, box] = [boxes[j], boxes[i]]
      if (box.top < above.bottom && box.left < above.right && box.right > above.left) box.top = Math.min(above.bottom, box.bottom)
    }
  }
  return boxes.filter((box) => box.bottom > box.top).map((box) => new RectangleMarker('flint-selection', box.left, box.top, box.right - box.left, box.bottom - box.top))
}

function isTextLine(block: BlockInfo): boolean {
  return block.type === BlockType.Text || Array.isArray(block.type)
}

export const selectionOverlay = layer({
  above: true,
  class: 'flint-selection-layer',
  markers: shapes,
  update(update) {
    return update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged || update.focusChanged
  },
})
