// Clicking into a property's name offers the names properties have in the vault, with the icon of their kind.
export const vault = {
  plugins: ['properties'],
  files: {
    'Target.md': '---\nstatus: draft\n---\n\ntext\n\nend\n',
    'A.md': '---\nstatus: done\ndone: true\nrating: 5\ntags:\n  - a\n---\n',
    'B.md': '---\nstatus: wip\ndone: false\nrating: 3\ndeadline: 2026-12-01\n---\n',
    'C.md': '---\nstatus: new\ndone: true\naliases:\n  - c\n---\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  await t.open('Target')
  await t.cursorToEnd()
  await wait(600)
  const row = (name) => page.locator(`${t.leaf} .props-row[data-key="${name}"]`)
  const popup = page.locator('.props-suggest')
  const names = () => popup.locator('.props-suggest-name').allInnerTexts().then((all) => all.map((one) => one.trim()))

  await row('status').locator('.props-name').click()
  await wait(300)
  const all = await names()
  ok('a click into a name shows the names the vault has, but not this note\'s own', all.includes('done') && all.includes('rating') && all.includes('deadline') && all.includes('tags') && !all.includes('status'), all.join(', '))
  ok('the commonest first', all.indexOf('done') < all.indexOf('deadline'), all.join(', '))
  ok('each has the icon of its kind', (await popup.locator('.props-suggest-row svg').count()) === all.length)

  await row('status').locator('.props-name').fill('rat')
  await wait(300)
  ok('typing narrows them', (await names()).join(',') === 'rating', (await names()).join(','))
  await row('status').locator('.props-name').press('Escape')
  ok('Escape closes the list', (await popup.count()) === 0)
  await row('status').locator('.props-name').fill('status')
  await row('status').locator('.props-name').press('Escape')

  // Choosing a name for a new property gives it the kind of value it has elsewhere.
  await page.locator(`${t.leaf} .props-add`).click()
  await wait(300)
  ok('a new property offers the names at once', (await popup.count()) === 1 && (await names()).includes('done'), (await names()).join(','))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  const chosen = (await names())[1]
  await page.keyboard.press('Enter')
  await wait(900)
  ok('Enter takes the one marked, with the kind of its value: a number', chosen === 'rating' && /rating: 0/.test(read('Target.md')), `${chosen} ${read('Target.md')}`)
  await page.locator(`${t.leaf} .props-add`).click()
  await wait(300)
  await page.locator('.props-suggest-row', { hasText: /^done$/ }).dispatchEvent('mousedown')
  await wait(900)
  ok('a name taken with the mouse brings its kind too: a flag', /done: false/.test(read('Target.md')), read('Target.md'))
  ok('and its checkbox is shown', (await row('done').locator('input[type=checkbox]').count()) === 1)
  await page.locator(`${t.leaf} .props-add`).click()
  await wait(300)
  await page.locator('.props-suggest-row', { hasText: /^aliases$/ }).dispatchEvent('mousedown')
  await wait(900)
  ok('a list for a list', /aliases:\s*(\[\]|\n)/.test(read('Target.md')), read('Target.md'))
  ok('the list closes when a name is taken', (await popup.count()) === 0)
}
