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
import type { FromWorker, ToWorker } from './layout-worker'
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
  /** The group of notes it belongs to by its links: notes of one group link mostly to one another. */
  cluster?: number
}

type GraphLink = SimulationLinkDatum<GraphNode>

// A hub grows with its links, but only up to a point: a note with a thousand links must not cover its neighbours.
const baseRadius = (node: GraphNode) => 3 + Math.min(20, Math.sqrt(node.degree) * 1.3)
const PALETTE = ['blue', 'green', 'orange', 'purple', 'cyan', 'pink', 'yellow', 'red']
const DRAG_THRESHOLD = 4
const FORCES = new Set<keyof GraphSettings>(['centerStrength', 'repelStrength', 'linkStrength', 'linkDistance', 'clusterStrength', 'nodeSizeMultiplier', 'gpuLayout'])
/** From this many dots on, the layout is worked out by the graphics card unless the settings say otherwise. */
const GPU_FROM = 1200
/** From this many dots on, a layout the graphics card does not do is done on a thread of its own. */
const OFF_THREAD_FROM = 500
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
  /** The layout on the graphics card, made when first needed. */
  private gpu: GpuLayout | null = null
  /** Who works the layout out: the page's own thread, the graphics card, or a thread of the processor. */
  private engine: 'page' | 'gpu' | 'worker' = 'page'
  private worker: Worker | null = null
  private loaded: { input: LayoutInput; decay: number } | null = null
  private generation = 0
  /** Places the dots glide between while the layout thread works on the next ones. */
  private from: Float32Array = new Float32Array(0)
  private to: Float32Array = new Float32Array(0)
  private arrived = 0
  private pace = 100
  private gliding = false
  private stepTime = 0
  private drawTime = 0
  /** Whether links or dots changed since the last picture; panning and zooming leave them as they are. */
  private stale = true
  private frameData: Frame | null = null
  private remember: ReturnType<typeof setTimeout> | undefined
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
  private byDegree: GraphNode[] = []
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
    /** Places remembered from the last time, by note. */
    private remembered: Record<string, [number, number]> = {},
    /** Called with the places of all dots once the layout has come to rest. */
    private onSettle: (places: Record<string, [number, number]>) => void = () => {},
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
        this.moved()
      })
      .on('end', () => this.settled())

    const resized = new ResizeObserver(() => this.resize())
    resized.observe(this.el)
    this.cleanups.push(
      () => resized.disconnect(),
      app.metadata.on('resolved', () => this.rebuild()),
      app.workspace.on('active-change', () => this.moved()),
    )
    this.bindPointer()
    this.cleanups.push(buildPanel(this.el, this.settings, (key) => this.changed(key), () => this.heat(1), () => this.stats()))
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
    else this.moved()
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

  /**
   * Finds the groups of the graph: sets of notes that link mostly to one another.
   * Every note repeatedly takes the group most of its neighbours are in (a neighbour
   * with many links counts for less, so one hub does not pull the whole vault into
   * a single group). A note that has no place yet starts near its group, and the
   * groups start apart, so the layout does not have to pull them out of one pile.
   */
  private findClusters(): void {
    const { nodes, neighbours } = this
    nodes.forEach((n, i) => (n.cluster = i))
    // Notes with the most links speak first: the groups form around them.
    const order = [...nodes].sort((a, b) => b.degree - a.degree)
    for (let round = 0; round < 8; round++) {
      let changed = 0
      for (const n of order) {
        const around = neighbours.get(n)
        if (!around?.size) continue
        const votes = new Map<number, number>()
        for (const other of around) votes.set(other.cluster!, (votes.get(other.cluster!) ?? 0) + 1 / Math.sqrt(other.degree || 1))
        let best = n.cluster!
        let most = 0
        for (const [cluster, weight] of votes) if (weight > most || (weight === most && cluster < best)) [best, most] = [cluster, weight]
        if (best !== n.cluster) {
          n.cluster = best
          changed++
        }
      }
      if (changed < nodes.length / 200) break
    }
    const sizes = new Map<number, number>()
    for (const n of nodes) sizes.set(n.cluster!, (sizes.get(n.cluster!) ?? 0) + 1)
    // The groups start on a spiral, the largest in the middle; only notes that have no place yet are put there.
    const rank = new Map([...sizes].filter(([, size]) => size > 1).sort((a, b) => b[1] - a[1]).map(([cluster], i) => [cluster, i]))
    const spread = 90 * Math.sqrt(Math.max(1, nodes.length / Math.max(1, rank.size)))
    for (const n of nodes) {
      const at = rank.get(n.cluster!)
      if (at === undefined || n.x !== undefined) continue
      const angle = at * 2.39996
      const radius = spread * Math.sqrt(at)
      const jitter = 12 * Math.sqrt(sizes.get(n.cluster!)!)
      n.x = Math.cos(angle) * radius + (Math.random() - 0.5) * jitter
      n.y = Math.sin(angle) * radius + (Math.random() - 0.5) * jitter
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
    // Links inside a group are short and firm, links between groups long and slack: the groups
    // draw together and drift apart, joined by the few threads that cross between them.
    const gather = Math.min(1, Math.max(0, this.settings.clusterStrength ?? DEFAULTS.clusterStrength))
    const inside = (link: GraphLink) => (link.source as GraphNode).cluster === (link.target as GraphNode).cluster
    // The more links a hub has, the longer and the looser they are: its notes need
    // room to spread around it, and would be packed into a ball by short, stiff links.
    const distanceOf = (link: GraphLink) => Math.min(170, 30 + 4 * Math.sqrt(Math.max(...ends(link)))) * linkLength * (inside(link) ? 1 - 0.35 * gather : 1 + 2.4 * gather)
    const strengthOf = (link: GraphLink) => Math.min(1, Math.min(0.7, Math.max(0.05, 0.9 / Math.sqrt(Math.max(...ends(link))))) * linkStrength * (inside(link) ? 1 + 0.6 * gather : 1 - 0.85 * gather))
    this.simulation
      // Big notes push harder, so hubs keep clear space around them instead of sinking into a pile.
      .force('charge', forceManyBody<GraphNode>().strength((n) => -(30 + this.radius(n) ** 2 * 1.6) * repel).distanceMax(big ? 800 : 1200).theta(big ? 1.4 : 1.1))
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(this.links)
          .distance(distanceOf)
          .strength(strengthOf),
      )
      .force('x', forceX<GraphNode>().strength((n) => (n.degree ? 0.035 * gravity * (1 - 0.45 * gather) : 0)))
      .force('y', forceY<GraphNode>().strength((n) => (n.degree ? 0.035 * gravity * (1 - 0.45 * gather) : 0)))
      .force('ring', forceRadial<GraphNode>(reach + 120).strength((n) => (n.degree ? 0 : 0.06)))
      .force('collide', forceCollide<GraphNode>((n) => this.radius(n) + 4).strength(0.8))
      // A big vault settles in a couple of hundred steps instead of simmering for a minute.
      .alphaDecay(big ? 0.05 : this.nodes.length > 600 ? 0.035 : 0.0228)

    // ---- who works the layout out. A small graph stays with the simulation above, on
    // the page's own thread. A big one goes to the graphics card; where that has shown
    // itself to be slow (no real card behind the browser), to a thread of its own.
    const mode = this.settings.gpuLayout
    const bigEnough = this.nodes.length > OFF_THREAD_FROM
    const card = !!this.gl && mode !== 'off' && (mode === 'on' || (this.nodes.length > GPU_FROM && !this.slowCard))
    if (card) this.gpu ??= GpuLayout.create(this.gl!.gl)
    const engine: typeof this.engine = card && this.gpu ? 'gpu' : bigEnough ? 'worker' : 'page'
    if (engine !== 'worker') this.worker?.postMessage({ type: 'stop' } satisfies ToWorker)
    this.engine = engine
    if (engine === 'page') return
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
        distance: distanceOf(link),
        strength: strengthOf(link),
      })),
    }
    this.nodes.forEach((n, i) => {
      this.positions.set([n.x ?? 0, n.y ?? 0], i * 2)
      input.charge[i] = -(30 + this.radius(n) ** 2 * 1.6) * repel
      input.gravity[i] = n.degree ? 0.035 * gravity * (1 - 0.45 * gather) : 0
      input.ring[i] = n.degree ? 0 : 0.06
      input.radius[i] = this.radius(n) + 2
      input.degree[i] = n.degree
    })
    this.from = this.positions.slice()
    this.to = this.positions.slice()
    if (engine === 'gpu') {
      this.gpu!.load(input)
      this.timed = []
    } else {
      this.loaded = { input, decay: big ? 0.05 : 0.035 }
    }
  }

  /** The thread that works the layout out for big graphs when the graphics card does not. */
  private thread(): Worker {
    if (this.worker) return this.worker
    this.worker = new Worker(new URL('./layout-worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const { positions, alpha, took, generation } = event.data
      if (this.engine !== 'worker' || generation !== this.generation || positions.length !== this.positions.length) return
      // The dots glide from where they are drawn now to the places that have just arrived.
      this.from = this.positions.slice()
      this.to = positions
      this.arrived = performance.now()
      this.pace = Math.min(400, Math.max(30, took + 20))
      this.alpha = alpha
      this.stepTime = took
      this.run()
    }
    return this.worker
  }

  /** Sets the layout moving again; `alpha` is how much (1 is a fresh start). */
  private heat(alpha: number): void {
    if (this.engine === 'page') return void this.simulation.alpha(alpha).restart()
    this.alpha = Math.max(this.alpha, alpha)
    if (this.engine === 'worker') {
      const worker = this.thread()
      if (this.loaded) {
        this.generation++
        worker.postMessage({ type: 'load', ...this.loaded, alpha } satisfies ToWorker)
        this.loaded = null
      } else worker.postMessage({ type: 'heat', alpha } satisfies ToWorker)
    }
    this.run()
  }

  /** Keeps the layout moving while something is dragged (`target` above zero), and lets it rest after. */
  private hold(target: number): void {
    if (this.engine === 'page') {
      this.simulation.alphaTarget(target)
      if (target) this.simulation.restart()
      return
    }
    this.alphaTarget = target
    if (this.engine === 'worker') this.worker?.postMessage({ type: 'hold', target } satisfies ToWorker)
    this.run()
  }

  /**
   * The loop of a layout that is not worked out on the page's thread: each frame
   * the dots take their new places (a step of the graphics card, or a glide
   * towards what the layout thread sent last) and the picture is drawn.
   */
  private run(): void {
    if (this.frame) return
    const step = () => {
      this.frame = 0
      const pinned = this.nodes.findIndex((n) => n.fx !== null && n.fx !== undefined)
      if (this.engine === 'gpu' && this.gpu) {
        this.alpha += (this.alphaTarget - this.alpha) * 0.03
        const began = performance.now()
        this.gpu.step(this.alpha, 0.5, this.positions, pinned, this.nodes[pinned]?.fx ?? 0, this.nodes[pinned]?.fy ?? 0)
        this.stepTime = performance.now() - began
        // The first steps are timed. A card that needs most of a frame for one step is
        // no card at all, and the layout goes to a thread of the processor instead.
        // (The very first step also pays for building the shader, so the later ones are judged.)
        this.timed.push(this.stepTime)
        if (this.timed.length === 3 && this.settings.gpuLayout === 'auto' && Math.min(this.timed[1], this.timed[2]) > 12) {
          this.slowCard = true
          this.place(this.positions)
          this.applyForces()
          return this.heat(this.alpha)
        }
        this.place(this.positions)
      } else if (this.engine === 'worker') {
        if (pinned >= 0) this.worker?.postMessage({ type: 'pin', index: pinned, x: this.nodes[pinned].fx!, y: this.nodes[pinned].fy! } satisfies ToWorker)
        const t = Math.min(1, (performance.now() - this.arrived) / this.pace)
        for (let i = 0; i < this.positions.length; i++) this.positions[i] = this.from[i] + (this.to[i] - this.from[i]) * t
        if (pinned >= 0) this.positions.set([this.nodes[pinned].fx!, this.nodes[pinned].fy!], pinned * 2)
        this.place(this.positions)
        this.gliding = t < 1
      } else return
      if (this.autoFit) this.fit()
      this.moved()
      const active = this.alpha > 0.002 || !!this.alphaTarget || (this.engine === 'worker' && this.gliding)
      if (active) this.frame = requestAnimationFrame(step)
      else this.settled()
    }
    this.frame = requestAnimationFrame(step)
  }

  private place(positions: Float32Array): void {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].x = positions[i * 2]
      this.nodes[i].y = positions[i * 2 + 1]
    }
  }

  /** The dots have moved (or look different): the next picture is built anew. */
  private moved(): void {
    this.stale = true
    this.draw()
  }

  /** The layout has come to rest: it is remembered, so that the graph opens laid out next time. */
  private settled(): void {
    clearTimeout(this.remember)
    this.remember = setTimeout(() => this.onSettle(Object.fromEntries(this.nodes.map((n) => [n.id, [Math.round(n.x ?? 0), Math.round(n.y ?? 0)]]))), 1500)
  }

  /** What the panel shows about the work being done. */
  stats(): string {
    const who = this.engine === 'gpu' ? 'видеокарта' : this.engine === 'worker' ? 'отдельный поток' : 'страница'
    const moving = this.engine === 'page' ? this.simulation.alpha() > this.simulation.alphaMin() : this.alpha > 0.002
    return `${this.nodes.length} точек, ${this.links.length} связей · раскладка: ${who}${moving ? `, шаг ${this.stepTime.toFixed(0)} мс` : ', готова'} · кадр ${this.drawTime.toFixed(1)} мс${this.gl ? '' : ' (без WebGL)'}`
  }

  /** Reads the notes and links again; dots that remain keep their place. */
  rebuild(): void {
    const { metadata } = this.app
    const { showAttachments: attachments, hideUnresolved, showOrphans: orphans, showTags, search, colorGroups, colorFolders: colors } = this.settings
    const unresolved = !hideUnresolved
    const previous = new Map(this.nodes.map((node) => [node.id, node]))
    const nodes = new Map<string, GraphNode>()
    let known = 0
    const node = (id: string, label: string, exists: boolean) => {
      let found = nodes.get(id)
      if (!found) {
        const spot = previous.has(id) || !Object.hasOwn(this.remembered, id) ? null : this.remembered[id]
        if (spot) known++
        found = previous.get(id) ?? { id, label, exists, degree: 0, group: '', ...(spot ? { x: spot[0], y: spot[1] } : {}) }
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
    this.byDegree = []
    this.links = links
    this.neighbours = new Map()
    for (const { source, target } of links as { source: GraphNode; target: GraphNode }[]) {
      for (const [a, b] of [[source, target], [target, source]]) {
        const set = this.neighbours.get(a) ?? new Set()
        this.neighbours.set(a, set.add(b))
      }
    }
    this.findClusters()
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
    // A graph whose dots were mostly placed last time only needs a touch-up, not a layout from scratch.
    const familiar = !previous.size && known > this.nodes.length * 0.8
    this.stale = true
    this.heat(previous.size ? 0.3 : familiar ? 0.08 : 1)
  }

  destroy(): void {
    this.simulation.stop()
    cancelAnimationFrame(this.frame)
    clearTimeout(this.remember)
    this.worker?.terminate()
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
    this.moved()
  }

  /**
   * Draws the graph: lines and dots on the graphics card, names over them.
   * The rows of numbers the card draws from are built only when something
   * moved or changed its look; panning and zooming reuse what the card has.
   */
  draw(): void {
    const { canvas, view, hovered, settings } = this
    if (!canvas.width || !canvas.height) return
    const began = performance.now()
    const style = getComputedStyle(this.el)
    const values = new Map<string, string>()
    const color = (name: string) => {
      if (!name.startsWith('--')) return name
      let value = values.get(name)
      if (value === undefined) values.set(name, (value = style.getPropertyValue(name).trim()))
      return value
    }
    const ratio = window.devicePixelRatio || 1
    const near = hovered ? this.neighbours.get(hovered) : undefined
    const lit = (node: GraphNode) => !hovered || node === hovered || near?.has(node)
    const fresh = this.stale || !this.frameData

    if (fresh) {
      const activePath = this.app.workspace.active?.path
      const links = this.links as { source: GraphNode; target: GraphNode }[]
      if (this.linkData.length < links.length * LINK_SIZE) this.linkData = new Float32Array(links.length * LINK_SIZE * 2)
      if (this.nodeData.length < this.nodes.length * NODE_SIZE) this.nodeData = new Float32Array(this.nodes.length * NODE_SIZE * 2)
      const [plain, accent] = [rgba(color('--border')), rgba(color('--accent'))]
      const data = this.linkData
      let at = 0
      for (const { source, target } of links) {
        const on = !!hovered && (source === hovered || target === hovered)
        // The hundreds of links of a hub would paint over everything; each of them is drawn fainter.
        const busy = Math.max(source.degree, target.degree)
        const alpha = hovered ? (on ? 1 : 0.15) : busy > 150 ? 0.18 : busy > 40 ? 0.45 : 1
        const tint = on ? accent : plain
        data[at] = source.x!
        data[at + 1] = source.y!
        data[at + 2] = target.x!
        data[at + 3] = target.y!
        data[at + 4] = tint[0]
        data[at + 5] = tint[1]
        data[at + 6] = tint[2]
        data[at + 7] = tint[3] * alpha
        data[at + 8] = this.radius(target)
        at += LINK_SIZE
      }
      const dots = this.nodeData
      at = 0
      for (const node of this.nodes) {
        const alpha = lit(node) ? (node.exists ? 1 : 0.5) : 0.15
        const tint = rgba(color(node === hovered || node.id === activePath ? '--accent' : (node.color ?? this.groupColors.get(node.group) ?? '--text-muted')))
        dots[at] = node.x!
        dots[at + 1] = node.y!
        dots[at + 2] = this.radius(node)
        dots[at + 3] = tint[0]
        dots[at + 4] = tint[1]
        dots[at + 5] = tint[2]
        dots[at + 6] = tint[3] * alpha
        at += NODE_SIZE
      }
      this.stale = false
    }
    const frame: Frame = (this.frameData = {
      width: canvas.width / ratio,
      height: canvas.height / ratio,
      ratio,
      view,
      links: this.linkData,
      linkCount: this.links.length,
      nodes: this.nodeData,
      nodeCount: this.nodes.length,
      lineWidth: settings.lineSizeMultiplier,
      // Arrowheads are drawn when one is close enough to tell them apart.
      arrows: settings.showArrow && view.k > 0.35,
    })
    if (this.gl) this.gl.draw(frame, fresh)
    else this.draw2d(frame)
    this.drawLabels(frame, lit, color)
    this.drawTime = this.drawTime * 0.8 + (performance.now() - began) * 0.2
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
    // The pointed note and its neighbours come first, then the open note, then the rest by
    // number of links. That last order is kept from one picture to the next, so a frame
    // costs a walk along it and no sorting; in the smart mode the walk stops at the first
    // note too small to be named at this zoom, since all after it are smaller still.
    const onScreen = (node: GraphNode) => {
      const x = width / 2 + view.x + node.x! * view.k
      const y = height / 2 + view.y + node.y! * view.k
      return x > -60 && x < width + 60 && y > -20 && y < height + 20
    }
    const wanted: GraphNode[] = []
    const special = new Set<GraphNode>()
    for (const node of [hovered, ...(near ?? []), this.nodes.find((n) => n.id === activePath)]) {
      if (node && !special.has(node) && onScreen(node)) wanted.push(node)
      if (node) special.add(node)
    }
    if (settings.labelMode !== 'hover') {
      if (this.byDegree.length !== this.nodes.length) this.byDegree = [...this.nodes].sort((a, b) => b.degree - a.degree)
      for (const node of this.byDegree) {
        if (wanted.length >= settings.labelLimit * 3) break
        if (!few && settings.labelMode === 'smart' && view.k * (1 + Math.sqrt(node.degree) / 3) < threshold) break
        if (!few && settings.labelMode === 'all' && view.k < threshold / 3) break
        if (!special.has(node) && lit(node) && onScreen(node)) wanted.push(node)
      }
    }

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
          this.moved()
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
