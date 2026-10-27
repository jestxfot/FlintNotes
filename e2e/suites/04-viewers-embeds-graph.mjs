// File viewers (image, PDF, DOCX), `![[embeds]]` of notes and documents, and the graph.
import { fixture } from '../helpers.mjs'

export const viewport = { width: 1300, height: 1400 }
const B = '---\ntags: [x]\n---\n# B\n\nintro text\n\n## Section\n\n- [ ] task in B\n\n## Other\n\nother text [[C]]\n'
export const vault = {
  plugins: ['links', 'graph', 'pdf-viewer', 'docx-viewer', 'image-viewer'],
  files: {
    'pic.png': fixture('pic.png'),
    'doc.pdf': fixture('doc.pdf'),
    'sample.docx': fixture('sample.docx'),
    'A.md': '# A\n\nLinks: [[B]] [[C]] [[Ghost]]\n\n![[B]]\n\n![[B#Section]]\n\n![[doc.pdf|300]]\n\n![[sample.docx|200]]\n\nend\n',
    'B.md': B,
    'C.md': '# C\n\nloop ![[C]]\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read, leaf } = t
  const graph = (fn) => page.evaluate(fn)

  await t.row('pic.png').click()
  await wait(500)
  ok('image viewer', (await page.evaluate(() => document.querySelector('.image-view img')?.naturalWidth)) === 40)
  await t.row('doc.pdf').click()
  await wait(500)
  // The test browser has no PDF viewer, so only the frame and its address can be checked.
  ok('pdf viewer frame', (await page.locator(`${leaf} iframe.pdf-frame`).getAttribute('src'))?.includes('doc.pdf'))
  await t.row('sample.docx').click()
  await wait(1500)
  let text = await page.locator(leaf).innerText()
  ok('docx viewer renders text', text.includes('Hello from docx') && text.includes('Второй абзац'), text.slice(0, 200))

  await t.open('A')
  await wait(1000)
  const embeds = page.locator(`${leaf} > .cm-editor > .cm-scroller > .cm-content > .cm-line > .lp-embed`)
  ok('four embeds in A', (await embeds.count()) === 4, await embeds.count())
  const first = await embeds.nth(0).innerText()
  const second = await embeds.nth(1).innerText()
  ok('note embed shows the note without frontmatter', first.includes('intro text') && first.includes('task in B') && first.includes('other text') && !first.includes('tags:') && !first.includes('# B'), first)
  ok('section embed shows only its section', second.includes('task in B') && !second.includes('intro text') && !second.includes('other text') && second.includes('B › Section'), second)
  ok('pdf embed with height', (await embeds.nth(2).locator('iframe').evaluate((frame) => frame.style.height)) === '300px')
  ok('docx embed renders', (await embeds.nth(3).innerText()).includes('Hello from docx'))
  ok('wikilink inside an embed rendered', (await embeds.nth(0).locator('.lp-wikilink').count()) === 1)

  await embeds.nth(0).locator('.lp-checkbox').click()
  await wait(1500)
  ok('checkbox in an embed edits the embedded file', read('B.md').includes('- [x] task in B') && read('B.md').startsWith('---\ntags: [x]\n---\n# B'), read('B.md'))
  ok('both embeds follow the file', (await page.locator(`${leaf} .lp-embed .lp-checkbox:checked`).count()) === 2)
  await embeds.nth(1).locator('.lp-checkbox').click()
  await wait(1500)
  ok('checkbox in a section embed edits only its section', read('B.md') === B, JSON.stringify(read('B.md')))

  await t.row('C').click()
  await wait(1200)
  ok('a note embedding itself stops nesting', (await page.locator(`${leaf} .lp-embed`).count()) === 3, await page.locator(`${leaf} .lp-embed`).count())
  ok('the deepest level falls back to a link', (await page.locator(`${leaf} .lp-embed .lp-embed .lp-embed .lp-wikilink`).count()) === 1)

  await t.tab('A').click()
  await wait(300)
  await embeds.nth(1).locator('.lp-embed-title').click()
  await wait(600)
  const line = await page.evaluate(() => {
    const { state } = app.workspace.activeEditor
    return state.doc.lineAt(state.selection.main.head).text
  })
  ok('embed title opens the note at the heading', (await t.activeTab()) === 'B' && line === '## Section', line)

  await page.keyboard.press('Control+g')
  await wait(2500)
  ok('graph opens in a tab', (await t.activeTab()) === 'Граф')
  const state = await graph(() => {
    const canvas = document.querySelector('.graph-view canvas')
    return { nodes: app.workspace.active.view.nodes.map((node) => node.id).sort(), width: canvas.width, height: canvas.height }
  })
  ok('graph has the notes and a ghost, no attachments', JSON.stringify(state.nodes) === JSON.stringify(['?ghost', 'A.md', 'B.md', 'C.md']) && state.width > 0 && state.height > 0, JSON.stringify(state))
  const painted = await graph(() => {
    // The picture is drawn by the graphics card; it is read back right after a draw, before the frame is handed over.
    const view = app.workspace.active.view
    const canvas = document.querySelector('.graph-view canvas')
    const gl = canvas.getContext('webgl2')
    view.draw()
    let pixels = 0
    if (gl) {
      const data = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
      for (let i = 3; i < data.length; i += 4) if (data[i]) pixels++
    } else {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      for (let i = 3; i < data.length; i += 4) if (data[i]) pixels++
    }
    const names = document.querySelector('.graph-view .graph-labels')
    const text = names.getContext('2d').getImageData(0, 0, names.width, names.height).data
    let labelled = 0
    for (let i = 3; i < text.length; i += 4) if (text[i]) labelled++
    window.__graph = { webgl: !!gl, labelled }
    return pixels
  })
  ok('graph is drawn', painted > 200, painted)
  const how = await graph(() => window.__graph)
  ok('lines and dots are drawn by the graphics card, names over them', how.webgl && how.labelled > 100, JSON.stringify(how))
  const position = await graph(() => app.workspace.active.view.positionOf('C.md'))
  await page.mouse.move(position.x, position.y)
  await wait(100)
  ok('hover marks a node', (await t.count('.graph-view.over-node')) === 1)
  await page.mouse.click(position.x, position.y)
  await wait(500)
  ok('click on a node opens its note', (await t.activeTab()) === 'C')

  await page.reload()
  await page.waitForSelector('.tab')
  await wait(2500)
  ok('graph tab restored after reload', (await t.tab('Граф').count()) === 1)
  await t.tab('Граф').click()
  await wait(1500)
  ok('restored graph works', (await graph(() => app.workspace.active.view?.nodes?.length)) === 4)

  await t.tab('A').click()
  await wait(800)
  await t.cursorToEnd()
  await wait(300)
  await page.keyboard.press('Control+Comma')
  await page.locator('nav button', { hasText: 'Плагины' }).click()
  const plug = (name) => page.locator('label.item', { hasText: name }).locator('input')
  await plug('Номера строк').check()
  await wait(500)
  ok('editor plugins skip embedded previews', (await page.locator(`${leaf} > .cm-editor > .cm-scroller > .cm-gutters`).count()) === 1 && (await page.locator(`${leaf} .lp-embed .cm-lineNumbers`).count()) === 0)
  await plug('Просмотр PDF').uncheck()
  await wait(500)
  await page.keyboard.press('Escape')
  await wait(300)
  ok('disabling the pdf plugin turns its embed into a link', (await embeds.count()) === 3 && (await page.locator(`${leaf} .lp-wikilink`, { hasText: 'doc.pdf' }).count()) === 1)
  await t.tab('doc.pdf').click()
  await wait(300)
  ok('pdf tab falls back', (await page.locator(leaf).innerText()).includes('Нет включённого плагина'))

  // ---- the graph's settings panel
  const ids = () => graph(() => app.workspace.active.view.nodes.map((n) => n.id).sort())
  await t.tab('Граф').click()
  await wait(500)
  await page.locator('.graph-open').click()
  const panel = page.locator('.graph-panel')
  ok('the panel has the four sections of Obsidian', (await t.flat(panel)).replace(/[\d.]+/g, '').includes('Фильтры') && (await panel.locator('.graph-section-title').allInnerTexts()).join('|') === 'Фильтры|Группировка|Отображение|Силы', await t.flat(panel))
  const row = (name) => panel.locator('.graph-row', { hasText: name }).locator('input')
  await row('Только созданные заметки').check()
  await wait(500)
  ok('"existing notes only" hides notes that are only linked to', JSON.stringify(await ids()) === JSON.stringify(['A.md', 'B.md', 'C.md']), JSON.stringify(await ids()))
  await row('Вложения').check()
  await wait(500)
  ok('attachments can be shown', (await ids()).includes('doc.pdf'), JSON.stringify(await ids()))
  await row('Вложения').uncheck()
  await panel.locator('.graph-search').fill('file:a OR file:b')
  await wait(800)
  ok('the search keeps matching notes only', JSON.stringify(await ids()) === JSON.stringify(['A.md', 'B.md']), JSON.stringify(await ids()))
  await panel.locator('.graph-search').fill('')
  await panel.locator('button', { hasText: 'Новая группа' }).click()
  await panel.locator('.graph-group input').first().fill('file:c')
  await wait(800)
  const colours = await graph(() => app.workspace.active.view.nodes.map((n) => [n.id, n.color ?? null]))
  ok('a colour group paints the notes it matches', colours.filter(([, c]) => c).length === 1 && colours.find(([id]) => id === 'C.md')[1].startsWith('rgb('), JSON.stringify(colours))
  await panel.locator('.graph-slider', { hasText: 'Размер узла' }).locator('input').evaluate((input) => {
    input.value = '2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(300)
  await wait(1500)
  const saved = JSON.parse(read('.flint/workspace.json')).graph
  ok("settings are kept under Obsidian's names", saved?.hideUnresolved === true && saved.nodeSizeMultiplier === 2 && saved.colorGroups[0].query === 'file:c' && typeof saved.colorGroups[0].color.rgb === 'number' && saved.close === false, JSON.stringify(saved))
  // The layout can be worked out by the graphics card; for a big graph it is by default.
  await panel.locator('.graph-search').fill('')
  await wait(600)
  const spots = () => graph(() => app.workspace.active.view.nodes.map((n) => [Math.round(n.x), Math.round(n.y)]))
  await panel.locator('.graph-row', { hasText: 'Расчёт раскладки' }).locator('select').selectOption('on')
  await wait(2500)
  const onCard = await graph(() => ({ gpu: app.workspace.active.view.engine === 'gpu', spots: app.workspace.active.view.nodes.map((n) => [n.x, n.y]) }))
  const apart = onCard.spots.every(([x, y], i) => Number.isFinite(x) && Number.isFinite(y) && onCard.spots.every(([x2, y2], j) => i === j || Math.hypot(x - x2, y - y2) > 8))
  ok('the graphics card lays the graph out: every note has a place of its own', onCard.gpu && apart, JSON.stringify(onCard))
  // Once the movement has died down, the dots stay where they are.
  await page.waitForFunction(() => app.workspace.active.view.alpha < 0.003, null, { timeout: 15000 }).catch(() => {})
  const settled = await spots()
  await wait(1500)
  ok('and the layout comes to rest', JSON.stringify(await spots()) === JSON.stringify(settled), JSON.stringify(settled))
  await panel.locator('.graph-row', { hasText: 'Расчёт раскладки' }).locator('select').selectOption('auto')
  ok('the panel says who lays the graph out and how long it takes', /точек, \d+ связей · раскладка: .* · кадр [\d.]+ мс/.test(await panel.locator('.graph-stats').innerText()), await panel.locator('.graph-stats').innerText())
  await wait(2500)
  // The places are written once the layout has come to rest.
  for (let i = 0; i < 20 && !t.exists('.flint/graph-layout.json'); i++) await wait(500)
  const layoutFile = t.exists('.flint/graph-layout.json') ? JSON.parse(read('.flint/graph-layout.json')) : {}
  ok('the places of the notes are remembered for the next time, with the physics they come from', layoutFile.physics === 2 && Array.isArray(layoutFile.places?.['A.md']) && layoutFile.places['A.md'].length === 2, JSON.stringify(layoutFile))
  await panel.locator('.graph-tool[title="Закрыть"]').click()
  ok('the panel closes to a button', (await panel.isHidden()) && (await page.locator('.graph-open').isVisible()))
}
