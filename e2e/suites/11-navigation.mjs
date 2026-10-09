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
  const address = () => decodeURIComponent(new URL(page.url()).pathname)
  const folder = (name) => page.locator('.row[aria-expanded]', { hasText: new RegExp(`${name}$`) })

  await page.waitForSelector('.tree .row')
  ok('an empty app sits at the root address', address() === '/')

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
  await page.reload()
  await page.waitForSelector(`${t.leaf} .cm-content`)
  ok('a reload stays on the same note', (await t.activeTab()) === 'Plan' && address() === '/Projects/Plan')

  await folder('api').click()
  await t.row('Notes').click()
  await wait(300)
  const reserved = address()
  await page.reload()
  await page.waitForSelector(`${t.leaf} .cm-content`)
  ok('a folder named like a server address still works', reserved === '/-/api/Notes' && (await t.activeTab()) === 'Notes', reserved)

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

  // The file manager itself cannot be opened in a test; what is checked is what the app asks for.
  const asked = []
  await page.route('**/api/reveal**', (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('path'))
    return route.fulfill({ status: 204 })
  })
  await t.row('Plan').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Показать в проводнике' }).click()
  await page.locator('.tree').click({ button: 'right', position: { x: 60, y: 600 } })
  await page.locator('.menu button', { hasText: 'Показать в проводнике' }).click()
  await wait(300)
  ok('the menu asks to show the file, or the vault itself from the empty area', JSON.stringify(asked) === JSON.stringify(['Projects/Plan.md', '']), JSON.stringify(asked))
}
