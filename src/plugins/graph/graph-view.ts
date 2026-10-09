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
import { GlRenderer, LINK_SIZE, NODE_SIZE, rgba, type Frame } from './gl'
import { GpuLayout, type LayoutInput } from './gpu-layout'
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
const FORCES = new Set<keyof GraphSettings>(['centerStrength', 'repelStrength', 'linkStrength', 'linkDistance', 'nodeSizeMultiplier', 'gpuLayout'])
/** From this many dots on, the layout is worked out by the graphics card unless the settings say otherwise. */
const GPU_FROM = 1200
const FILTERS = new Set<keyof GraphSettings>(['showTags', 'showAttachments', 'hideUnresolved', 'showOrphans', 'colorFolders'])

/** The graph tab: notes as dots, links as lines, laid out by a force simulation. */
export class GraphView implements FileView {
  nodes: GraphNode[] = []
  private links: GraphLink[] = []
  private neighbours = new Map<GraphNode, Set<GraphNode>>()
  private el = document.createElement('div')
  private canvas = document.createElement('canvas')
  /** Names are drawn on a canvas of their own, over the one the graphics card draws into. */
  private labels = document.createElement('canvas')
  private gl: GlRenderer | null = null
  /** The layout on the graphics card, made when first needed; `onGpu` says whether it is in charge now. */
  private gpu: GpuLayout | null = null
  private onGpu = false
  private positions = new Float32Array(0)
  private alpha = 0
  private alphaTarget = 0
  private frame = 0
  /** How long the first steps on the graphics card took, and the verdict if they were too slow. */
  private timed: number[] = []
  private slowCard = false
  private linkData = new Float32Array(0)
  private nodeData = new Float32Array(0)
  /** Widths of names at the base text size, measured once. */
  private widths = new Map<string, number>()
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
    this.labels.className = 'graph-labels'
    this.el.append(this.canvas, this.labels)
    this.gl = GlRenderer.create(this.canvas)
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
    this.cleanups.push(buildPanel(this.el, this.settings, (key) => this.changed(key), () => this.heat(1)))
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
      this.heat(0.5)
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

    // ---- the same forces for the graphics card, which takes over when the graph is big
    const mode = this.settings.gpuLayout
    // "Auto" trusts the graphics card with a big graph, unless it has shown itself to be slow
    // (no real card behind the browser: the same work is then done faster by the processor).
    const wanted = !!this.gl && mode !== 'off' && (mode === 'on' || (this.nodes.length > GPU_FROM && !this.slowCard))
    if (wanted) this.gpu ??= GpuLayout.create(this.gl!.gl)
    this.onGpu = wanted && !!this.gpu
    if (!this.onGpu || !this.gpu) return
    this.simulation.stop()
    const count = this.nodes.length
    const index = new Map(this.nodes.map((n, i) => [n, i]))
    this.positions = new Float32Array(count * 2)
    const input: LayoutInput = {
      positions: this.positions,
      charge: new Float32Array(count),
      gravity: new Float32Array(count),
      ring: new Float32Array(count),
      radius: new Float32Array(count),
      degree: new Float32Array(count),
      ringRadius: reach + 120,
      distanceMax: 1200,
      links: (this.links as { source: GraphNode; target: GraphNode }[]).map((link) => ({
        source: index.get(link.source)!,
        target: index.get(link.target)!,
        distance: Math.min(170, 30 + 4 * Math.sqrt(Math.max(...ends(link)))) * linkLength,
        strength: Math.min(0.7, Math.max(0.05, 0.9 / Math.sqrt(Math.max(...ends(link))))) * linkStrength,
      })),
    }
    this.nodes.forEach((n, i) => {
      this.positions.set([n.x ?? 0, n.y ?? 0], i * 2)
      input.charge[i] = -(30 + this.radius(n) ** 2 * 1.6) * repel
      input.gravity[i] = n.degree ? 0.035 * gravity : 0
      input.ring[i] = n.degree ? 0 : 0.06
      input.radius[i] = this.radius(n) + 2
      input.degree[i] = n.degree
    })
    this.gpu.load(input)
    this.timed = []
  }

  /** Sets the layout moving again; `alpha` is how much (1 is a fresh start). */
  private heat(alpha: number): void {
    if (!this.onGpu) return void this.simulation.alpha(alpha).restart()
    this.alpha = Math.max(this.alpha, alpha)
    this.run()
  }

  /** Keeps the layout moving while something is dragged (`target` above zero), and lets it rest after. */
  private hold(target: number): void {
    if (this.onGpu) {
      this.alphaTarget = target
      return this.run()
    }
    this.simulation.alphaTarget(target)
    if (target) this.simulation.restart()
  }

  /** The loop of the layout on the graphics card: one step and one picture per frame, until it has cooled. */
  private run(): void {
    if (this.frame) return
    const step = () => {
      this.frame = 0
      if (!this.onGpu || !this.gpu) return
      this.alpha += (this.alphaTarget - this.alpha) * 0.03
      const pinned = this.nodes.findIndex((n) => n.fx !== null && n.fx !== undefined)
      const began = performance.now()
      this.gpu.step(this.alpha, 0.5, this.positions, pinned, this.nodes[pinned]?.fx ?? 0, this.nodes[pinned]?.fy ?? 0)
      // The first steps are timed. A card that needs longer than a frame or two for one
      // step is no card at all, and the layout goes back to the processor.
      this.timed.push(performance.now() - began)
      // (The very first step also pays for building the shader, so the second is the one judged.)
      if (this.timed.length === 3 && this.settings.gpuLayout === 'auto') {
        const typical = Math.min(this.timed[1], this.timed[2])
        if (typical > 45) {
          this.slowCard = true
          for (let i = 0; i < this.nodes.length; i++) Object.assign(this.nodes[i], { x: this.positions[i * 2], y: this.positions[i * 2 + 1] })
          this.applyForces()
          return this.heat(this.alpha)
        }
      }
      for (let i = 0; i < this.nodes.length; i++) {
        this.nodes[i].x = this.positions[i * 2]
        this.nodes[i].y = this.positions[i * 2 + 1]
      }
      if (this.autoFit) this.fit()
      this.draw()
      if (this.alpha > 0.002 || this.alphaTarget) this.frame = requestAnimationFrame(step)
    }
    this.frame = requestAnimationFrame(step)
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
    this.heat(previous.size ? 0.3 : 1)
  }

  destroy(): void {
    this.simulation.stop()
    cancelAnimationFrame(this.frame)
    this.cleanups.forEach((off) => off())
    this.gpu?.destroy()
    this.gl?.destroy()
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
    for (const canvas of [this.canvas, this.labels]) {
      canvas.width = clientWidth * ratio
      canvas.height = clientHeight * ratio
    }
    this.draw()
  }

  /** Draws the graph: lines and dots on the graphics card, names over them. */
  draw(): void {
    const { canvas, view, hovered, settings } = this
    if (!canvas.width || !canvas.height) return
    const style = getComputedStyle(this.el)
    const color = (name: string) => (name.startsWith('--') ? style.getPropertyValue(name).trim() : name)
    const ratio = window.devicePixelRatio || 1
    const near = hovered ? this.neighbours.get(hovered) : undefined
    const lit = (node: GraphNode) => !hovered || node === hovered || near?.has(node)
    const activePath = this.app.workspace.active?.path
    type Ends = { source: GraphNode; target: GraphNode }
    const links = this.links as Ends[]

    // ---- what every link and dot looks like, as rows of numbers
    if (this.linkData.length < links.length * LINK_SIZE) this.linkData = new Float32Array(links.length * LINK_SIZE * 2)
    if (this.nodeData.length < this.nodes.length * NODE_SIZE) this.nodeData = new Float32Array(this.nodes.length * NODE_SIZE * 2)
    const [plain, accent] = [rgba(color('--border')), rgba(color('--accent'))]
    let at = 0
    for (const { source, target } of links) {
      const on = !!hovered && (source === hovered || target === hovered)
      // The hundreds of links of a hub would paint over everything; each of them is drawn fainter.
      const busy = Math.max(source.degree, target.degree)
      const alpha = hovered ? (on ? 1 : 0.15) : busy > 150 ? 0.18 : busy > 40 ? 0.45 : 1
      const [r, g, b, a] = on ? accent : plain
      this.linkData.set([source.x!, source.y!, target.x!, target.y!, r, g, b, a * alpha, this.radius(target)], at)
      at += LINK_SIZE
    }
    at = 0
    for (const node of this.nodes) {
      const alpha = lit(node) ? (node.exists ? 1 : 0.5) : 0.15
      const [r, g, b, a] = rgba(color(node === hovered || node.id === activePath ? '--accent' : (node.color ?? this.groupColors.get(node.group) ?? '--text-muted')))
      this.nodeData.set([node.x!, node.y!, this.radius(node), r, g, b, a * alpha], at)
      at += NODE_SIZE
    }
    const frame: Frame = {
      width: canvas.width / ratio,
      height: canvas.height / ratio,
      ratio,
      view,
      links: this.linkData,
      linkCount: links.length,
      nodes: this.nodeData,
      nodeCount: this.nodes.length,
      lineWidth: settings.lineSizeMultiplier,
      // Arrowheads are drawn when one is close enough to tell them apart.
      arrows: settings.showArrow && view.k > 0.35,
    }
    if (this.gl) this.gl.draw(frame)
    else this.draw2d(frame)
    this.drawLabels(frame, lit, color)
  }

  /** The same picture without a graphics card: slower, for browsers that have no WebGL 2. */
  private draw2d(frame: Frame): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const { view, ratio } = frame
    const css = (data: Float32Array, i: number) => `rgb(${data[i] * 255} ${data[i + 1] * 255} ${data[i + 2] * 255} / ${data[i + 3]})`
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(ratio * view.k, 0, 0, ratio * view.k, this.canvas.width / 2 + view.x * ratio, this.canvas.height / 2 + view.y * ratio)
    ctx.lineWidth = frame.lineWidth / view.k
    for (let i = 0; i < frame.linkCount * LINK_SIZE; i += LINK_SIZE) {
      ctx.strokeStyle = css(frame.links, i + 4)
      ctx.beginPath()
      ctx.moveTo(frame.links[i], frame.links[i + 1])
      ctx.lineTo(frame.links[i + 2], frame.links[i + 3])
      ctx.stroke()
    }
    for (let i = 0; i < frame.nodeCount * NODE_SIZE; i += NODE_SIZE) {
      ctx.fillStyle = css(frame.nodes, i + 3)
      ctx.beginPath()
      ctx.arc(frame.nodes[i], frame.nodes[i + 1], frame.nodes[i + 2], 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /**
   * Names of the notes, chosen so that they can be read: the more links a note
   * has, the sooner its name appears while zooming in; a name is left out if it
   * would lie over one already placed; each has an outline in the page's colour.
   */
  private drawLabels(frame: Frame, lit: (node: GraphNode) => boolean | undefined, color: (name: string) => string): void {
    const ctx = this.labels.getContext('2d')
    if (!ctx) return
    const { view, ratio, width, height } = frame
    const { settings, hovered } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.labels.width, this.labels.height)
    if (settings.labelMode === 'hover' && !hovered) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const size = 12 * settings.labelSize
    ctx.font = `${size}px ${color('--font-ui') || 'sans-serif'}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    ctx.strokeStyle = color('--bg')
    ctx.fillStyle = color('--text')

    const near = hovered ? this.neighbours.get(hovered) : undefined
    const activePath = this.app.workspace.active?.path
    // The slider moves the zoom at which names appear: to the right they show from further away.
    const threshold = 0.9 * 2 ** -settings.textFadeMultiplier
    const few = this.nodes.length <= 40
    // The pointed note and its neighbours come first, then the open note, then by number of links.
    const rank = (node: GraphNode) => (node === hovered ? 3e6 : near?.has(node) ? 2e6 : node.id === activePath ? 1e6 : 0) + node.degree
    const wanted: GraphNode[] = []
    for (const node of this.nodes) {
      const x = width / 2 + view.x + node.x! * view.k
      const y = height / 2 + view.y + node.y! * view.k
      if (x < -60 || x > width + 60 || y < -20 || y > height + 20 || !lit(node)) continue
      const special = node === hovered || near?.has(node) || node.id === activePath
      if (settings.labelMode === 'hover' && !special) continue
      // A big note is named from far away, a small one only up close.
      if (!special && !few && settings.labelMode === 'smart' && view.k * (1 + Math.sqrt(node.degree) / 3) < threshold) continue
      if (!special && !few && settings.labelMode === 'all' && view.k < threshold / 3) continue
      wanted.push(node)
    }
    wanted.sort((a, b) => rank(b) - rank(a))

    // Places already taken, as cells of a coarse grid; a name that would cover a taken cell is skipped.
    const cell = Math.max(8, size * 0.9)
    const taken = new Set<number>()
    const columns = Math.ceil(width / cell) + 2
    let placed = 0
    for (const node of wanted) {
      if (placed >= settings.labelLimit && node !== hovered) break
      const text = node.label.length > 34 ? `${node.label.slice(0, 32)}…` : node.label
      let wide = this.widths.get(text)
      if (wide === undefined) {
        if (this.widths.size > 20_000) this.widths.clear()
        this.widths.set(text, (wide = ctx.measureText(text).width / settings.labelSize))
      }
      wide *= settings.labelSize
      const x = width / 2 + view.x + node.x! * view.k
      const y = height / 2 + view.y + node.y! * view.k + this.radius(node) * view.k + 3
      const [c0, c1, r0, r1] = [Math.floor((x - wide / 2) / cell), Math.floor((x + wide / 2) / cell), Math.floor(y / cell), Math.floor((y + size) / cell)]
      let free = true
      if (settings.labelMode !== 'all' || node === hovered) {
        for (let r = r0; r <= r1 && free; r++) for (let c = c0; c <= c1; c++) if (taken.has(r * columns + c)) { free = false; break }
      }
      if (!free && node !== hovered) continue
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) taken.add(r * columns + c)
      ctx.globalAlpha = node.exists ? 1 : 0.55
      ctx.strokeText(text, x, y)
      ctx.fillText(text, x, y)
      placed++
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
          this.hold(0.3)
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
        this.hold(0)
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
