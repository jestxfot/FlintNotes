// The address bar follows the open note; Back and Forward move between visited notes;
// a note's address opens that note. Also: showing a file in the system's file manager.
export const vault = {
  plugins: ['graph'],
  files: {
    'Home.md': '# Home\n',
    'Projects/Plan.md': '# Plan\n',
    'Projects/Отчёт за год.md': '# Отчёт\n',
    'api/Notes.md': '# In a folder named like the server address\n',
    'pic.png': 'x',
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  const whole = () => decodeURIComponent(new URL(page.url()).pathname)
  // Every address begins with the vault's name; what follows is the place in the vault.
  const name = t.vault.split(/[\\/]/).pop()
  const address = () => whole().replace(new RegExp(`^/${name}(?=/|$)`), '') || '/'
  const folder = (name) => page.locator('.row[aria-expanded]', { hasText: new RegExp(`${name}$`) })

  await page.waitForSelector('.tree .row')
  ok("an empty app sits at its vault's address", whole() === `/${name}/`, whole())

  await t.row('Home').click()
  await wait(300)
  ok('opening a note puts it in the address, without ".md"', address() === '/Home' && (await page.title()) === 'Home — FlintNotes', address())
  await folder('Projects').click()
  await t.row('Plan').click()
  await wait(300)
  await t.row('Отчёт за год').click()
  await wait(300)
  ok('folders and non-Latin names read naturally', address() === '/Projects/Отчёт за год', address())
  await t.row('pic.png').click()
  await wait(300)
  ok('other files keep their extension', address() === '/pic.png')

  await page.goBack()
  await wait(400)
  ok('Back returns to the previous note', address() === '/Projects/Отчёт за год' && (await t.activeTab()) === 'Отчёт за год', address())
  await page.goBack()
  await wait(400)
  ok('and further back', (await t.activeTab()) === 'Plan' && address() === '/Projects/Plan')
  await page.goForward()
  await wait(400)
  ok('Forward goes forward again', (await t.activeTab()) === 'Отчёт за год')
  ok('moving through history opens no extra tabs', (await t.count('.tab')) === 4, await t.count('.tab'))

  await t.tab('Home').click()
  await wait(300)
  ok('switching tabs is a step in history too', address() === '/Home')
  await page.goBack()
  await wait(400)
  ok('so Back undoes it', (await t.activeTab()) === 'Отчёт за год')

  await page.locator('.tab.active .tab-close').click()
  await wait(300)
  await page.goBack()
  await wait(500)
  ok('Back reopens a note whose tab was closed', (await t.activeTab()) === 'Отчёт за год' && address() === '/Projects/Отчёт за год', `${await t.activeTab()} ${address()}`)

  await page.goto(`${t.url}Projects/Plan`)
  await page.waitForSelector(`${t.leaf} .cm-content`)
  await wait(500)
  ok('a note\'s address opens that note', (await t.activeTab()) === 'Plan' && (await t.text()).includes('Plan'))
  ok('an address from before vaults were named in it is put right', whole() === `/${name}/Projects/Plan`, whole())
  await page.goto(`${t.url}${name}/Projects/Plan`)
  await page.waitForSelector(`${t.leaf} .cm-content`)
  await wait(500)
  ok('the full address, vault and note, opens the note', (await t.activeTab()) === 'Plan' && whole() === `/${name}/Projects/Plan`, whole())
  await page.reload()
  await page.waitForSelector(`${t.leaf} .cm-content`)
  ok('a reload stays on the same note', (await t.activeTab()) === 'Plan' && address() === '/Projects/Plan')

  await folder('api').click()
  await t.row('Notes').click()
  await wait(300)
  const reserved = address()
  await page.reload()
  await page.waitForSelector(`${t.leaf} .cm-content`)
  ok('a folder named like a server address still works', reserved === '/api/Notes' && (await t.activeTab()) === 'Notes', reserved)

  await page.keyboard.press('Control+g')
  await wait(1200)
  ok('a tab without a file has an address too', address() === '/~graph' && (await page.title()) === 'Граф — FlintNotes', address())
  await page.goBack()
  await wait(400)
  ok('and takes part in history', (await t.activeTab()) === 'Notes')

  await page.evaluate(() => app.vault.rename('Home.md', 'Start.md'))
  await t.tab('Start').click()
  await wait(400)
  ok('a renamed note gets its new address', address() === '/Start')
  await page.goto(`${t.url}no/such/note`)
  await page.waitForSelector('.tree .row')
  await wait(500)
  ok('an address of a note that is gone falls back to the open one', address() !== '/no/such/note', address())

  // The server's disk is not the user's: no menu offers to show a file in a file manager.
  await t.row('Plan').click({ button: 'right' })
  await wait(200)
  const menuText = await page.locator('.menu').innerText()
  await page.keyboard.press('Escape')
  await page.locator('.tree').click({ button: 'right', position: { x: 60, y: 600 } })
  await wait(200)
  const emptyMenuText = await page.locator('.menu').innerText()
  await page.keyboard.press('Escape')
  ok("the menus of a file and of the empty area do not offer a file manager", !menuText.includes('проводнике') && !emptyMenuText.includes('проводнике') && menuText.includes('Копировать путь'), `${menuText} | ${emptyMenuText}`)
}
