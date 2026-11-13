export const vault = { plugins: [], files: { 'Start.md': 'Start\n' } }

export async function run(t) {
  const { page, ok } = t
  await page.waitForFunction(() => window.app?.commands.get('core:about'))
  await page.locator('.main-menu .vault').click()
  await page.getByRole('menuitem', { name: 'О программе', exact: true }).click()
  const about = page.getByRole('dialog', { name: 'О программе', exact: true })
  await about.waitFor()
  ok('about opens from the application menu and shows a version', /^Версия \d+\.\d+\.\d+/.test(await about.locator('.version').innerText()))
  ok('browser mode explains where app updates are available', (await about.getByRole('status').innerText()).includes('в браузере') && await about.getByRole('button', { name: 'Проверить обновления' }).count() === 0)
  ok('release history links to the repository releases', await about.getByRole('link').getAttribute('href') === 'https://github.com/jestxfot/FlintNotes/releases')
  await page.keyboard.press('Escape')
  await about.waitFor({ state: 'detached' })
  // The dialog's own 'close' event reaches the page a moment after it is gone; a command run before it is undone by it.
  await page.waitForTimeout(300)
  await page.evaluate(() => app.commands.run('core:about'))
  await about.waitFor()
  await page.setViewportSize({ width: 390, height: 760 })
  ok('about fits a narrow viewport', await about.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().width <= innerWidth))
  await about.getByRole('button', { name: 'Закрыть', exact: true }).click()
}
