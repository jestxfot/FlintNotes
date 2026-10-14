/**
 * Finds the groups of a graph by modularity (the Louvain method): sets of notes
 * that are linked to one another much more than chance would link them. Every
 * note in turn moves to the neighbouring group where it adds most to the
 * modularity; then each group becomes a single note of a smaller graph, and the
 * same is done again, until nothing moves. Takes milliseconds for thousands of notes.
 *
 * Returns the group of every note, numbered from 0 by size (largest first); a note
 * without links, or alone in its group, gets -1.
 */
export function findGroups(count: number, links: Uint32Array, resolution = 1): Int32Array {
  // The graph of the current level: weighted, undirected, as lists of neighbours.
  let size = count
  let edges: Map<number, number>[] = Array.from({ length: count }, () => new Map())
  for (let k = 0; k < links.length; k += 2) {
    const a = links[k]
    const b = links[k + 1]
    if (a === b) continue
    edges[a].set(b, (edges[a].get(b) ?? 0) + 1)
    edges[b].set(a, (edges[b].get(a) ?? 0) + 1)
  }
  /** For every note of the original graph, the node it is part of at the current level. */
  const member = Int32Array.from({ length: count }, (_, i) => i)
  let total = 0
  for (const list of edges) for (const w of list.values()) total += w
  if (!total) return new Int32Array(count).fill(-1)
  const m2 = total // twice the sum of the weights, since each link is counted from both ends

  for (let level = 0; level < 10; level++) {
    const strength = new Float64Array(size)
    const self = new Float64Array(size)
    for (let i = 0; i < size; i++) for (const [j, w] of edges[i]) (j === i ? (self[i] += w) : (strength[i] += w))
    for (let i = 0; i < size; i++) strength[i] += self[i]
    const group = Int32Array.from({ length: size }, (_, i) => i)
    const groupTotal = Float64Array.from(strength)
    let movedAny = false
    // A fixed order (by index) keeps the result the same from one opening to the next.
    for (let pass = 0; pass < 20; pass++) {
      let moved = 0
      for (let i = 0; i < size; i++) {
        const own = group[i]
        const ki = strength[i]
        // The weight of i's links into each neighbouring group.
        const into = new Map<number, number>()
        for (const [j, w] of edges[i]) if (j !== i) into.set(group[j], (into.get(group[j]) ?? 0) + w)
        groupTotal[own] -= ki
        let best = own
        let gain = (into.get(own) ?? 0) - (resolution * groupTotal[own] * ki) / m2
        for (const [g, w] of into) {
          if (g === own) continue
          const next = w - (resolution * groupTotal[g] * ki) / m2
          if (next > gain + 1e-12) [best, gain] = [g, next]
        }
        groupTotal[best] += ki
        if (best !== own) {
          group[i] = best
          moved++
        }
      }
      if (!moved) break
      movedAny = true
    }
    if (!movedAny) break
    // Every group becomes one node of the next level.
    const renumber = new Map<number, number>()
    for (let i = 0; i < size; i++) if (!renumber.has(group[i])) renumber.set(group[i], renumber.size)
    const next: Map<number, number>[] = Array.from({ length: renumber.size }, () => new Map())
    for (let i = 0; i < size; i++) {
      const gi = renumber.get(group[i])!
      for (const [j, w] of edges[i]) {
        const gj = renumber.get(group[j])!
        next[gi].set(gj, (next[gi].get(gj) ?? 0) + w)
      }
    }
    for (let v = 0; v < count; v++) member[v] = renumber.get(group[member[v]])!
    if (renumber.size === size) break
    size = renumber.size
    edges = next
  }

  // A last look on the notes themselves: a note on a bridge between two groups may have been
  // carried into the wrong one with its neighbour at a lower level, where it could not leave
  // on its own. Each note moves once more to the group of its neighbours where it adds most.
  const original: Map<number, number>[] = Array.from({ length: count }, () => new Map())
  for (let k = 0; k < links.length; k += 2) {
    const a = links[k]
    const b = links[k + 1]
    if (a === b) continue
    original[a].set(b, (original[a].get(b) ?? 0) + 1)
    original[b].set(a, (original[b].get(a) ?? 0) + 1)
  }
  const degree = original.map((list) => [...list.values()].reduce((sum, w) => sum + w, 0))
  const groupTotal = new Map<number, number>()
  for (let v = 0; v < count; v++) groupTotal.set(member[v], (groupTotal.get(member[v]) ?? 0) + degree[v])
  for (let pass = 0; pass < 10; pass++) {
    let moved = 0
    for (let v = 0; v < count; v++) {
      const own = member[v]
      const kv = degree[v]
      if (!kv) continue
      const into = new Map<number, number>()
      for (const [u, w] of original[v]) into.set(member[u], (into.get(member[u]) ?? 0) + w)
      groupTotal.set(own, groupTotal.get(own)! - kv)
      let best = own
      let gain = (into.get(own) ?? 0) - (resolution * groupTotal.get(own)! * kv) / m2
      for (const [g, w] of into) {
        if (g === own) continue
        const next = w - (resolution * groupTotal.get(g)! * kv) / m2
        if (next > gain + 1e-12) [best, gain] = [g, next]
      }
      groupTotal.set(best, groupTotal.get(best)! + kv)
      if (best !== own) {
        member[v] = best
        moved++
      }
    }
    if (!moved) break
  }

  // Numbered by size, largest first; a group of one is no group.
  const sizes = new Map<number, number>()
  for (let v = 0; v < count; v++) sizes.set(member[v], (sizes.get(member[v]) ?? 0) + 1)
  const order = [...sizes].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const rank = new Map(order.map(([g], i) => [g, i]))
  return Int32Array.from(member, (g) => rank.get(g) ?? -1)
}
