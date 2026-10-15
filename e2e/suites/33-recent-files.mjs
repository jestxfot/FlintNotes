// Recent notes: the list of the Recent Files plugin for Obsidian, shared through its own data.json.
const DATA = '.obsidian/plugins/recent-files-obsidian/data.json'
export const vault = {
  plugins: ['recent-files', 'quick-switcher'],
  files: {
    '.obsidian/app.json': '{}',
    [DATA]: JSON.stringify({ recentFiles: [{ basename: 'Beta', path: 'Notes/Beta.md' }, { basename: 'Alpha', path: 'Alpha.md' }], omittedPaths: ['^Templates/'], omittedTags: [], updateOn: 'file-open', omitBookmarks: false }),
    'Alpha.md': 'a\n',
    'Notes/Beta.md': 'b\n',
    'Gamma.md': 'g\n',
    'Templates/Daily.md': 't\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  await page.waitForFunction(() => window.app?.commands?.list().some((c) => c.id === 'recent-files:open'), null, { timeout: 20000 })
  await page.evaluate(() => app.commands.run('recent-files:open'))
  const panel = page.locator('.recent-files')
  await panel.waitFor()
  const names = async () => (await panel.locator('.recent-files-name').allInnerTexts()).join('|')
  ok('the list of Obsidian\'s Recent Files is shown, newest first, with folders', (await names()) === 'Beta|Alpha' && (await t.flat(panel)).includes('Notes'), await names())
  ok('its settings are taken over too', (await page.evaluate(() => app.settings.get('recent-files', 'omittedPaths'))) === '^Templates/')

  await page.evaluate(() => app.workspace.openFile('Gamma.md'))
  await wait(400)
  await page.evaluate(() => app.workspace.openFile('Templates/Daily.md'))
  await wait(1500)
  ok('an opened note goes to the top and is marked; a path the settings leave out does not', (await names()) === 'Gamma|Beta|Alpha' && (await panel.locator('.recent-files-row.active').count()) === 0, await names())
  const saved = JSON.parse(read(DATA))
  ok('the list is written back in the form of Recent Files', saved.recentFiles[0].path === 'Gamma.md' && saved.recentFiles[0].basename === 'Gamma' && saved.updateOn === 'file-open' && Array.isArray(saved.omittedTags), JSON.stringify(saved).slice(0, 200))

  await page.evaluate(() => app.vault.rename('Alpha.md', 'Notes/Alpha renamed.md'))
  await wait(700)
  ok('a renamed note keeps its place under its new name', (await names()) === 'Gamma|Beta|Alpha renamed', await names())
  await panel.locator('.recent-files-row', { hasText: 'Beta' }).hover()
  await panel.locator('.recent-files-row', { hasText: 'Beta' }).locator('.recent-files-remove').click()
  await wait(300)
  ok('a note can be taken off the list', (await names()) === 'Gamma|Alpha renamed', await names())
  await panel.locator('.recent-files-row', { hasText: 'Alpha renamed' }).click()
  await wait(500)
  ok('a click opens the note', (await t.activeTab()) === 'Alpha renamed')

  await page.keyboard.press('Escape')
  await page.evaluate(() => app.commands.run('quick-switcher:open'))
  await page.waitForSelector('dialog[open] [role=option]')
  const offered = await page.locator('dialog[open] [role=option]').allInnerTexts()
  ok('the quick switcher with nothing typed starts with the notes opened last', offered[0].startsWith('Alpha renamed') && offered[1].startsWith('Gamma'), offered.slice(0, 4).join(' / '))
  await page.keyboard.press('Escape')
}
