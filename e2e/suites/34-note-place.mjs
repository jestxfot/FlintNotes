// A note opens where it was left: by Back and Forward, and when opened again.
const long = Array.from({ length: 400 }, (_, i) => `Line ${i + 1} of a long note`).join('\n') + '\n'
export const vault = { settings: { core: { reuseTab: true } }, files: { 'Long.md': long, 'Other.md': 'other\n' } }

export async function run(t) {
  const { page, ok, wait } = t
  const state = () =>
    page.evaluate(() => {
      const view = app.workspace.activeEditor
      if (!view) return null
      const head = view.state.selection.main.head
      const scroller = view.scrollDOM
      const above = scroller.getBoundingClientRect().top - view.documentTop
      return { path: app.workspace.active.path, line: view.state.doc.lineAt(head).number, top: view.state.doc.lineAt(view.lineBlockAtHeight(Math.max(0, above) + 2).from).number }
    })
  await page.evaluate(() => app.workspace.openFile('Long.md'))
  await wait(800)
  // The cursor on line 250, line 240 at the top of the screen.
  await page.evaluate(() => {
    const view = app.workspace.activeEditor
    view.focus()
    view.dispatch({ selection: { anchor: view.state.doc.line(250).from + 3 } })
    const scroller = view.scrollDOM
    const offset = view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop
    scroller.scrollTop = Math.ceil(view.lineBlockAt(view.state.doc.line(240).from).top + offset)
  })
  await wait(900)
  const left = await state()
  await page.evaluate(() => app.workspace.openFile('Other.md'))
  await wait(800)
  await page.evaluate(() => history.back())
  await wait(1200)
  const back = await state()
  ok('Back returns to the note where it was left: the same cursor and the same lines on screen', back?.path === 'Long.md' && back.line === left.line && Math.abs(back.top - left.top) <= 1, JSON.stringify({ left, back }))

  // Closed and opened again.
  const savedBefore = await page.evaluate(() => { const p = app.positions.get('Long.md'); const d = app.workspace.activeEditor.state.doc; return p && { line: d.lineAt(p.head).number, top: d.lineAt(p.top).number } })
  await page.evaluate(() => app.workspace.leaves.filter((leaf) => leaf.path === 'Long.md').forEach((leaf) => app.workspace.close(leaf, true)))
  await wait(500)
  await page.evaluate(() => app.workspace.openFile('Long.md'))
  await wait(1200)
  const again = await state()
  ok('opened again, the note is where it was left', again?.line === left.line && Math.abs(again.top - left.top) <= 1, JSON.stringify({ left, again, savedBefore, savedAfter: await page.evaluate(() => { const p = app.positions.get('Long.md'); const d = app.workspace.activeEditor.state.doc; return p && { line: d.lineAt(p.head).number, top: d.lineAt(p.top).number } }) }))

  // Opened at a line asked for: that line wins.
  await page.evaluate(() => app.workspace.openFile('Long.md', { line: 9 }))
  await wait(900)
  ok('a note opened at a line (a search, a heading) goes to that line', (await state())?.line === 10)

  // Switched off: notes open at their start.
  await page.evaluate(() => app.settings.set('core', 'rememberPosition', false))
  await page.evaluate(() => app.workspace.leaves.forEach((leaf) => app.workspace.close(leaf, true)))
  await wait(400)
  await page.evaluate(() => app.workspace.openFile('Long.md'))
  await wait(1000)
  ok('with the setting off a note opens at its start', (await state())?.line === 1, JSON.stringify(await state()))
}
