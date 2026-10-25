// A button of the frame goes anywhere: to the top or the bottom of a strip along the edge, the tab strip, the header
// above a note, the status bar; by dragging it, or from its menu. The place given holds through a reload.
const cmdr = {
  leftRibbon: [
    { id: 'core:command-palette', icon: 'lucide-terminal', name: 'Palette', mode: 'any' },
    { id: 'graph:open', icon: 'lucide-git-fork', name: 'Graph', mode: 'any' },
  ],
  macros: [],
}
export const viewport = { width: 1300, height: 900 }
export const vault = {
  plugins: ['commander', 'graph'],
  files: {
    '.flint/commander.json': JSON.stringify(cmdr),
    'Note.md': '# Note\n\ntext\n',
    'Other.md': '# Other\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  await t.open('Note')
  await page.waitForSelector('.toolbar[data-place="left-ribbon"] button[title="Palette"]')
  await wait(400)
  const top = page.locator('.toolbar[data-place="left-ribbon"]')
  const bottom = page.locator('.toolbar[data-place="left-ribbon-end"]')
  const saved = () => JSON.parse(read('.flint/commander.json'))
  const arranged = () => JSON.parse(read('.flint/workspace.json')).toolbars ?? {}

  ok('the strip along the edge has a top and a bottom', (await top.count()) === 1 && (await bottom.count()) === 1)

  // Dragged by hand: the bottom grows into a place to drop on only once a drag is under way.
  const dragTo = async (from, place, at = 'center') => {
    const box = await from.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2 + 6, { steps: 4 })
    await wait(300)
    const target = await place.boundingBox()
    const y = { center: target.y + target.height / 2, top: target.y + 4, bottom: target.y + target.height - 3 }[at]
    await page.mouse.move(target.x + target.width / 2, y, { steps: 8 })
    await wait(200)
    await page.mouse.up()
    await wait(900)
  }

  await dragTo(top.locator('button[title="Palette"]'), bottom)
  const at = await bottom.locator('button[title="Palette"]').boundingBox().catch(() => null)
  ok('a button dragged to the bottom of the strip stays there', !!at && at.y > 900 * 0.75 && (await top.locator('button[title="Palette"]').count()) === 0, JSON.stringify(at))
  ok('the lists of Commander say where it is now', saved().leftRibbonEnd?.[0]?.id === 'core:command-palette' && saved().leftRibbon.map((p) => p.id).join() === 'graph:open', JSON.stringify(saved()))
  ok('and the place is kept with the layout of the vault', JSON.stringify(arranged()['left-ribbon-end']) === '["commander:core:command-palette"]', JSON.stringify(arranged()))
  await bottom.locator('button[title="Palette"]').click()
  await wait(400)
  ok('there it still runs its command', (await t.count('dialog[open]')) === 1)
  await page.keyboard.press('Escape')
  await wait(300)

  // ---- from the menu: to the tab strip
  await top.locator('button[title="Graph"]').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Переместить' }).hover()
  await wait(300)
  ok('the menu of a button lists the places it can go to', (await t.flat(page.locator('.menu').nth(1))).includes('Строка состояния'), await t.flat(page.locator('.menu').nth(1)).catch(() => 'no submenu'))
  await page.locator('.menu').nth(1).locator('button', { hasText: 'Полоса вкладок' }).click()
  await wait(800)
  ok('a button moved from its menu', (await page.locator('.tabbar .toolbar[data-place="tab-bar"] button[title="Graph"]').count()) === 1 && saved().titleBar?.[0]?.id === 'graph:open', JSON.stringify(saved()))

  // ---- a note's tab dropped on the bottom becomes a button there
  await page.evaluate(() => app.workspace.openFile('Other.md', { newTab: true }))
  await t.tab('Other').waitFor()
  await dragTo(t.tab('Other'), bottom, 'bottom')
  ok('a tab dropped on the bottom of the strip is a button there', (await bottom.locator('button[title="Other"]').count()) === 1, await bottom.innerHTML())
  ok('after the one that was there', (await bottom.locator('button').first().getAttribute('title')) === 'Palette')
  // Dragged again onto the top half of the first button, it goes before it.
  await dragTo(bottom.locator('button[title="Other"]'), bottom.locator('button[title="Palette"]'), 'top')
  ok('a button dragged onto another lands before it', (await bottom.locator('button').first().getAttribute('title')) === 'Other', (await bottom.locator('button').evaluateAll((b) => b.map((x) => x.title))).join())
  // The way back: to the place its owner gave it.
  await bottom.locator('button[title="Other"]').click({ button: 'right' })
  ok('a button moved away can go back where it was made', (await page.locator('.menu button', { hasText: 'Вернуть на место' }).count()) === 1)
  await page.locator('.menu button', { hasText: 'Вернуть на место' }).click()
  await wait(600)
  ok('and goes back', (await top.locator('button[title="Other"]').count()) === 1 && (await bottom.locator('button[title="Other"]').count()) === 0)

  // ---- the status bar is a place too
  await bottom.locator('button[title="Palette"]').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Переместить' }).hover()
  await wait(300)
  await page.locator('.menu').nth(1).locator('button', { hasText: 'Строка состояния' }).click()
  await wait(800)
  ok('a button in the status bar', (await page.locator('.status-bar .toolbar[data-place="status-bar"] button[title="Palette"]').isVisible()) && saved().statusBar?.[0]?.id === 'core:command-palette', JSON.stringify(saved()))
  await page.locator('.status-bar button[title="Palette"]').click()
  await wait(400)
  ok('and works there', (await t.count('dialog[open]')) === 1)
  await page.keyboard.press('Escape')
  await wait(900)

  // ---- all of it holds through a reload
  await page.reload()
  await page.waitForSelector('.status-bar button[title="Palette"]', { timeout: 20000 })
  await wait(800)
  ok(
    'every button is where it was put after a reload',
    (await page.locator('.tabbar .toolbar[data-place="tab-bar"] button[title="Graph"]').count()) === 1 && (await top.locator('button[title="Other"]').count()) === 1 && (await bottom.locator('button').count()) === 0,
  )
}
