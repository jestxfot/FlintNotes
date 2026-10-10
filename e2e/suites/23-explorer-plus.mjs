// Explorer++: hiding and pinning in the list of files, from the data of the File Explorer++ plugin.
const data = {
  hideStrictPathFilters: true,
  pinFilters: { active: true, tags: [{ name: '', active: true, pattern: '', patternType: 'STRICT' }], paths: [{ name: '', active: true, type: 'FILES', pattern: 'Zeta.md', patternType: 'STRICT' }], frontMatter: [] },
  hideFilters: { active: true, tags: [{ name: '', active: true, pattern: 'secret', patternType: 'STRICT' }], paths: [{ name: '', active: true, type: 'FILES_AND_DIRECTORIES', pattern: 'attach*', patternType: 'WILDCARD' }], frontMatter: [] },
  somethingElse: 'kept',
}
export const vault = {
  plugins: ['explorer-plus'],
  files: {
    '.obsidian/app.json': '{}',
    '.obsidian/plugins/file-explorer-plus/data.json': JSON.stringify(data, null, 2),
    'Alpha.md': 'a\n',
    'Beta.md': 'b\n',
    'Zeta.md': 'z\n',
    'Hidden by tag.md': '---\ntags: [secret]\n---\nx\n',
    'attachments/pic.md': 'p\n',
    'Folder/Inner.md': 'i\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  await wait(2500)
  const names = async () => (await page.locator('.tree .row .name').allInnerTexts()).map((name) => name.trim())
  ok('what the filters hide is not listed, by wildcard and by tag', JSON.stringify(await names()) === JSON.stringify(['Zeta', 'Folder', 'Alpha', 'Beta']), JSON.stringify(await names()))
  ok('a pinned note stands first and is marked', (await t.row('Zeta').getAttribute('class')).includes('xp-pinned'))

  await t.row('Beta').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Закрепить наверху' }).click()
  await wait(1200)
  let saved = JSON.parse(read('.obsidian/plugins/file-explorer-plus/data.json'))
  ok("pinning from the menu is written in the plugin's own form", (await names())[0] === 'Beta' && saved.pinFilters.paths.some((f) => f.pattern === 'Beta.md' && f.patternType === 'STRICT' && f.type === 'FILES') && saved.somethingElse === 'kept', JSON.stringify(saved.pinFilters.paths))
  await t.row('Alpha').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Скрыть в списке файлов' }).click()
  await wait(1200)
  ok('hiding from the menu takes the note out of the list, not out of the vault', !(await names()).includes('Alpha') && t.exists('Alpha.md'))
  await page.evaluate(() => app.commands.run('explorer-plus:toggle-hide'))
  await wait(1200)
  ok('a command shows what is hidden', (await names()).includes('Alpha') && (await names()).includes('attachments') && (await names()).includes('Hidden by tag'), JSON.stringify(await names()))
  saved = JSON.parse(read('.obsidian/plugins/file-explorer-plus/data.json'))
  ok('and that is kept too', saved.hideFilters.active === false)
}
