/// <reference lib="webworker" />
// The force layout on a thread of its own. However long a step takes for a big
// graph, the page stays free to pan, zoom and draw; it only receives the new
// places of the dots as they are worked out. The physics is the page's own (physics.ts).
import { ForceLayout, type LayoutInput } from './physics'

export type ToWorker =
  | { type: 'load'; input: LayoutInput; alpha: number; decay: number }
  | { type: 'heat'; alpha: number }
  | { type: 'hold'; target: number }
  | { type: 'pin'; index: number; x: number; y: number }
  | { type: 'keep'; index: number; on: boolean; x: number; y: number }
  | { type: 'stop' }

export interface FromWorker {
  positions: Float32Array
  alpha: number
  /** Milliseconds the last step took. */
  took: number
  /** Which `load` these places belong to. */
  generation: number
}

let layout: ForceLayout | null = null
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined

function loop(): void {
  clearTimeout(timer)
  const run = () => {
    if (!layout) return
    if (layout.alpha < 0.002 && !layout.alphaTarget) return
    const began = performance.now()
    layout.step()
    const positions = layout.positions()
    const message: FromWorker = { positions, alpha: layout.alpha, took: performance.now() - began, generation }
    postMessage(message, [positions.buffer])
    // A pause between steps lets messages from the page in (a drag, a new graph).
    timer = setTimeout(run)
  }
  timer = setTimeout(run)
}

onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data
  if (message.type === 'load') {
    generation++
    layout = new ForceLayout(message.input)
    layout.decay = message.decay
    layout.alpha = message.alpha
    loop()
  } else if (!layout) return
  else if (message.type === 'heat') {
    layout.alpha = Math.max(layout.alpha, message.alpha)
    loop()
  } else if (message.type === 'hold') {
    layout.alphaTarget = message.target
    if (!message.target) layout.pinned = -1
    loop()
  } else if (message.type === 'pin') {
    layout.pinned = message.index
    layout.pinX = message.x
    layout.pinY = message.y
  } else if (message.type === 'keep') {
    layout.hold(message.index, message.on, [message.x, message.y])
  } else if (message.type === 'stop') {
    clearTimeout(timer)
    layout = null
  }
}
