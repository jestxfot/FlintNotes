import { getSearchQuery, searchPanelOpen } from '@codemirror/search'
import { htmlBlock } from './elements/html'
import { syntaxTree } from '@codemirror/language'
import { Compartment, StateEffect, StateField, type EditorState, type Extension, type Line, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'
import type { App } from '../../app'
import type { Off } from '../../events'
import { errorMessage } from '../../notice'
import { filePath, staticPreview } from '../state'
import { builtinRenderers } from './elements'
import './style.css'

/**
 * Draws one kind of Markdown element in Live Preview. `render` is called for
 * every syntax node named in `nodes` that is on screen.
 */
export interface PreviewRenderer {
  name: string
  /** Syntax node names, e.g. `Emphasis` or `ATXHeading1`. */
  nodes: string[]
  /** Return `false` to keep the engine from visiting the node's children. */
  render(node: SyntaxNodeRef, ctx: RenderContext): void | false
  /** Extra editor behaviour the element needs, such as click handling. */
  extension?: Extension
}

export interface CodeBlockContext {
  app: App
  /** Vault path of the note containing the block. */
  path: string
  lang: string
  /** Replaces the block's text in the note. This is how the rendered UI saves edits. */
  setSource(source: string): void
}

/** What a processor may return to keep its UI alive across edits of the block. */
export interface CodeBlockInstance {
  /** The block's text changed. Without this the block is rendered from scratch. */
  update?(source: string): void
  destroy?(): void
}

/**
 * Renders a block of the note as UI inside `el`: a fenced code block of some
 * language, or a whole syntax element such as a table. The block's text stays
 * the source of truth: the UI is rebuilt from it and writes changes back
 * through `ctx.setSource`.
 */
export type CodeBlockProcessor = (source: string, el: HTMLElement, ctx: CodeBlockContext) => void | CodeBlockInstance

/** Whether what is selected is what the open search bar is looking for (it stepped there), not the user's own selection. */
function selectionIsFound(state: EditorState): boolean {
  if (!searchPanelOpen(state)) return false
  const query = getSearchQuery(state)
  if (!query.search || !query.valid) return false
  return state.selection.ranges.every((range) => {
    if (range.empty) return false
    const text = state.sliceDoc(range.from, range.to)
    if (query.regexp) return true
    return query.caseSensitive ? text === query.search : text.toLowerCase() === query.search.toLowerCase()
  })
}

const hidden = Decoration.replace({})

const ruler = document.createElement('canvas').getContext('2d')
const widths = new Map<string, number>()

/** Asks the inline layer to redraw although the text did not change. */
const refresh = StateEffect.define<null>()

/**
 * Leaves out what is inside a range that a widget stands in for: `inline code` drawn as a computed
 * value has its backticks hidden and its text styled as code by one renderer, and is replaced whole
 * by another. Replacements that start at the same place are drawn in no fixed order, so now and
 * then the hidden backtick won and swallowed the widget: the value vanished after an edit.
 */
function withoutCovered(ranges: Range<Decoration>[]): Range<Decoration>[] {
  const isWidget = (range: Range<Decoration>) => range.from < range.to && (range.value.spec as { widget?: unknown }).widget !== undefined && !range.value.spec.block
  const widgets = ranges.filter(isWidget)
  if (!widgets.length) return ranges
  return ranges.filter((range) => range.from === range.to || isWidget(range) || !widgets.some((widget) => widget.from <= range.from && widget.to >= range.to))
}

/** Collects the decorations of one rendering pass and answers questions about the cursor. */
export class RenderContext {
  readonly ranges: Range<Decoration>[] = []
  /** Vault path of the note being rendered. */
  readonly path: string
  private static: boolean

  constructor(
    readonly state: EditorState,
    private viewport: { from: number; to: number },
    private preview: LivePreview,
    /** The editor's text font as a CSS `font` value, and its size in pixels. */
    private font: string,
    readonly em: number,
  ) {
    this.path = state.facet(filePath)
    this.static = state.facet(staticPreview)
  }

  text(from: number, to: number): string {
    return this.state.sliceDoc(from, to)
  }

  /** Whether the cursor or selection touches the range. Active elements show their source. */
  isActive(from: number, to: number): boolean {
    if (this.static) return false
    return this.state.selection.ranges.some((range) => range.from <= to && range.to >= from)
  }

  lineActive(pos: number): boolean {
    const line = this.state.doc.lineAt(pos)
    return this.isActive(line.from, line.to)
  }

  /** Whether a code block is shown as a processor's UI instead of text. */
  isRendered(node: SyntaxNode): boolean {
    return this.preview.blockAt(this.state, node) !== null
  }

  hide(from: number, to: number): void {
    if (this.inOneLine(from, to)) this.ranges.push(hidden.range(from, to))
  }

  replace(from: number, to: number, widget: WidgetType): void {
    if (this.inOneLine(from, to)) this.ranges.push(Decoration.replace({ widget }).range(from, to))
  }

  widget(pos: number, widget: WidgetType, side = 1): void {
    this.ranges.push(Decoration.widget({ widget, side }).range(pos))
  }

  mark(from: number, to: number, spec: { class?: string; attributes?: Record<string, string>; tagName?: string }): void {
    if (from < to) this.ranges.push(Decoration.mark(spec).range(from, to))
  }

  /** Adds a CSS class, and optionally inline styles, to the whole line containing `pos`. */
  line(pos: number, className: string, style?: string): void {
    const spec = { class: className, attributes: style ? { style } : undefined }
    this.ranges.push(Decoration.line(spec).range(this.state.doc.lineAt(pos).from))
  }

  /** Width in pixels that `text` takes in the editor's font. */
  measure(text: string): number {
    const key = `${this.font}\n${text}`
    let width = widths.get(key)
    if (width === undefined && ruler) {
      ruler.font = this.font
      widths.set(key, (width = ruler.measureText(text).width))
    }
    return width ?? text.length * this.em * 0.5
  }

  /** Calls `fn` for each line of the range that is on screen. */
  lines(from: number, to: number, fn: (line: Line) => void): void {
    const doc = this.state.doc
    const end = Math.min(to, this.viewport.to)
    let line = doc.lineAt(Math.max(from, this.viewport.from))
    while (line.from <= end) {
      fn(line)
      if (line.number === doc.lines) break
      line = doc.line(line.number + 1)
    }
  }

  // This layer may not replace line breaks (CodeMirror throws), so such ranges are skipped.
  private inOneLine(from: number, to: number): boolean {
    return from < to && this.state.doc.lineAt(from).to >= to
  }
}

interface CodeBlock {
  lang: string
  source: string
  /** Where the text between the fences is, or where to insert it if there is none. */
  from: number
  to: number
  empty: boolean
}

/** Reads a fenced code block, or `null` while its closing fence is missing. */
function readCodeBlock(state: EditorState, node: SyntaxNode): CodeBlock | null {
  if (node.getChildren('CodeMark').length < 2) return null
  const info = node.getChild('CodeInfo')
  const lang = info ? state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0].toLowerCase() : ''
  const text = node.getChildren('CodeText')
  if (!text.length) {
    const at = state.doc.lineAt(node.from).to
    return { lang, source: '', from: at, to: at, empty: true }
  }
  const from = text[0].from
  const to = text[text.length - 1].to
  return { lang, source: state.sliceDoc(from, to), from, to, empty: false }
}

// Blocks that can contain a fenced code block; nothing else needs to be searched.
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

interface Mounted {
  processor: CodeBlockProcessor
  lang: string
  path: string
  instance: CodeBlockInstance | void
}

const mounted = new WeakMap<HTMLElement, Mounted>()

class BlockWidget extends WidgetType {
  constructor(
    private preview: LivePreview,
    private app: App,
    readonly processor: CodeBlockProcessor,
    readonly lang: string,
    readonly source: string,
    readonly path: string,
  ) {
    super()
  }

  eq(other: BlockWidget): boolean {
    return this.sameBlock(other) && other.source === this.source
  }

  private sameBlock(other: { processor: CodeBlockProcessor; lang: string; path: string }): boolean {
    return other.processor === this.processor && other.lang === this.lang && other.path === this.path
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = 'lp-block'
    el.dataset.lang = this.lang
    const body = el.appendChild(document.createElement('div'))
    body.className = 'lp-block-body'

    const edit = el.appendChild(document.createElement('button'))
    edit.className = 'lp-block-edit'
    edit.title = 'Редактировать исходный текст'
    edit.textContent = '</>'
    edit.onclick = () => {
      const firstLine = view.state.doc.lineAt(view.posAtDOM(el))
      view.dispatch({ selection: { anchor: Math.min(firstLine.to + 1, view.state.doc.length) } })
      view.focus()
    }

    let instance: CodeBlockInstance | void = undefined
    try {
      instance = this.processor(this.source, body, {
        app: this.app,
        path: this.path,
        lang: this.lang,
        setSource: (source) => this.preview.writeBlock(view, el, source),
      })
    } catch (err) {
      console.error(err)
      body.className = 'lp-block-error'
      body.textContent = `Ошибка в блоке «${this.lang}»: ${errorMessage(err)}`
    }
    mounted.set(el, { processor: this.processor, lang: this.lang, path: this.path, instance })
    return el
  }

  // Called with the DOM of the widget this one replaces. Handing the new text to
  // the existing UI keeps its state (focus, scroll) when the block is edited.
  updateDOM(dom: HTMLElement): boolean {
    const current = mounted.get(dom)
    if (!current?.instance?.update || !this.sameBlock(current)) return false
    current.instance.update(this.source)
    return true
  }

  destroy(dom: HTMLElement): void {
    mounted.get(dom)?.instance?.destroy?.()
  }
}

/**
 * Live Preview: shows Markdown rendered in place and reveals the source of the
 * element under the cursor. Elements are drawn by renderers; fenced code blocks
 * of registered languages by code block processors.
 */
export class LivePreview {
  private renderers: PreviewRenderer[] = []
  private processors = new Map<string, CodeBlockProcessor>()
  private blockRenderers = new Map<string, CodeBlockProcessor>()
  private compartment = new Compartment()
  private enabled = true

  constructor(private app: App) {}

  init(): void {
    this.renderers.push(...builtinRenderers(this.app))
    // HTML written in a note is part of Markdown, so it is drawn without any plugin.
    this.blockRenderers.set('HTMLBlock', htmlBlock)
    this.enabled = this.app.settings.get<string>('core', 'editorMode') !== 'source'
    this.app.settings.on('change', (scope, key) => {
      if (scope !== 'core' || key !== 'editorMode') return
      this.enabled = this.app.settings.get<string>('core', 'editorMode') !== 'source'
      this.reconfigure()
    })
  }

  /** Include this in the state of every Markdown editor. */
  get extension(): Extension {
    return this.compartment.of(this.layers())
  }

  addRenderer(renderer: PreviewRenderer): Off {
    this.renderers.push(renderer)
    this.reconfigure()
    return () => {
      this.renderers.splice(this.renderers.indexOf(renderer), 1)
      this.reconfigure()
    }
  }

  addCodeBlockProcessor(lang: string, processor: CodeBlockProcessor): Off {
    const key = lang.toLowerCase()
    this.processors.set(key, processor)
    this.reconfigure()
    return () => {
      if (this.processors.get(key) === processor) this.processors.delete(key)
      this.reconfigure()
    }
  }

  /**
   * Renders every block-level syntax element of the given kind (e.g. `Table`)
   * as UI. The processor receives the element's full text and `lang: ''`.
   */
  addBlockRenderer(nodeName: string, processor: CodeBlockProcessor): Off {
    this.blockRenderers.set(nodeName, processor)
    this.reconfigure()
    return () => {
      if (this.blockRenderers.get(nodeName) === processor) this.blockRenderers.delete(nodeName)
      this.reconfigure()
    }
  }

  /** Redraws the elements, for renderers whose output depends on more than the text. */
  refresh(): void {
    this.app.editor.each((editor) => editor.dispatch({ effects: refresh.of(null) }))
  }

  /** The block and its processor if `node` is a code block currently shown as UI. */
  blockAt(state: EditorState, node: SyntaxNode): { block: CodeBlock; processor: CodeBlockProcessor } | null {
    const from = state.doc.lineAt(node.from).from
    const to = state.doc.lineAt(node.to).to
    let block: CodeBlock | null
    let processor: CodeBlockProcessor | undefined
    if (node.name === 'FencedCode') {
      block = readCodeBlock(state, node)
      processor = block ? this.processors.get(block.lang) : undefined
    } else {
      // Only elements that own their lines; one nested in a list or quote stays text.
      block = node.from === from ? { lang: '', source: state.sliceDoc(from, to), from, to, empty: false } : null
      processor = this.blockRenderers.get(node.name)
    }
    if (!block || !processor) return null
    if (state.facet(staticPreview)) return { block, processor }
    // The cursor anywhere on the block's lines switches it back to source. Not so a place a search
    // has just stepped to: a table stays a table while it is searched, and the place is lit in it.
    if (state.selection.ranges.some((range) => range.from <= to && range.to >= from) && !selectionIsFound(state)) return null
    return { block, processor }
  }

  /** Replaces the text of the code block rendered into `el`. */
  writeBlock(view: EditorView, el: HTMLElement, source: string): void {
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(view.posAtDOM(el), 1)
    while (node && node.name !== 'FencedCode' && !this.blockRenderers.has(node.name)) node = node.parent
    if (!node) return
    const block =
      node.name === 'FencedCode'
        ? readCodeBlock(view.state, node)
        : { from: view.state.doc.lineAt(node.from).from, to: view.state.doc.lineAt(node.to).to, empty: false }
    if (!block) return
    view.dispatch({ changes: { from: block.from, to: block.to, insert: block.empty ? `\n${source}` : source } })
  }

  // Registrations change rarely, so every change simply rebuilds the layers in all editors.
  private reconfigure(): void {
    this.app.editor.each((editor) => editor.dispatch({ effects: this.compartment.reconfigure(this.layers()) }))
  }

  private layers(): Extension {
    if (!this.enabled) return []
    const renderers = [...this.renderers]
    const byNode = new Map<string, PreviewRenderer[]>()
    for (const renderer of renderers) {
      for (const name of renderer.nodes) byNode.set(name, [...(byNode.get(name) ?? []), renderer])
    }

    /** The editor's font, asked from the browser (which costs a layout) only when it may have changed. */
    const fontOf = (view: EditorView) => {
      const style = getComputedStyle(view.contentDOM)
      return { font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, em: parseFloat(style.fontSize) }
    }

    const buildInline = (view: EditorView, { font, em }: { font: string; em: number }): DecorationSet => {
      const ctx = new RenderContext(view.state, view.viewport, this, font, em)
      const seen = new Set<string>()
      const tree = syntaxTree(view.state)
      for (const { from, to } of view.visibleRanges) {
        tree.iterate({
          from,
          to,
          enter: (node) => {
            const list = byNode.get(node.name)
            if (!list) return
            // A node spanning two visible ranges must not be drawn twice.
            const key = `${node.name}:${node.from}`
            if (seen.has(key)) return false
            seen.add(key)
            let descend = true
            for (const renderer of list) {
              try {
                if (renderer.render(node, ctx) === false) descend = false
              } catch (err) {
                console.error(`Live Preview renderer "${renderer.name}" failed`, err)
              }
            }
            return descend
          },
        })
      }
      return Decoration.set(withoutCovered(ctx.ranges), true)
    }

    const buildBlocks = (state: EditorState): DecorationSet => {
      if (!this.processors.size && !this.blockRenderers.size) return Decoration.none
      const ranges: Range<Decoration>[] = []
      const path = state.facet(filePath)
      syntaxTree(state).iterate({
        enter: (node) => {
          if (node.name !== 'FencedCode' && !this.blockRenderers.has(node.name)) return CONTAINERS.has(node.name)
          const found = this.blockAt(state, node.node)
          if (found) {
            const { block, processor } = found
            const widget = new BlockWidget(this, this.app, processor, block.lang, block.source, path)
            const from = state.doc.lineAt(node.from).from
            const to = state.doc.lineAt(node.to).to
            ranges.push(Decoration.replace({ widget, block: true }).range(from, to))
          }
          return false
        },
      })
      return Decoration.set(ranges)
    }

    const treeChanged = (a: EditorState, b: EditorState) => syntaxTree(a) !== syntaxTree(b)

    // Inline decorations are computed for the visible part of the note only.
    const inline = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        font: { font: string; em: number }
        constructor(view: EditorView) {
          this.font = fontOf(view)
          this.decorations = buildInline(view, this.font)
        }
        update(update: ViewUpdate) {
          if (update.geometryChanged) this.font = fontOf(update.view)
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.selectionSet ||
            treeChanged(update.startState, update.state) ||
            update.geometryChanged ||
            update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refresh)))
          ) {
            this.decorations = buildInline(update.view, this.font)
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    )

    // Replacing several lines with a widget is only allowed from a state field.
    const blocks = StateField.define<DecorationSet>({
      create: buildBlocks,
      update: (value, tr) =>
        tr.docChanged || tr.selection || treeChanged(tr.startState, tr.state) ? buildBlocks(tr.state) : value,
      provide: (field) => EditorView.decorations.from(field),
    })

    return [inline, blocks, renderers.flatMap((renderer) => renderer.extension ?? [])]
  }
}
