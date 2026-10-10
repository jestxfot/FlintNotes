// The history of notes: versions kept as compressed changes, compared and brought back.
export const viewport = { width: 1400, height: 900 }
export const vault = {
  plugins: ['history'],
  settings: { history: { merge: 0 } },
  files: { 'Story.md': 'one\ntwo\nthree\n', 'Gone.md': 'will be deleted\n' },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  const fs = await import('node:fs')
  const nodePath = await import('node:path')
  await t.open('Story')
  await wait(900)
  // A change typed here.
  await page.keyboard.type('four\n')
  await wait(1500)
  // A change made by another program.
  t.write('Story.md', 'one\nTWO changed outside\nthree\nfour\n')
  await wait(2500)
  await page.evaluate(() => app.commands.run('history:show'))
  const dialog = page.locator('.history-dialog')
  await dialog.waitFor()
  const versions = dialog.locator('.history-version')
  const listed = await t.flat(dialog.locator('.history-list'))
  ok('each save is a version, with who made it', (await versions.count()) === 3 && listed.includes('начало истории') && listed.includes('здесь') && listed.includes('другой программой'), listed)
  ok('the head says when the note was created and how much room the history takes', /создана .* версий: 3/.test(await t.flat(dialog.locator('.history-head'))) && /история занимает \d+ Б/.test(await t.flat(dialog.locator('.history-head'))), await t.flat(dialog.locator('.history-head')))
  const diff = async () => (await dialog.locator('.history-line.new, .history-line.gone').allInnerTexts()).map((line) => line.trim())
  ok('the latest version shows what changed in it', JSON.stringify(await diff()) === JSON.stringify(['− two', '+ TWO changed outside']), JSON.stringify(await diff()))
  await versions.nth(2).click()
  await dialog.locator('select').selectOption('now')
  await wait(300)
  ok('an old version can be compared with the note as it is now', (await diff()).includes('+ four') && (await diff()).includes('+ TWO changed outside'), JSON.stringify(await diff()))
  await dialog.locator('button.primary').click()
  await wait(1500)
  ok('a version can be brought back', read('Story.md') === 'one\ntwo\nthree\n' && (await t.count('.history-dialog')) === 0, read('Story.md'))

  // ---- small on disk; a renamed note keeps its history; a deleted one can be restored
  const dir = nodePath.join(t.vault, '.flint/history')
  const files = fs.readdirSync(dir)
  ok('the history is kept in the vault, compressed', files.includes('index.json') && files.some((name) => name.endsWith('.gz')) && fs.statSync(nodePath.join(dir, files.find((name) => name.endsWith('.gz')))).size < 600, files.join(','))
  await t.row('Gone').click()
  await wait(900)
  await page.keyboard.type('more text ')
  await wait(1500)
  await page.evaluate(() => app.vault.rename('Gone.md', 'Renamed.md'))
  await wait(1200)
  await page.evaluate(() => app.vault.trash('Renamed.md'))
  await wait(1200)
  await page.evaluate(() => app.commands.run('history:deleted'))
  await wait(400)
  ok('a deleted note is listed under the name it had last', (await t.flat(page.locator('dialog [role=option]').first())).includes('Renamed'))
  await page.keyboard.press('Enter')
  await dialog.waitFor()
  ok('its history remembers the renaming', (await t.flat(dialog.locator('.history-list'))).includes('«Gone» → «Renamed»') && (await t.flat(dialog.locator('.history-head'))).includes('удалена'))
  await dialog.locator('button.primary').click()
  await wait(1500)
  ok('and the note can be restored from it', t.exists('Renamed.md') && read('Renamed.md').includes('will be deleted'))
}
