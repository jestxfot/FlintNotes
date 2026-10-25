// A property's value offers the values it has elsewhere, but only a few before anything is typed: the notes
// opened lately first, then the most used; typing narrows them, and the list never covers the whole page.
const files = { 'Target.md': '---\ntodo: ""\n---\n\ntext\n' }
for (let i = 1; i <= 12; i++) {
  const n = String(i).padStart(2, '0')
  files[`Item ${n}.md`] = `item ${n}\n`
  // Item 01 is the most used value; the others once each.
  files[`Uses ${n}.md`] = `---\ntodo: "[[Item ${i <= 3 ? '01' : n}]]"\n---\n`
}
export const vault = { plugins: ['properties'], files }

export async function run(t) {
  const { page, ok, wait } = t
  // A note opened lately (where its place was kept): it should come first.
  await page.evaluate(() => app.positions.put('Item 09.md', { anchor: 0, head: 0, top: 0 }))
  await t.open('Target')
  await wait(600)
  const field = page.locator(`${t.leaf} .props-row[data-key="todo"] input.props-value`)
  const names = () => page.locator('.props-suggest .props-suggest-name').allInnerTexts().then((all) => all.map((one) => one.trim()))

  await field.click()
  await wait(300)
  const first = await names()
  ok('before anything is typed only a few are offered', first.length > 0 && first.length <= 7, first.join(', '))
  ok('the note opened lately comes first, then the most used', first[0] === 'Item 09' && first[1] === 'Item 01', first.join(', '))

  await field.fill('item 1')
  await wait(300)
  const typed = await names()
  ok('typing narrows them to what matches', typed.join(',') === 'Item 10,Item 11,Item 12', typed.join(','))

  await field.fill('item')
  await wait(300)
  const height = await page.locator('.props-suggest').evaluate((popup) => popup.getBoundingClientRect().height)
  ok('the list is no higher than about nine rows, however many match', height <= 340 && (await names()).length === 10, `${height}px, ${(await names()).length}`)
  await field.press('Escape')
}
