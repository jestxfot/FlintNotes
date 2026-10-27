import { cm, Plugin, whenQuiet } from '../../api'
import './style.css'

/**
 * A map of the note beside its text, as code editors have it. Every line of
 * the note is a thin stroke as long as the line; headings stand out, so the
 * shape of the note can be read at a glance.
 *
 * It is made to cost nothing while reading and typing: the picture is drawn
 * again only after the text has changed and typing has paused, in the
 * browser's idle time; scrolling only moves the frame that marks what is on
 * screen, with one cheap style change per frame.
 */
export default class Minimap extends Plugin {
  onload() {
    this.addSettings([
      { key: 'width', name: 'Ширина карты, точек', desc: 'Ширина карты справа от текста, в точках экрана', type: 'number', default: 90, min: 40, max: 200, step: 10 },
      { key: 'minLines', name: 'Показывать в заметках длиннее, строк', desc: 'В коротких заметках карта не нужна и не показывается', type: 'number', default: 60, min: 0, max: 2000, step: 10 },
      { key: 'headings', name: 'Выделять заголовки', desc: 'Заголовки на карте ярче: по ним легче найти нужный раздел', type: 'toggle', default: true },
    ])
    const get = <T>(key: string) => this.getSetting<T>(key)
    const idle = (work: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(work, { timeout: 800 }) : setTimeout(work, 200))

    /** The maps that are open, to draw them again when a setting changes. */
    const maps = new Set<{ later(wait: number): void }>()
    /**
     * What the editor's own element carries while its map is shown: the class that keeps the text clear
     * of the map, and the map's width. The editor rewrites its classes and style whenever it gains or loses
     * focus, so they are given through it (its attributes) rather than set on the element once: set once,
     * they were gone after the first click, and the note ran under the map, where it could not be clicked.
     */
    const shown = new WeakMap<object, number>()
    const attributes = cm.view.EditorView.editorAttributes.of((view) => {
      const width = shown.get(view)
      return width ? { class: 'has-note-map', style: `--map-width: ${width}px` } : null
    })
    const map = cm.view.ViewPlugin.fromClass(
      class {
        private el = document.createElement('div')
        private canvas = this.el.appendChild(document.createElement('canvas'))
        private frame = this.el.appendChild(document.createElement('div'))
        private timer: ReturnType<typeof setTimeout> | undefined
        private scrolling = 0
        /** Height of the drawn picture in CSS dots; the map itself may be taller or shorter than it. */
        private drawn = 0
        private resized: ResizeObserver

        constructor(private view: InstanceType<typeof cm.view.EditorView>) {
          this.el.className = 'note-map'
          this.frame.className = 'note-map-window'
          view.dom.append(this.el)
          view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
          this.el.addEventListener('pointerdown', this.onPointer)
          this.resized = new ResizeObserver(() => this.later(120))
          this.resized.observe(view.dom)
          maps.add(this)
          this.later(0)
        }

        /** After typing, the picture is drawn again once the typing stops, not between two words. */
        private typed = whenQuiet(() => idle(() => this.draw()), 400)

        update(update: { docChanged: boolean; geometryChanged: boolean }) {
          // Only a change of the text changes the picture; the cursor and the selection do not.
          if (update.docChanged) this.typed()
          else if (update.geometryChanged) this.place()
        }

        destroy() {
          maps.delete(this)
          clearTimeout(this.timer)
          this.typed.cancel()
          cancelAnimationFrame(this.scrolling)
          this.resized.disconnect()
          this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
          shown.delete(this.view)
          this.view.dom.classList.remove('has-note-map')
          this.el.remove()
        }

        /** Draws the picture some time after the last call, when the browser has nothing better to do. */
        later(wait: number) {
          clearTimeout(this.timer)
          this.timer = setTimeout(() => idle(() => this.draw()), wait)
        }

        private draw() {
          const { view } = this
          if (!view.dom.isConnected) return
          const { doc } = view.state
          const show = doc.lines >= (get<number>('minLines') ?? 60)
          this.el.hidden = !show
          const width = Math.max(40, get<number>('width') ?? 90)
          if (show) shown.set(view, width)
          else shown.delete(view)
          // At once on the element, and kept there by the editor from its next update on.
          view.dom.classList.toggle('has-note-map', show)
          if (!show) return
          view.dom.style.setProperty('--map-width', `${width}px`)
          const height = this.el.clientHeight
          if (!height) return
          // Two dots a line, less when the note is too long to fit: then several lines share a dot.
          const step = Math.min(2, height / doc.lines)
          this.drawn = Math.min(height, Math.ceil(doc.lines * step))
          const ratio = Math.min(2, window.devicePixelRatio || 1)
          this.canvas.width = Math.round(width * ratio)
          this.canvas.height = Math.round(this.drawn * ratio)
          this.canvas.style.height = `${this.drawn}px`
          const context = this.canvas.getContext('2d')
          if (!context) return
          context.scale(ratio, ratio)
          const style = getComputedStyle(view.dom)
          const plain = style.getPropertyValue('--text-faint').trim() || '#888'
          const strong = style.getPropertyValue('--accent').trim() || '#7c5cff'
          const quiet = style.getPropertyValue('--border').trim() || '#444'
          const headings = get<boolean>('headings') !== false
          const thick = Math.max(1, Math.min(1.6, step * 0.8))
          let fence = false
          let row = -1
          let longest = 0
          let kind = 0
          const flush = () => {
            if (row < 0 || !longest) return
            context.fillStyle = kind === 2 ? strong : kind === 1 ? quiet : plain
            context.globalAlpha = kind === 2 ? 0.95 : 0.55
            context.fillRect(4, row, Math.min(width - 8, longest), kind === 2 ? thick + 0.6 : thick)
          }
          // A text of any length is gone through line by line without making one big string of it.
          const lines = doc.iterLines()
          for (let n = 0; !lines.next().done; n++) {
            const text = lines.value
            const at = Math.floor(n * step)
            if (at !== row) {
              flush()
              row = at
              longest = 0
              kind = 0
            }
            const trimmed = text.trimStart()
            if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) fence = !fence
            const heading = headings && !fence && /^#{1,6}\s/.test(trimmed)
            const indent = text.length - trimmed.length
            // About three quarters of a dot a letter: a full line of text comes out as a full-width stroke.
            longest = Math.max(longest, (indent + trimmed.trimEnd().length) * 0.75 * (heading ? 1.3 : 1))
            kind = Math.max(kind, heading ? 2 : fence ? 1 : 0)
          }
          flush()
          context.globalAlpha = 1
          this.place()
        }

        /** Puts the frame where the screen is in the note. */
        private place() {
          const scroller = this.view.scrollDOM
          const total = Math.max(1, scroller.scrollHeight)
          const top = (scroller.scrollTop / total) * this.drawn
          const size = Math.max(12, (scroller.clientHeight / total) * this.drawn)
          this.frame.style.height = `${size}px`
          this.frame.style.transform = `translateY(${Math.min(top, Math.max(0, this.drawn - size))}px)`
        }

        private onScroll = () => {
          if (this.scrolling) return
          this.scrolling = requestAnimationFrame(() => {
            this.scrolling = 0
            this.place()
          })
        }

        /** A press on the map brings that place of the note to the middle of the screen; dragging scrolls along. */
        private onPointer = (event: PointerEvent) => {
          event.preventDefault()
          const scroller = this.view.scrollDOM
          const go = (y: number) => {
            const box = this.el.getBoundingClientRect()
            const share = Math.min(1, Math.max(0, (y - box.top) / Math.max(1, this.drawn)))
            scroller.scrollTop = share * scroller.scrollHeight - scroller.clientHeight / 2
          }
          go(event.clientY)
          this.el.classList.add('dragging')
          this.el.setPointerCapture(event.pointerId)
          const move = (e: PointerEvent) => go(e.clientY)
          const up = () => {
            this.el.classList.remove('dragging')
            this.el.removeEventListener('pointermove', move)
          }
          this.el.addEventListener('pointermove', move)
          this.el.addEventListener('pointerup', up, { once: true })
          this.el.addEventListener('pointercancel', up, { once: true })
        }
      },
    )
    this.registerEditorExtension([map, attributes])
    // The settings are read when the picture is drawn; a change of them draws every map again.
    this.onSettingChange(() => maps.forEach((one) => one.later(0)))
    this.addCommand({ id: 'toggle', name: 'Показать или скрыть карту заметки', icon: 'map', scope: 'note', callback: () => this.setSetting('minLines', (get<number>('minLines') ?? 60) >= 100000 ? 60 : 100000) })
  }
}
