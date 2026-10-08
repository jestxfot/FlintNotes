import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { path as paths, type App, type FileView, type Off } from '../../api'

export interface GraphNode extends SimulationNodeDatum {
  /** Vault path, or `?name` for a note that is linked to but does not exist. */
  id: string
  label: string
  exists: boolean
  degree: number
}

type GraphLink = SimulationLinkDatum<GraphNode>

export interface GraphOptions {
  unresolved: boolean
  orphans: boolean
  attachments: boolean
}

const radius = (node: GraphNode) => 3.5 + Math.sqrt(node.degree) * 1.6
const DRAG_THRESHOLD = 4

/** The graph tab: notes as dots, links as lines, laid out by a force simulation. */
export class GraphView implements FileView {
  nodes: GraphNode[] = []
  private links: GraphLink[] = []
  private neighbours = new Map<GraphNode, Set<GraphNode>>()
  private el = document.createElement('div')
  private canvas = document.createElement('canvas')
  private simulation: Simulation<GraphNode, GraphLink>
  // Pan and zoom: screen = graph * k + (x, y), measured from the canvas centre.
  private view = { x: 0, y: 0, k: 1 }
  private hovered: GraphNode | null = null
  // The graph keeps itself framed until the user pans, zooms or drags.
  private autoFit = true
  private cleanups: Off[] = []

  constructor(
    private app: App,
    container: HTMLElement,
    private options: () => GraphOptions,
  ) {
    this.el.className = 'graph-view'
    this.el.append(this.canvas)
    container.append(this.el)

    this.simulation = forceSimulation<GraphNode, GraphLink>()
      .force('charge', forceManyBody<GraphNode>().strength(-120).distanceMax(500))
      .force('x', forceX<GraphNode>().strength(0.04))
      .force('y', forceY<GraphNode>().strength(0.04))
      .force('collide', forceCollide<GraphNode>((node) => radius(node) + 4))
      .on('tick', () => {
        if (this.autoFit) this.fit()
        this.draw()
      })

    const resized = new ResizeObserver(() => this.resize())
    resized.observe(this.el)
    this.cleanups.push(
      () => resized.disconnect(),
      app.metadata.on('resolved', () => this.rebuild()),
      app.workspace.on('active-change', () => this.draw()),
    )
    this.bindPointer()
    this.rebuild()
  }

  /** Where a note's dot is on the page, or `null` if it is not in the graph. */
  positionOf(id: string): { x: number; y: number } | null {
    const node = this.nodes.find((n) => n.id === id)
    if (!node) return null
    const box = this.canvas.getBoundingClientRect()
    return {
      x: box.left + box.width / 2 + this.view.x + (node.x ?? 0) * this.view.k,
      y: box.top + box.height / 2 + this.view.y + (node.y ?? 0) * this.view.k,
    }
  }

  /** Reads the notes and links again; dots that remain keep their place. */
  rebuild(): void {
    const { metadata } = this.app
    const { unresolved, orphans, attachments } = this.options()
    const previous = new Map(this.nodes.map((node) => [node.id, node]))
    const nodes = new Map<string, GraphNode>()
    const node = (id: string, label: string, exists: boolean) => {
      let found = nodes.get(id)
      if (!found) {
        found = previous.get(id) ?? { id, label, exists, degree: 0 }
        Object.assign(found, { label, exists, degree: 0 })
        nodes.set(id, found)
      }
      return found
    }
    const title = (file: string) => (paths.extname(file) === 'md' ? paths.stripExt(paths.basename(file)) : paths.basename(file))

    for (const note of metadata.notes()) node(note, title(note), true)
    const links: GraphLink[] = []
    const connect = (source: GraphNode, target: GraphNode) => {
      if (source === target) return
      source.degree++
      target.degree++
      links.push({ source, target })
    }
    for (const [source, targets] of metadata.resolvedLinks) {
      for (const target of targets.keys()) {
        if (!attachments && paths.extname(target) !== 'md') continue
        connect(node(source, title(source), true), node(target, title(target), true))
      }
    }
    if (unresolved) {
      for (const [source, targets] of metadata.unresolvedLinks) {
        for (const name of targets.keys()) connect(node(source, title(source), true), node(`?${name.toLowerCase()}`, name, false))
      }
    }

    this.nodes = [...nodes.values()].filter((n) => orphans || n.degree > 0)
    this.links = links
    this.neighbours = new Map()
    for (const { source, target } of links as { source: GraphNode; target: GraphNode }[]) {
      for (const [a, b] of [[source, target], [target, source]]) {
        const set = this.neighbours.get(a) ?? new Set()
        this.neighbours.set(a, set.add(b))
      }
    }
    this.simulation.nodes(this.nodes)
    this.simulation.force('link', forceLink<GraphNode, GraphLink>(this.links).distance(60).strength(0.5))
    // A gentle nudge when the graph merely changed, a full layout the first time.
    this.simulation.alpha(previous.size ? 0.3 : 1).restart()
  }

  destroy(): void {
    this.simulation.stop()
    this.cleanups.forEach((off) => off())
    this.el.remove()
  }

  /** Zooms and centres so that all dots are comfortably in view. */
  private fit(): void {
    const { clientWidth, clientHeight } = this.el
    if (!this.nodes.length || !clientWidth || !clientHeight) return
    const xs = this.nodes.map((node) => node.x ?? 0)
    const ys = this.nodes.map((node) => node.y ?? 0)
    const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const margin = 80
    const k = Math.min(2.5, clientWidth / (right - left + margin), clientHeight / (bottom - top + margin))
    this.view.k = Math.max(0.15, k)
    this.view.x = (-(left + right) / 2) * this.view.k
    this.view.y = (-(top + bottom) / 2) * this.view.k
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.el
    const ratio = window.devicePixelRatio || 1
    this.canvas.width = clientWidth * ratio
    this.canvas.height = clientHeight * ratio
    this.draw()
  }

  private draw(): void {
    const { canvas, view, hovered } = this
    if (!canvas.width || !canvas.height) return
    const ctx = canvas.getContext('2d')!
    const style = getComputedStyle(this.el)
    const color = (name: string) => style.getPropertyValue(name).trim()
    const ratio = window.devicePixelRatio || 1
    const near = hovered ? this.neighbours.get(hovered) : undefined
    const lit = (node: GraphNode) => !hovered || node === hovered || near?.has(node)
    const activePath = this.app.workspace.active?.path

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(ratio * view.k, 0, 0, ratio * view.k, canvas.width / 2 + view.x * ratio, canvas.height / 2 + view.y * ratio)

    ctx.lineWidth = 1 / view.k
    for (const { source, target } of this.links as { source: GraphNode; target: GraphNode }[]) {
      const on = hovered && (source === hovered || target === hovered)
      ctx.strokeStyle = on ? color('--accent') : color('--border')
      ctx.globalAlpha = hovered && !on ? 0.25 : 1
      ctx.beginPath()
      ctx.moveTo(source.x!, source.y!)
      ctx.lineTo(target.x!, target.y!)
      ctx.stroke()
    }

    // Labels appear once there is room for them, and always around the pointer.
    const labels = view.k > 0.8 || this.nodes.length <= 40
    ctx.font = `${12 / view.k}px ${color('--font-ui') || 'sans-serif'}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const node of this.nodes) {
      const on = lit(node)
      ctx.globalAlpha = on ? (node.exists ? 1 : 0.5) : 0.15
      ctx.fillStyle = node === hovered || node.id === activePath ? color('--accent') : color('--text-muted')
      ctx.beginPath()
      ctx.arc(node.x!, node.y!, radius(node), 0, Math.PI * 2)
      ctx.fill()
      if (on && (labels || hovered)) {
        ctx.fillStyle = color('--text')
        ctx.fillText(node.label, node.x!, node.y! + radius(node) + 3 / view.k)
      }
    }
    ctx.globalAlpha = 1
  }

  /** The dot under a pointer event, if any. */
  private nodeAt(event: MouseEvent): GraphNode | null {
    const box = this.canvas.getBoundingClientRect()
    const x = (event.clientX - box.left - box.width / 2 - this.view.x) / this.view.k
    const y = (event.clientY - box.top - box.height / 2 - this.view.y) / this.view.k
    let best: GraphNode | null = null
    let bestDistance = Infinity
    for (const node of this.nodes) {
      const distance = Math.hypot(node.x! - x, node.y! - y)
      if (distance <= radius(node) + 4 / this.view.k && distance < bestDistance) [best, bestDistance] = [node, distance]
    }
    return best
  }

  private bindPointer(): void {
    const { canvas, view } = this
    let dragged: GraphNode | null = null
    let panning = false
    let moved = 0
    let last = { x: 0, y: 0 }

    canvas.onpointerdown = (event) => {
      this.autoFit = false
      canvas.setPointerCapture(event.pointerId)
      dragged = this.nodeAt(event)
      panning = !dragged
      moved = 0
      last = { x: event.clientX, y: event.clientY }
    }
    canvas.onpointermove = (event) => {
      const dx = event.clientX - last.x
      const dy = event.clientY - last.y
      last = { x: event.clientX, y: event.clientY }
      if (dragged) {
        moved += Math.abs(dx) + Math.abs(dy)
        if (moved > DRAG_THRESHOLD) {
          // A pinned position (fx, fy) overrides the simulation while dragging.
          dragged.fx = (dragged.fx ?? dragged.x!) + dx / view.k
          dragged.fy = (dragged.fy ?? dragged.y!) + dy / view.k
          this.simulation.alphaTarget(0.3).restart()
        }
      } else if (panning) {
        view.x += dx
        view.y += dy
        this.draw()
      } else {
        const over = this.nodeAt(event)
        if (over !== this.hovered) {
          this.hovered = over
          this.el.classList.toggle('over-node', !!over)
          this.draw()
        }
      }
    }
    canvas.onpointerup = () => {
      if (dragged) {
        if (moved <= DRAG_THRESHOLD && dragged.exists) this.app.workspace.openFile(dragged.id)
        dragged.fx = dragged.fy = null
        this.simulation.alphaTarget(0)
      }
      dragged = null
      panning = false
    }
    canvas.onwheel = (event) => {
      event.preventDefault()
      this.autoFit = false
      const box = canvas.getBoundingClientRect()
      const px = event.clientX - box.left - box.width / 2
      const py = event.clientY - box.top - box.height / 2
      const k = Math.min(4, Math.max(0.15, view.k * Math.exp(-event.deltaY * 0.0015)))
      // Keep the point under the pointer where it is while zooming.
      view.x = px - ((px - view.x) / view.k) * k
      view.y = py - ((py - view.y) / view.k) * k
      view.k = k
      this.draw()
    }
  }
}
