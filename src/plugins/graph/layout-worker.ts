/// <reference lib="webworker" />
// The force layout on a thread of its own. However long a step takes for a big
// graph, the page stays free to pan, zoom and draw; it only receives the new
// places of the dots as they are worked out.
import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3-force'
import type { LayoutInput } from './gpu-layout'

export type ToWorker =
  | { type: 'load'; input: LayoutInput; alpha: number; decay: number }
  | { type: 'heat'; alpha: number }
  | { type: 'hold'; target: number }
  | { type: 'pin'; index: number; x: number; y: number }
  | { type: 'stop' }

export interface FromWorker {
  positions: Float32Array
  alpha: number
  /** Milliseconds the last step took. */
  took: number
  /** Which `load` these places belong to. */
  generation: number
}

interface Dot extends SimulationNodeDatum {
  index: number
}

let simulation: Simulation<Dot, { source: number | Dot; target: number | Dot }> | null = null
let dots: Dot[] = []
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
let pinned = -1

function loop(): void {
  clearTimeout(timer)
  const run = () => {
    if (!simulation) return
    if (simulation.alpha() < simulation.alphaMin() && !simulation.alphaTarget()) return
    const began = performance.now()
    simulation.tick()
    const positions = new Float32Array(dots.length * 2)
    for (let i = 0; i < dots.length; i++) {
      positions[i * 2] = dots[i].x ?? 0
      positions[i * 2 + 1] = dots[i].y ?? 0
    }
    const message: FromWorker = { positions, alpha: simulation.alpha(), took: performance.now() - began, generation }
    postMessage(message, [positions.buffer])
    // A pause between steps lets messages from the page in (a drag, a new graph).
    timer = setTimeout(run)
  }
  timer = setTimeout(run)
}

onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data
  if (message.type === 'load') {
    const { input } = message
    generation++
    pinned = -1
    const count = input.charge.length
    dots = Array.from({ length: count }, (_, index) => ({ index, x: input.positions[index * 2], y: input.positions[index * 2 + 1] }))
    const links = input.links.map((link) => ({ source: link.source, target: link.target }))
    simulation = forceSimulation(dots)
      .stop()
      .velocityDecay(0.5)
      .alphaDecay(message.decay)
      .force('charge', forceManyBody<Dot>().strength((dot) => input.charge[dot.index]).distanceMax(input.distanceMax).theta(count > 1500 ? 1.4 : 1.1))
      .force('link', forceLink<Dot, (typeof links)[number]>(links).distance((_, i) => input.links[i].distance).strength((_, i) => input.links[i].strength))
      .force('x', forceX<Dot>().strength((dot) => input.gravity[dot.index]))
      .force('y', forceY<Dot>().strength((dot) => input.gravity[dot.index]))
      .force('ring', forceRadial<Dot>(input.ringRadius).strength((dot) => input.ring[dot.index]))
    // Keeping thousands of dots from touching costs as much as everything else together; they are small enough to do without.
    if (count <= 3000) simulation.force('collide', forceCollide<Dot>((dot) => input.radius[dot.index] + 2).strength(0.8))
    simulation.alpha(message.alpha)
    loop()
  } else if (!simulation) return
  else if (message.type === 'heat') {
    simulation.alpha(Math.max(simulation.alpha(), message.alpha))
    loop()
  } else if (message.type === 'hold') {
    simulation.alphaTarget(message.target)
    if (!message.target && pinned >= 0) {
      dots[pinned].fx = dots[pinned].fy = null
      pinned = -1
    }
    loop()
  } else if (message.type === 'pin') {
    if (pinned >= 0 && pinned !== message.index) dots[pinned].fx = dots[pinned].fy = null
    pinned = message.index
    if (dots[pinned]) Object.assign(dots[pinned], { fx: message.x, fy: message.y })
  } else if (message.type === 'stop') {
    clearTimeout(timer)
    simulation = null
  }
}
