// The physics of the graph: groups found by modularity become islands, leaves stay by their hubs,
// a note dropped with Shift stays put, and places remembered from another physics are not kept.
const files = { '.obsidian/app.json': '{}' }
const link = (from, to) => (files[`${from}.md`] = `${files[`${from}.md`] ?? ''}[[${to}]]\n`)
// Two tight groups of twelve notes, each linked all round, joined by a single thread.
for (const side of ['Red', 'Blue']) {
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j += 2) link(`${side} ${i}`, `${side} ${j}`)
  // A hub of the group with eight notes that link only to it.
  for (let k = 0; k < 8; k++) link(`${side} leaf ${k}`, `${side} 0`)
}
link('Red 5', 'Blue 5')
// Places remembered by the old physics: a flat map, all in one spot.
files['.flint/graph-layout.json'] = JSON.stringify(Object.fromEntries(Object.keys(files).filter((f) => f.endsWith('.md')).map((f) => [f, [0, 0]])))

export const viewport = { width: 1400, height: 900 }
export const vault = { plugins: ['graph'], settings: { graph: { gpuLayout: 'off' } }, files }

export async function run(t) {
  const { page, ok, wait, read } = t
  await page.waitForFunction(() => window.app?.commands?.list().some((c) => c.id === 'graph:open'), null, { timeout: 20000 })
  await page.evaluate(() => app.metadata.ready)
  await page.evaluate(() => app.commands.run('graph:open'))
  await page.waitForSelector(`${t.leaf} .graph-view canvas`, { timeout: 15000 })
  await page.waitForFunction(() => app.workspace.active.view?.alpha < 0.003, null, { timeout: 30000 }).catch(() => {})
  await wait(500)
  const state = await page.evaluate(() => {
    const nodes = app.workspace.active.view.nodes
    const at = (name) => nodes.find((n) => n.label === name)
    const group = (prefix) => nodes.filter((n) => n.label.startsWith(prefix) && !n.label.includes('leaf'))
    const centre = (list) => [list.reduce((s, n) => s + n.x, 0) / list.length, list.reduce((s, n) => s + n.y, 0) / list.length]
    const spread = (list, [cx, cy]) => Math.sqrt(list.reduce((s, n) => s + (n.x - cx) ** 2 + (n.y - cy) ** 2, 0) / list.length)
    const red = group('Red '), blue = group('Blue ')
    const rc = centre(red), bc = centre(blue)
    const leaves = nodes.filter((n) => n.label.startsWith('Red leaf'))
    const hub = at('Red 0')
    const leafLength = leaves.map((n) => Math.hypot(n.x - hub.x, n.y - hub.y)).sort((a, b) => a - b)[4]
    const between = Math.hypot(rc[0] - bc[0], rc[1] - bc[1])
    return {
      // No group mixes the two sides; the leaves are with their hub.
      groups: !red.some((r) => blue.some((b) => b.cluster === r.cluster)) && leaves.every((n) => n.cluster === hub.cluster),
      ids: [red.map((n) => n.cluster).join(','), blue.map((n) => n.cluster).join(','), leaves.map((n) => n.cluster).join(',')],
      separation: between / (spread(red, rc) + spread(blue, bc)),
      leafLength,
      between,
      spread: spread([...red, ...blue], centre([...red, ...blue])),
    }
  })
  ok('groups are found by modularity, the leaves in the group of their hub', state.groups, JSON.stringify(state))
  ok('the two groups are islands, apart from each other', state.separation > 1.3, JSON.stringify(state))
  ok('notes with a single link stay by the note they link to', state.leafLength < state.between / 3, JSON.stringify(state))
  ok('places remembered from the old physics are not kept: the graph was laid out anew', state.spread > 30, JSON.stringify(state))

  // ---- a note dropped with Shift stays where it was put
  const where = async (name) => page.evaluate((name) => {
    const view = app.workspace.active.view
    const n = view.nodes.find((one) => one.label === name)
    const screen = view.positionOf(n.id)
    return { sx: screen.x, sy: screen.y, x: n.x, y: n.y }
  }, name)
  const before = await where('Blue 3')
  await page.mouse.move(before.sx, before.sy)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(before.sx + 160, before.sy + 120, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await wait(300)
  const dropped = await where('Blue 3')
  await page.evaluate(() => app.workspace.active.view.heat?.(0.6))
  await page.waitForFunction(() => app.workspace.active.view?.alpha < 0.003, null, { timeout: 30000 }).catch(() => {})
  const later = await where('Blue 3')
  ok('a note dropped with Shift stays where it was put while the rest moves', Math.hypot(later.x - dropped.x, later.y - dropped.y) < 1 && Math.hypot(dropped.x - before.x, dropped.y - before.y) > 40, JSON.stringify({ before, dropped, later }))
  // The places are written a moment after the layout has come to rest.
  const savedNow = () => { try { return JSON.parse(read('.flint/graph-layout.json')) } catch { return {} } }
  for (let i = 0; i < 24 && savedNow().physics !== 2; i++) await wait(500)
  const saved = savedNow()
  const why = await page.evaluate(() => { const v = app.workspace.active.view; return { alpha: v.alpha, target: v.alphaTarget, engine: v.engine, frame: v.frame, layoutAlpha: v.layout?.alpha } })
  ok('the places are remembered with the physics they come from', saved.physics === 2 && Array.isArray(saved.places?.['Red 0.md']), JSON.stringify(why) + JSON.stringify(saved).slice(0, 80))
}
