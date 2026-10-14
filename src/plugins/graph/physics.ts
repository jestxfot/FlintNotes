/**
 * The physics of the graph: one model, used by the page and by the layout
 * thread alike, and copied formula for formula by the graphics card's shader.
 *
 * - Every dot pushes every other one away, the harder the more links it has
 *   (its charge grows with the square root of its links). Far dots are taken
 *   together, as one heavier dot (Barnes–Hut), so a step costs n·log n.
 * - A link pulls its ends together with the logarithm of its length (LinLog):
 *   short links act like springs, long ones barely more than medium ones. Groups
 *   that are tightly linked inside then gather, and groups linked to each other
 *   by a few threads drift apart, instead of everything knotting in the middle.
 * - Of a link's two ends, the one with fewer links follows: a note with a single
 *   link stays by the note it links to, and a hub is not dragged about by its
 *   hundred leaves.
 * - Dots of one group are drawn to the group's centre, and the centres push one
 *   another away like heavy bodies: the groups become islands.
 * - Dots do not overlap; the linked ones keep near the middle, the unlinked ones
 *   stand in a ring around everything.
 */

export interface LayoutForces {
  /** How hard dots push each other apart. */
  repel: number
  /** How hard links pull. */
  attract: number
  /** Pull of the linked dots to the middle. */
  gravity: number
  /** 0..1: how strongly a group holds together and keeps away from other groups. */
  gather: number
  /** The least radius of the ring the unlinked dots stand in; it follows the linked ones outwards. */
  ringRadius: number
}

/** What the layout needs to know about the graph, as plain numbers. */
export interface LayoutInput {
  /** x, y of every dot. */
  positions: Float32Array
  radius: Float32Array
  degree: Float32Array
  /** The group of every dot: 0..clusters-1, or -1 for none. */
  cluster: Int32Array
  clusters: number
  /** Both ends of every link, one pair after another. */
  links: Uint32Array
  /** For every link: the length at which it starts to pull more gently. */
  linkLength: Float32Array
  /** For every link: how hard it pulls, apart from `forces.attract`. */
  linkStrength: Float32Array
  forces: LayoutForces
}

/** The charge of a dot with this many links: hubs push harder, so they keep room around them. */
export const chargeOf = (degree: number) => 1 + Math.sqrt(degree)

/** The fastest a dot may move in one step. */
export const MAX_SPEED = 40
/** What is left of a dot's speed after a step. */
export const KEEP = 0.55
/** The share of the way to its ring an unlinked dot goes in one step. */
export const RING_PULL = 0.1
/** Charges are multiplied by this, so that `repel = 1` gives a comfortable spacing. */
export const REPEL_SCALE = 8
/** Dots of a group are pulled to its centre with this, times `gather`. */
export const GATHER_PULL = 0.012
/** Groups push one another apart with this, times `gather`, on top of what their dots do. */
export const GATHER_PUSH = 1

/**
 * The centre of every group, and the push each group gets from all the others,
 * shared out among its dots. Groups of fewer than three dots are not groups here
 * (`live` is 0 for them). Writes four numbers per group: centre x, y, push x, y (per dot).
 */
export function groupForces(x: Float32Array, y: Float32Array, charge: Float32Array, cluster: Int32Array, clusters: number, gather: number, out: Float32Array, live: Uint8Array): Float32Array {
  const sums = new Float64Array(clusters * 4)
  for (let i = 0; i < cluster.length; i++) {
    const c = cluster[i]
    if (c < 0) continue
    sums[c * 4] += x[i]
    sums[c * 4 + 1] += y[i]
    sums[c * 4 + 2] += 1
    sums[c * 4 + 3] += charge[i]
  }
  out.fill(0)
  live.fill(0)
  const groups: number[] = []
  for (let c = 0; c < clusters; c++) {
    const n = sums[c * 4 + 2]
    if (n < 3) continue
    out[c * 4] = sums[c * 4] / n
    out[c * 4 + 1] = sums[c * 4 + 1] / n
    live[c] = 1
    groups.push(c)
  }
  if (!gather) return out
  for (let a = 0; a < groups.length; a++) {
    const ca = groups[a]
    for (let b = a + 1; b < groups.length; b++) {
      const cb = groups[b]
      let dx = out[ca * 4] - out[cb * 4]
      let dy = out[ca * 4 + 1] - out[cb * 4 + 1]
      let d2 = dx * dx + dy * dy
      if (d2 < 1) {
        dx = 1
        dy = 0
        d2 = 1
      }
      // Like two heavy dots: as much push as all their dots together, shared out among the dots that receive it.
      const push = (GATHER_PUSH * REPEL_SCALE * gather * Math.sqrt(sums[ca * 4 + 3] * sums[cb * 4 + 3])) / d2
      out[ca * 4 + 2] += (dx * push) / sums[ca * 4 + 2]
      out[ca * 4 + 3] += (dy * push) / sums[ca * 4 + 2]
      out[cb * 4 + 2] -= (dx * push) / sums[cb * 4 + 2]
      out[cb * 4 + 3] -= (dy * push) / sums[cb * 4 + 2]
    }
  }
  return out
}

/**
 * The radius of the ring the unlinked dots stand in: just outside the linked
 * ones, wherever they have spread to (never less than `least`).
 */
export function ringRadiusOf(x: Float32Array, y: Float32Array, degree: Float32Array, least: number): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < x.length; i++) {
    if (!degree[i]) continue
    sum += x[i] * x[i] + y[i] * y[i]
    n++
  }
  // For dots spread evenly over a disc, the disc's edge is √2 times their mean square radius.
  return Math.max(least, n ? Math.sqrt(sum / n) * 1.9 + 60 : least)
}

/** A quadtree over the dots, each cell knowing the sum of its charges and their centre. */
class Tree {
  // Cells as flat arrays: centre of charge, total charge, size, first child (or -1), the dot of a leaf (or -1).
  private cx = new Float64Array(0)
  private cy = new Float64Array(0)
  private q = new Float64Array(0)
  private size = new Float64Array(0)
  private child = new Int32Array(0)
  private dot = new Int32Array(0)
  private midX = new Float64Array(0)
  private midY = new Float64Array(0)
  private used = 0

  private grow(need: number): void {
    if (need <= this.cx.length) return
    const n = Math.max(need, this.cx.length * 2, 64)
    const copy = <T extends Float64Array | Int32Array>(old: T, make: (n: number) => T) => {
      const next = make(n)
      next.set(old)
      return next
    }
    this.cx = copy(this.cx, (k) => new Float64Array(k))
    this.cy = copy(this.cy, (k) => new Float64Array(k))
    this.q = copy(this.q, (k) => new Float64Array(k))
    this.size = copy(this.size, (k) => new Float64Array(k))
    this.midX = copy(this.midX, (k) => new Float64Array(k))
    this.midY = copy(this.midY, (k) => new Float64Array(k))
    this.child = copy(this.child, (k) => new Int32Array(k))
    this.dot = copy(this.dot, (k) => new Int32Array(k))
  }

  private cell(midX: number, midY: number, size: number): number {
    this.grow(this.used + 1)
    const at = this.used++
    this.cx[at] = this.cy[at] = this.q[at] = 0
    this.midX[at] = midX
    this.midY[at] = midY
    this.size[at] = size
    this.child[at] = -1
    this.dot[at] = -1
    return at
  }

  build(x: Float32Array, y: Float32Array, charge: Float32Array): void {
    this.used = 0
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < x.length; i++) {
      if (x[i] < minX) minX = x[i]
      if (x[i] > maxX) maxX = x[i]
      if (y[i] < minY) minY = y[i]
      if (y[i] > maxY) maxY = y[i]
    }
    const size = Math.max(maxX - minX, maxY - minY, 1) + 1
    this.cell((minX + maxX) / 2, (minY + maxY) / 2, size)
    for (let i = 0; i < x.length; i++) this.insert(0, i, x, y, 0)
    this.sum(0, x, y, charge)
  }

  private insert(at: number, i: number, x: Float32Array, y: Float32Array, depth: number): void {
    for (;;) {
      if (this.child[at] < 0 && this.dot[at] < 0) {
        this.dot[at] = i
        return
      }
      if (this.child[at] < 0) {
        // A leaf that already holds a dot is split; two dots in one place stay together past some depth.
        if (depth > 40) return
        const other = this.dot[at]
        this.dot[at] = -1
        const half = this.size[at] / 2
        const first = this.used
        for (let k = 0; k < 4; k++) this.cell(this.midX[at] + (k & 1 ? half / 2 : -half / 2), this.midY[at] + (k & 2 ? half / 2 : -half / 2), half)
        this.child[at] = first
        this.place(at, other, x, y, depth)
      }
      const k = (x[i] >= this.midX[at] ? 1 : 0) + (y[i] >= this.midY[at] ? 2 : 0)
      at = this.child[at] + k
      depth++
    }
  }

  private place(at: number, i: number, x: Float32Array, y: Float32Array, depth: number): void {
    const k = (x[i] >= this.midX[at] ? 1 : 0) + (y[i] >= this.midY[at] ? 2 : 0)
    this.insert(this.child[at] + k, i, x, y, depth + 1)
  }

  private sum(at: number, x: Float32Array, y: Float32Array, charge: Float32Array): void {
    if (this.child[at] < 0) {
      const i = this.dot[at]
      if (i >= 0) {
        this.q[at] = charge[i]
        this.cx[at] = x[i]
        this.cy[at] = y[i]
      }
      return
    }
    let q = 0
    let sx = 0
    let sy = 0
    for (let k = 0; k < 4; k++) {
      const c = this.child[at] + k
      this.sum(c, x, y, charge)
      q += this.q[c]
      sx += this.cx[c] * this.q[c]
      sy += this.cy[c] * this.q[c]
    }
    this.q[at] = q
    this.cx[at] = q ? sx / q : this.midX[at]
    this.cy[at] = q ? sy / q : this.midY[at]
  }

  /** Adds to (fx, fy) of dot i the push of all the others: `scale · q_i · q_j / d`, along the line between them. */
  push(i: number, x: Float32Array, y: Float32Array, qi: number, scale: number, theta2: number, fx: Float32Array, fy: Float32Array): void {
    const stack = [0]
    const px = x[i]
    const py = y[i]
    let sx = 0
    let sy = 0
    while (stack.length) {
      const at = stack.pop()!
      if (!this.q[at]) continue
      const dx = px - this.cx[at]
      const dy = py - this.cy[at]
      const d2 = dx * dx + dy * dy
      const leaf = this.child[at] < 0
      if (leaf && this.dot[at] === i) continue
      if (leaf || (this.size[at] * this.size[at]) / d2 < theta2) {
        const near = Math.max(d2, 1)
        const f = (scale * qi * this.q[at]) / near
        sx += dx * f
        sy += dy * f
      } else for (let k = 0; k < 4; k++) stack.push(this.child[at] + k)
    }
    fx[i] += sx
    fy[i] += sy
  }
}

/** The layout of one graph: call `step` until `alpha` has come down. */
export class ForceLayout {
  readonly x: Float32Array
  readonly y: Float32Array
  private vx: Float32Array
  private vy: Float32Array
  private fx: Float32Array
  private fy: Float32Array
  private charge: Float32Array
  private groups: Float32Array
  private live: Uint8Array
  private tree = new Tree()
  /** Dots left where they were put (dropped with Shift): nothing moves them. */
  readonly held: Uint8Array
  alpha = 1
  alphaTarget = 0
  decay = 0.03
  /** A dot held in place (being dragged), or -1. */
  pinned = -1
  pinX = 0
  pinY = 0

  constructor(private input: LayoutInput) {
    const n = input.radius.length
    this.x = new Float32Array(n)
    this.y = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      this.x[i] = input.positions[i * 2]
      this.y[i] = input.positions[i * 2 + 1]
    }
    this.vx = new Float32Array(n)
    this.vy = new Float32Array(n)
    this.fx = new Float32Array(n)
    this.fy = new Float32Array(n)
    this.charge = new Float32Array(n)
    for (let i = 0; i < n; i++) this.charge[i] = chargeOf(input.degree[i])
    this.groups = new Float32Array(Math.max(1, input.clusters) * 4)
    this.live = new Uint8Array(Math.max(1, input.clusters))
    this.held = new Uint8Array(n)
    this.heldX = new Float32Array(n)
    this.heldY = new Float32Array(n)
  }

  private heldX: Float32Array
  private heldY: Float32Array

  /** Leaves a dot where it is (or lets it go again). */
  hold(i: number, on: boolean, at?: [number, number]): void {
    if (i < 0 || i >= this.x.length) return
    this.held[i] = on ? 1 : 0
    if (at) [this.x[i], this.y[i]] = at
    this.heldX[i] = this.x[i]
    this.heldY[i] = this.y[i]
  }

  get forces(): LayoutForces {
    return this.input.forces
  }

  set forces(next: LayoutForces) {
    this.input.forces = next
  }

  /** One step of the simulation; returns how far the dots moved, on average. */
  step(): number {
    const { x, y, vx, vy, fx, fy, charge, input } = this
    const { degree, radius, cluster, links, linkLength, linkStrength, forces } = input
    const n = x.length
    const alpha = this.alpha
    fx.fill(0)
    fy.fill(0)

    // ---- every dot pushes the others away
    const scale = forces.repel * REPEL_SCALE
    if (n <= 400) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let dx = x[i] - x[j]
          let dy = y[i] - y[j]
          let d2 = dx * dx + dy * dy
          if (d2 < 1e-6) {
            dx = (i - j) * 0.01
            dy = 0.01
            d2 = dx * dx + dy * dy
          }
          const f = (scale * charge[i] * charge[j]) / Math.max(d2, 1)
          fx[i] += dx * f
          fy[i] += dy * f
          fx[j] -= dx * f
          fy[j] -= dy * f
        }
      }
    } else {
      this.tree.build(x, y, charge)
      const theta2 = n > 3000 ? 1.4 : 1
      for (let i = 0; i < n; i++) this.tree.push(i, x, y, charge[i], scale, theta2, fx, fy)
    }

    // ---- links pull with the logarithm of their length; the end with fewer links follows
    for (let k = 0; k < links.length; k += 2) {
      const a = links[k]
      const b = links[k + 1]
      const dx = x[b] - x[a]
      const dy = y[b] - y[a]
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const rest = linkLength[k >> 1]
      const pull = (forces.attract * linkStrength[k >> 1] * rest * Math.log1p(d / rest)) / d
      const total = degree[a] + degree[b] || 1
      const toA = degree[b] / total
      const toB = degree[a] / total
      fx[a] += dx * pull * toA
      fy[a] += dy * pull * toA
      fx[b] -= dx * pull * toB
      fy[b] -= dy * pull * toB
    }

    // ---- groups hold together and keep apart; the middle and the ring hold everything
    const groups = groupForces(x, y, charge, cluster, input.clusters, forces.gather, this.groups, this.live)
    const ring = ringRadiusOf(x, y, degree, forces.ringRadius)
    for (let i = 0; i < n; i++) {
      const c = cluster[i]
      if (c >= 0 && this.live[c]) {
        fx[i] += (groups[c * 4] - x[i]) * GATHER_PULL * forces.gather + groups[c * 4 + 2]
        fy[i] += (groups[c * 4 + 1] - y[i]) * GATHER_PULL * forces.gather + groups[c * 4 + 3]
      }
      if (degree[i] > 0) {
        // As heavy as a dot pushes, so hard it is held: a hub does not drift to the edge.
        fx[i] -= x[i] * forces.gravity * charge[i]
        fy[i] -= y[i] * forces.gravity * charge[i]
      }
    }

    // ---- move
    let moved = 0
    for (let i = 0; i < n; i++) {
      if (this.held[i]) {
        vx[i] = vy[i] = 0
        continue
      }
      let nx = (vx[i] + fx[i] * alpha) * KEEP
      let ny = (vy[i] + fy[i] * alpha) * KEEP
      const speed = Math.sqrt(nx * nx + ny * ny)
      if (speed > MAX_SPEED) {
        nx *= MAX_SPEED / speed
        ny *= MAX_SPEED / speed
      }
      vx[i] = nx
      vy[i] = ny
      x[i] += nx
      y[i] += ny
      moved += Math.min(speed, MAX_SPEED)
    }

    // ---- the unlinked dots are drawn to their ring by place, not by force: the push of
    // the whole graph would otherwise carry them far out
    for (let i = 0; i < n; i++) {
      if (degree[i] > 0) continue
      const r = Math.sqrt(x[i] * x[i] + y[i] * y[i]) || 0.01
      const toRing = 1 + (ring / r - 1) * RING_PULL
      x[i] *= toRing
      y[i] *= toRing
    }

    // ---- dots that overlap are moved apart
    this.separate(radius)
    for (let i = 0; i < n; i++) if (this.held[i]) [x[i], y[i]] = [this.heldX[i], this.heldY[i]]
    if (this.pinned >= 0 && this.pinned < n) {
      x[this.pinned] = this.pinX
      y[this.pinned] = this.pinY
      vx[this.pinned] = vy[this.pinned] = 0
    }
    this.alpha += (this.alphaTarget - this.alpha) * this.decay
    return n ? moved / n : 0
  }

  /** Pushes apart dots that overlap, looking only at neighbouring cells of a grid. */
  private separate(radius: Float32Array): void {
    const { x, y } = this
    const n = x.length
    if (n < 2) return
    let largest = 0
    for (let i = 0; i < n; i++) largest = Math.max(largest, radius[i])
    const cell = largest * 2 + 4
    const grid = new Map<number, number[]>()
    const key = (gx: number, gy: number) => gx * 100003 + gy
    for (let i = 0; i < n; i++) {
      const k = key(Math.floor(x[i] / cell), Math.floor(y[i] / cell))
      const list = grid.get(k)
      if (list) list.push(i)
      else grid.set(k, [i])
    }
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(x[i] / cell)
      const gy = Math.floor(y[i] / cell)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const list = grid.get(key(gx + ox, gy + oy))
          if (!list) continue
          for (const j of list) {
            if (j <= i) continue
            const dx = x[j] - x[i]
            const dy = y[j] - y[i]
            const room = radius[i] + radius[j] + 2
            const d2 = dx * dx + dy * dy
            if (d2 >= room * room) continue
            const d = Math.sqrt(d2) || 0.01
            const shift = ((room - d) / d) * 0.4
            x[i] -= dx * shift
            y[i] -= dy * shift
            x[j] += dx * shift
            y[j] += dy * shift
          }
        }
      }
    }
  }

  /** The places of all dots, as x, y pairs. */
  positions(out = new Float32Array(this.x.length * 2)): Float32Array {
    for (let i = 0; i < this.x.length; i++) {
      out[i * 2] = this.x[i]
      out[i * 2 + 1] = this.y[i]
    }
    return out
  }
}
