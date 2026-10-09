import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { path as paths, type App, type FileView, type Off } from '../../api'
import { buildPanel } from './panel'
import { compileQuery, cssColor, DEFAULTS, type GraphSettings } from './settings'

export interface GraphNode extends SimulationNodeDatum {
  /** Vault path, or `?name` for a note that is linked to but does not exist. */
  id: string
  label: string
  exists: boolean
  degree: number
  /** Top-level folder of the note, which decides its colour when no colour group matches. */
  group: string
  /** The colour of the first colour group the note matches. */
  color?: string
}

type GraphLink = SimulationLinkDatum<GraphNode>

// A hub grows with its links, but only up to a point: a note with a thousand links must not cover its neighbours.
const baseRadius = (node: GraphNode) => 3 + Math.min(20, Math.sqrt(node.degree) * 1.3)
const PALETTE = ['blue', 'green', 'orange', 'purple', 'cyan', 'pink', 'yellow', 'red']
const DRAG_THRESHOLD = 4
const FORCES = new Set<keyof GraphSettings>(['centerStrength', 'repelStrength', 'linkStrength', 'linkDistance', 'nodeSizeMultiplier'])
const FILTERS = new Set<keyof GraphSettings>(['showTags', 'showAttachments', 'hideUnresolved', 'showOrphans', 'colorFolders'])

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
  private legend = document.createElement('div')
  private groupColors = new Map<string, string>()
  // The graph keeps itself framed until the user pans, zooms or drags.
  private autoFit = true
  private cleanups: Off[] = []
  private typing: ReturnType<typeof setTimeout> | undefined

  constructor(
    private app: App,
    container: HTMLElement,
    private settings: GraphSettings,
    /** Called when the user changed a setting in the panel. */
    private onChange: () => void,
  ) {
    this.el.className = 'graph-view'
    this.el.append(this.canvas)
    container.append(this.el)

    this.legend.className = 'graph-legend'
    this.el.append(this.legend)
    // The forces themselves depend on the notes and the settings; `rebuild` sets them.
    this.simulation = forceSimulation<GraphNode, GraphLink>()
      .velocityDecay(0.5)
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
    this.cleanups.push(buildPanel(this.el, this.settings, (key) => this.changed(key), () => this.simulation.alpha(1).restart()))
    this.rebuild()
  }

  private radius(node: GraphNode): number {
    return baseRadius(node) * this.settings.nodeSizeMultiplier
  }

  /** A setting was changed in the panel: redo as little as it takes. */
  private changed(key: keyof GraphSettings): void {
    this.onChange()
    if (key === 'search' || key === 'colorGroups') {
      // Typed text: wait for a pause before laying the graph out again.
      clearTimeout(this.typing)
      this.typing = setTimeout(() => this.rebuild(), 250)
    } else if (FORCES.has(key)) {
      this.applyForces()
      this.simulation.alpha(0.5).restart()
    } else if (FILTERS.has(key)) this.rebuild()
    else this.draw()
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

  /** Sets the layout's forces from the settings and the size of the graph. */
  private applyForces(): void {
    // Obsidian's numbers, turned into multipliers of this layout's own defaults.
    const gravity = this.settings.centerStrength / DEFAULTS.centerStrength
    const repel = Math.max(0.05, this.settings.repelStrength / DEFAULTS.repelStrength)
    const linkLength = this.settings.linkDistance / DEFAULTS.linkDistance
    const { linkStrength } = this.settings
    const big = this.nodes.length > 1500
    const linked = this.nodes.filter((n) => n.degree > 0).length
    // Roughly how far out the linked notes reach; notes without links settle in a ring beyond that.
    const reach = 26 * Math.sqrt(linked + 1) * Math.sqrt(repel) * linkLength
    const ends = (link: GraphLink) => [(link.source as GraphNode).degree, (link.target as GraphNode).degree]
    this.simulation
      // Big notes push harder, so hubs keep clear space around them instead of sinking into a pile.
      .force('charge', forceManyBody<GraphNode>().strength((n) => -(30 + this.radius(n) ** 2 * 1.6) * repel).distanceMax(big ? 800 : 1200).theta(big ? 1.4 : 1.1))
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(this.links)
          // The more links a hub has, the longer and the looser they are: its notes need
          // room to spread around it, and would be packed into a ball by short, stiff links.
          .distance((link) => Math.min(170, 30 + 4 * Math.sqrt(Math.max(...ends(link)))) * linkLength)
          .strength((link) => Math.min(0.7, Math.max(0.05, 0.9 / Math.sqrt(Math.max(...ends(link))))) * linkStrength),
      )
      .force('x', forceX<GraphNode>().strength((n) => (n.degree ? 0.035 * gravity : 0)))
      .force('y', forceY<GraphNode>().strength((n) => (n.degree ? 0.035 * gravity : 0)))
      .force('ring', forceRadial<GraphNode>(reach + 120).strength((n) => (n.degree ? 0 : 0.06)))
      .force('collide', forceCollide<GraphNode>((n) => this.radius(n) + 4).strength(0.8))
      // A big vault settles in a couple of hundred steps instead of simmering for a minute.
      .alphaDecay(big ? 0.05 : this.nodes.length > 600 ? 0.035 : 0.0228)
  }

  /** Reads the notes and links again; dots that remain keep their place. */
  rebuild(): void {
    const { metadata } = this.app
    const { showAttachments: attachments, hideUnresolved, showOrphans: orphans, showTags, search, colorGroups, colorFolders: colors } = this.settings
    const unresolved = !hideUnresolved
    const previous = new Map(this.nodes.map((node) => [node.id, node]))
    const nodes = new Map<string, GraphNode>()
    const node = (id: string, label: string, exists: boolean) => {
      let found = nodes.get(id)
      if (!found) {
        found = previous.get(id) ?? { id, label, exists, degree: 0, group: '' }
        Object.assign(found, { label, exists, degree: 0, group: exists && id.includes('/') ? id.slice(0, id.indexOf('/')) : '' })
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

    if (showTags) {
      for (const note of metadata.notes()) {
        for (const tag of metadata.get(note)?.tags ?? []) connect(node(note, title(note), true), Object.assign(node(`#${tag.toLowerCase()}`, `#${tag}`, true), { group: '' }))
      }
    }

    // The search leaves only matching notes; colour groups paint the notes that match them.
    const subject = (n: GraphNode) => ({ path: n.id.toLowerCase(), name: n.label.toLowerCase(), tags: (metadata.get(n.id)?.tags ?? []).map((tag) => tag.toLowerCase()) })
    const wanted = search.trim() ? compileQuery(search) : null
    const groups = colorGroups.filter((group) => group.query.trim()).map((group) => ({ test: compileQuery(group.query), color: cssColor(group.color) }))
    const kept = new Set<GraphNode>()
    for (const n of nodes.values()) {
      const about = wanted || groups.length ? subject(n) : null
      if (wanted && !wanted(about!)) continue
      kept.add(n)
      n.color = about ? groups.find((group) => group.test(about))?.color : undefined
    }
    const shown = links.filter((link) => kept.has(link.source as GraphNode) && kept.has(link.target as GraphNode))
    if (wanted) {
      // Links to notes that were filtered out no longer count.
      for (const n of kept) n.degree = 0
      for (const link of shown) {
        ;(link.source as GraphNode).degree++
        ;(link.target as GraphNode).degree++
      }
    }
    links.length = 0
    links.push(...shown)

    this.nodes = [...kept].filter((n) => orphans || n.degree > 0)
    this.links = links
    this.neighbours = new Map()
    for (const { source, target } of links as { source: GraphNode; target: GraphNode }[]) {
      for (const [a, b] of [[source, target], [target, source]]) {
        const set = this.neighbours.get(a) ?? new Set()
        this.neighbours.set(a, set.add(b))
      }
    }
    // The largest folders get colours of their own; the rest share the neutral one.
    const sizes = new Map<string, number>()
    for (const n of this.nodes) if (n.group) sizes.set(n.group, (sizes.get(n.group) ?? 0) + 1)
    const largest = [...sizes].sort((a, b) => b[1] - a[1]).slice(0, PALETTE.length)
    this.groupColors = new Map(colors && largest.length > 1 ? largest.map(([group], i) => [group, `--color-${PALETTE[i]}`]) : [])
    this.legend.replaceChildren(
      ...[...this.groupColors].map(([group, variable]) => {
        const item = document.createElement('span')
        item.textContent = group
        item.style.setProperty('--dot', `var(${variable})`)
        return item
      }),
    )

    this.simulation.nodes(this.nodes)
    this.applyForces()
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

    // Thousands of lines and dots are drawn as a few big shapes, one per look:
    // one by one they would take most of every frame while the graph settles.
    type Ends = { source: GraphNode; target: GraphNode }
    // Arrowheads are drawn when one is close enough to tell them apart.
    const arrows = this.settings.showArrow && view.k > 0.35
    const strokes = new Map<string, Ends[]>()
    for (const link of this.links as Ends[]) {
      const on = hovered && (link.source === hovered || link.target === hovered)
      // The hundreds of links of a hub would paint over everything; each of them is drawn fainter.
      const busy = Math.max(link.source.degree, link.target.degree)
      const alpha = hovered ? (on ? 1 : 0.15) : busy > 150 ? 0.18 : busy > 40 ? 0.45 : 1
      const key = `${on ? '--accent' : '--border'}|${alpha}`
      const list = strokes.get(key)
      if (list) list.push(link)
      else strokes.set(key, [link])
    }
    ctx.lineWidth = this.settings.lineSizeMultiplier / view.k
    for (const [key, list] of strokes) {
      const [variable, alpha] = key.split('|')
      ctx.strokeStyle = color(variable)
      ctx.globalAlpha = Number(alpha)
      ctx.beginPath()
      for (const { source, target } of list) {
        ctx.moveTo(source.x!, source.y!)
        ctx.lineTo(target.x!, target.y!)
        if (!arrows) continue
        // A small arrowhead at the edge of the dot the link points to.
        const angle = Math.atan2(target.y! - source.y!, target.x! - source.x!)
        const tip = this.radius(target) + 1
        const [x, y] = [target.x! - Math.cos(angle) * tip, target.y! - Math.sin(angle) * tip]
        const size = 5 / Math.max(view.k, 0.6)
        ctx.moveTo(x - Math.cos(angle - 0.45) * size, y - Math.sin(angle - 0.45) * size)
        ctx.lineTo(x, y)
        ctx.lineTo(x - Math.cos(angle + 0.45) * size, y - Math.sin(angle + 0.45) * size)
      }
      ctx.stroke()
    }

    const fills = new Map<string, GraphNode[]>()
    for (const node of this.nodes) {
      const alpha = lit(node) ? (node.exists ? 1 : 0.5) : 0.15
      const variable = node === hovered || node.id === activePath ? '--accent' : (node.color ?? this.groupColors.get(node.group) ?? '--text-muted')
      const key = `${variable}|${alpha}`
      const list = fills.get(key)
      if (list) list.push(node)
      else fills.set(key, [node])
    }
    for (const [key, list] of fills) {
      const [variable, alpha] = key.split('|')
      ctx.fillStyle = variable.startsWith('--') ? color(variable) : variable
      ctx.globalAlpha = Number(alpha)
      ctx.beginPath()
      for (const node of list) {
        ctx.moveTo(node.x! + this.radius(node), node.y!)
        ctx.arc(node.x!, node.y!, this.radius(node), 0, Math.PI * 2)
      }
      ctx.fill()
    }

    // Labels appear once there is room for them, and always around the pointer.
    // The slider moves the zoom at which names appear: to the right they show from further away.
    const labels = view.k > 0.8 * 2 ** -this.settings.textFadeMultiplier || this.nodes.length <= 40
    if (labels || hovered) {
      ctx.font = `${12 / view.k}px ${color('--font-ui') || 'sans-serif'}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = color('--text')
      // Only what is on screen: text is the slowest thing to draw.
      const halfW = canvas.width / ratio / 2 / view.k
      const halfH = canvas.height / ratio / 2 / view.k
      const [cx, cy] = [-view.x / view.k, -view.y / view.k]
      for (const node of this.nodes) {
        if (!lit(node) || (!labels && node !== hovered && !near?.has(node))) continue
        if (Math.abs(node.x! - cx) > halfW || Math.abs(node.y! - cy) > halfH) continue
        ctx.globalAlpha = node.exists ? 1 : 0.5
        ctx.fillText(node.label, node.x!, node.y! + this.radius(node) + 3 / view.k)
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
      if (distance <= this.radius(node) + 4 / this.view.k && distance < bestDistance) [best, bestDistance] = [node, distance]
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
