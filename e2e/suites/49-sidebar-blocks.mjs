// A sidebar holds any number of blocks one under another, each with its row of widgets: a widget dragged onto
// the lower part of a block, or into the room below the blocks, stands on its own there; its menu does the same.
export const vault = {
  plugins: ['calendar', 'backlinks', 'outline', 'tasks'],
  files: { 'Note.md': '# Note\n\n## Part\n\ntext\n' },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  await t.open('Note')
  await wait(800)
  const right = page.locator('aside.right')
  const tab = (name) => right.locator(`.widget-tab[title="${name}"]`)
  const blocks = () => page.evaluate(() => app.panels.groups('right').map((group) => group.entries.map((entry) => entry.def.title).join('+')))
  // All widgets of the right sidebar in one block to begin with.
  await page.evaluate(() => {
    for (const group of app.panels.groups('right').slice(1)) for (const entry of group.entries) app.panels.move(entry.def.id, 'right', app.panels.groups('right')[0].index, 99)
  })
  await wait(400)
  ok('to begin with, one block of widgets', (await blocks()).length === 1, JSON.stringify(await blocks()))

  /** Drags a widget's icon by hand to a point (the drop places open up only once a drag is under way). */
  const dragTo = async (from, point) => {
    const box = await from.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2 + 6, { steps: 4 })
    await wait(300)
    const to = await point()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await wait(250)
    const shown = await right.locator('.group.split-after, .group.split-before, .gap.last.over').count()
    await page.mouse.up()
    await wait(700)
    return shown
  }

  await tab('Оглавление').click()
  await wait(300)
  const panelBox = async () => {
    const box = await right.locator('.group').first().boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height * 0.85 }
  }
  const previewed = await dragTo(tab('Календарь'), panelBox)
  ok('over the lower part of a block, the place of a new block is shown', previewed === 1)
  let now = await blocks()
  ok('dropped there, the widget is a block of its own below', now.length === 2 && now[1] === 'Календарь', JSON.stringify(now))

  // Into the room below the last block (the calendar takes only its own height).
  const below = async () => {
    const box = await right.locator('.gap.last').boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  await dragTo(tab('Задачи'), below)
  now = await blocks()
  ok('the room below the blocks takes a widget as a new block at the bottom', now.length === 3 && now[2] === 'Задачи', JSON.stringify(now))

  // From the menu of a widget's icon.
  await tab('Обратные ссылки').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Отдельным блоком ниже' }).click()
  await wait(500)
  now = await blocks()
  ok('«Отдельным блоком ниже» from the menu', now.length === 4 && now[1] === 'Обратные ссылки', JSON.stringify(now))
  await tab('Задачи').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'В блок выше' }).click()
  await wait(500)
  now = await blocks()
  ok('«В блок выше» puts it among the widgets of the block above', now.length === 3 && now[2] === 'Календарь+Задачи', JSON.stringify(now))
  await wait(800)
  const kept = JSON.parse(read('.flint/workspace.json')).layout.right.map((group) => group.tabs.length)
  ok('the blocks are kept in the layout of the vault', kept.length === 3, JSON.stringify(kept))
}
