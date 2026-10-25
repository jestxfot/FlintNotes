// Each sidebar floats over the note or stays in place beside it, chosen with a right click on it or on its button.
export const vault = {
  plugins: ['backlinks', 'outline'],
  files: { 'A.md': '# A\n\ntext\n' },
}

export async function run(t) {
  const { page, ok, wait } = t
  await t.open('A')
  const aside = (side) => page.locator(`aside.${side}`)
  const menuItem = (text) => page.locator('.menu button', { hasText: text })
  ok('both sidebars start in place, beside the note', (await aside('left').count()) === 1 && !(await aside('left').getAttribute('class')).includes('floating'))

  // A right click on the tab of a widget in a sidebar.
  await page.locator('aside .widget-tab').first().click({ button: 'right' })
  await wait(200)
  ok('the menu of a sidebar\'s widget offers to make the sidebar float', (await menuItem('Сделать панель плавающей').count()) === 1, await page.locator('.menu').innerText().catch(() => 'no menu'))
  await page.keyboard.press('Escape')
  await wait(200)
  // The sidebar's button in the bar of tabs: to float it, and to hide it.
  await page.locator('.tabbar .bar-button[aria-label="Левая панель"]').click({ button: 'right' })
  await wait(200)
  ok('the menu of its button offers to make it float and to hide it', (await menuItem('Сделать панель плавающей').count()) === 1 && (await menuItem('Скрыть левую панель').count()) === 1, await page.locator('.menu').innerText().catch(() => 'no menu'))
  await menuItem('Сделать панель плавающей').click()
  await wait(400)
  ok('made floating, it lies over the note', (await aside('left').getAttribute('class')).includes('floating'))
  ok('the other one stays in place', (await aside('right').count()) === 1 && !(await aside('right').getAttribute('class')).includes('floating'))
  ok('the choice is a setting of that sidebar alone', (await page.evaluate(() => [app.settings.get('core', 'floatingLeft'), app.settings.get('core', 'floatingRight')])).join() === 'true,false')
  // It goes when the pointer leaves it, and comes back at the edge of the window.
  await page.mouse.move(800, 500)
  await wait(700)
  ok('it goes when the pointer leaves it', (await aside('left').count()) === 0)
  await page.mouse.move(2, 500)
  await wait(400)
  ok('and comes out at the edge of the window', (await aside('left').count()) === 1)

  // The button of the right sidebar has the same menu.
  await page.locator('.tabbar .bar-button[aria-label="Правая панель"]').click({ button: 'right' })
  await wait(200)
  await menuItem('Сделать панель плавающей').click()
  await page.mouse.move(800, 500)
  await wait(700)
  ok('the button of a sidebar has the menu too', (await page.evaluate(() => app.settings.get('core', 'floatingRight'))) === true && (await aside('right').count()) === 0)
  await page.evaluate(() => app.commands.run('core:float-right-sidebar'))
  await wait(400)
  ok('a command fixes it in place again, open', (await aside('right').count()) === 1 && !(await aside('right').getAttribute('class')).includes('floating'))

  // The settings of the app have both, one for each sidebar.
  await page.evaluate(() => app.commands.run('core:settings'))
  await page.locator('nav button', { hasText: 'Интерфейс' }).click()
  await wait(400)
  const row = (name) => page.locator('dialog label.item', { hasText: name }).locator('input[type=checkbox]')
  ok('the settings have a switch for each sidebar, as chosen', (await row('Левая панель плавающая').isChecked()) && !(await row('Правая панель плавающая').isChecked()))
  await row('Левая панель плавающая').click()
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)
  ok('switched there, the sidebar is fixed in place again', (await aside('left').count()) === 1 && !(await aside('left').getAttribute('class')).includes('floating'))

  // The one setting of earlier versions, for both, becomes the setting of each.
  await page.evaluate(() => app.settings.set('core', 'floatingSidebars', true))
  await wait(400)
  ok('the old common setting is taken over by both', (await page.evaluate(() => [app.settings.get('core', 'floatingLeft'), app.settings.get('core', 'floatingRight'), app.settings.get('core', 'floatingSidebars')])).join() === 'true,true,')
  await page.evaluate(() => app.settings.set('core', 'floatingSidebars', false))
  await wait(400)
  ok('nothing is left floating', !(await page.locator('aside.floating').count()) && (await aside('left').count()) === 1)
}
