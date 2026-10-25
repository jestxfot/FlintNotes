// The quick switcher learns: what was chosen for some letters comes first for them again, a file chosen often
// comes up sooner, and notes go before pictures and archives of the same name.
export const vault = {
  plugins: ['quick-switcher'],
  files: {
    'Herobrine.md': '# Herobrine\n',
    'Hero - Skillet.md': 'song\n',
    'Calendar/Herobrine History.md': 'history\n',
    'attachments/herobrine.zip': 'zip',
    'attachments/Herobrine Mod Archive.zip': 'zip',
    'Sky.md': 'sky\n',
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  const found = async (typed) => {
    await page.evaluate(() => app.commands.run('quick-switcher:open'))
    await page.waitForSelector('dialog[open] input')
    await page.locator('dialog[open] input').fill(typed)
    await wait(250)
    const labels = await page.locator('dialog[open] [role=option] .label').allInnerTexts()
    return labels
  }
  const choose = async (label) => {
    await page.locator('dialog[open] [role=option]', { has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) }).click()
    await wait(400)
  }

  await page.waitForFunction(() => app.commands.get('quick-switcher:open'))
  await wait(300)
  let list = await found('her')
  ok('notes come before files of other kinds with the same letters', list.indexOf('herobrine.zip') > list.indexOf('Herobrine History') && list.indexOf('Herobrine Mod Archive.zip') > list.indexOf('Hero - Skillet'), list.join(' | '))
  ok('the name typed whole comes first', (await found('herobrine'))[0] === 'Herobrine', list.join(' | '))
  await page.keyboard.press('Escape')

  // Chosen for "her", it comes first for "her" from now on.
  list = await found('her')
  ok('before any choice, the shortest name goes first among equals', list[0] === 'Hero - Skillet' || list[0] === 'Herobrine', list.join(' | '))
  await choose('Herobrine History')
  ok('the choice opens the note', (await t.activeTab()) === 'Herobrine History')
  list = await found('her')
  ok('chosen for these letters, it comes first for them', list[0] === 'Herobrine History', list.join(' | '))
  await page.keyboard.press('Escape')
  list = await found('hero')
  ok('and first for letters that go on from them', list[0] === 'Herobrine History', list.join(' | '))
  await page.keyboard.press('Escape')
  list = await found('sky')
  ok('other letters are not disturbed', list[0] === 'Sky', list.join(' | '))
  await page.keyboard.press('Escape')

  // A later choice for the same letters takes over once it is made more often.
  for (let i = 0; i < 3; i++) {
    await found('her')
    await choose('Hero - Skillet')
  }
  list = await found('her')
  ok('chosen more often since, another file takes the first place', list[0] === 'Hero - Skillet' && list[1] === 'Herobrine History', list.join(' | '))
  await page.keyboard.press('Escape')

  // With nothing typed the files chosen most come first.
  list = await found('')
  ok('with nothing typed the files chosen most come first', list[0] === 'Hero - Skillet', list.slice(0, 4).join(' | '))
  await page.keyboard.press('Escape')

  await wait(900)
  const kept = JSON.parse(t.read('.flint/quick-switcher.json'))
  ok("what was learnt is kept in FlintNotes' own folder of the vault", kept.queries?.her?.['Hero - Skillet.md']?.n > 2 && kept.files?.['Calendar/Herobrine History.md']?.n >= 1, JSON.stringify(kept))

  // Renamed, a file keeps what it earned.
  await page.evaluate(() => app.vault.rename('Hero - Skillet.md', 'Hero.md'))
  await wait(1200)
  list = await found('her')
  ok('a renamed file keeps its place', list[0] === 'Hero', list.join(' | '))
  await page.keyboard.press('Escape')
  await wait(900)
  ok('and the kept memory follows the new name', Object.hasOwn(JSON.parse(t.read('.flint/quick-switcher.json')).queries.her, 'Hero.md'))
}
