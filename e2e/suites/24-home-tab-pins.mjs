// The home tab: what a new tab shows and what the app starts with; pinned tabs that are only a sign.
export const vault = {
  plugins: ['home-tab'],
  settings: { 'home-tab': { name: 'Robert', favorites: 'Start', quote: 'Do it today' } },
  files: { 'Start.md': '# Start\n', 'Deep/Plan B.md': 'plan\n', '🍎 Fruit.md': 'apple\n' },
}

export async function run(t) {
  const { page, ok, wait } = t
  const home = page.locator(`${t.leaf} .home-tab`)
  await home.waitFor({ timeout: 10000 })
  ok('with no tabs open the app starts on the home tab', (await t.activeTab()) === 'Домой')
  const text = await t.flat(home)
  ok('the page greets, shows the clock, the notes at hand and the line of the day', /\d{2}:\d{2}/.test(text) && /(Доброе утро|Добрый день|Добрый вечер|Доброй ночи), Robert\./.test(text) && text.toLowerCase().includes('под рукой') && text.includes('Start') && text.includes('Do it today'), text)
  await home.locator('.home-search input').fill('plan')
  await wait(300)
  ok('its field finds files', (await t.flat(home.locator('.home-result').first())).includes('Plan B'))
  await page.keyboard.press('Enter')
  await wait(800)
  ok('Enter opens what was found', (await t.activeTab()) === 'Plan B')
  await page.locator('.tabbar button[title="Новая вкладка"], .tabbar .new-tab, .tabbar button[aria-label="Новая вкладка"]').first().click()
  await wait(600)
  ok('"+" brings the home tab instead of making a note', (await t.activeTab()) === 'Домой' && !t.exists('Без названия.md'))
  ok('and the note just visited is among the recent ones', (await t.flat(home)).toLowerCase().includes('недавние') && (await t.flat(home.locator('.home-section').last())).includes('Plan B'))

  // ---- a chosen note as home
  await t.row('Start').click()
  await wait(600)
  await page.evaluate(() => app.commands.run('home-tab:set-note'))
  await page.evaluate(() => app.commands.run('core:close-all-tabs'))
  await wait(300)
  await page.evaluate(() => app.commands.run('home-tab:open'))
  await wait(700)
  ok('a note can be the home tab', (await t.activeTab()) === 'Start' && (await page.evaluate(() => app.settings.get('home-tab', 'mode'))) === 'note')

  // ---- pinned tabs
  await t.row('🍎 Fruit').click()
  await wait(600)
  await page.locator('.tab.active').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Закрепить вкладку' }).click()
  await wait(400)
  const pinned = page.locator('.tab.pinned')
  ok('a pinned tab stands first and shows only its sign', (await pinned.count()) === 1 && (await page.locator('.tab').first().getAttribute('class')).includes('pinned') && (await t.flat(pinned)) === '🍎' && (await pinned.locator('.tab-close').count()) === 0, await t.flat(pinned))
  const narrow = await pinned.evaluate((el) => el.getBoundingClientRect().width)
  ok('and takes little room', narrow < 60, narrow)
  await page.evaluate(() => app.commands.run('core:close-all-tabs'))
  await wait(300)
  ok('closing all tabs leaves the pinned one', (await t.count('.tab')) === 1 && (await t.count('.tab.pinned')) === 1)
  await page.reload()
  await page.waitForSelector('.tab')
  await wait(900)
  ok('a pinned tab is pinned after a reload too', (await t.count('.tab.pinned')) === 1)
  await page.locator('.tab.pinned').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Открепить вкладку' }).click()
  await wait(300)
  ok('and can be let go', (await t.count('.tab.pinned')) === 0 && (await t.flat(page.locator('.tab').first())).includes('Fruit'))
}
