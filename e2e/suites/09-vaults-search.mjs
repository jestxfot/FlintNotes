// The main menu at the bottom, switching vaults, help; search ranked by title, alias, heading, text.
import fs from 'node:fs'
import path from 'node:path'

export const vault = {
  plugins: ['search', 'quick-switcher', 'links'],
  files: {
    'Project Plan.md': 'nothing special here\n',
    'Other.md': '---\naliases: [Plan B, Roadmap]\n---\nthis one mentions the plan in its text\n',
    'Deep.md': '# Deep\n\n## Plan heading\n\nword\n',
    'Text only.md': 'the plan is mentioned here, and the plan again\n',
    'Unrelated.md': 'something else\n',
    'Draft.md': 'start\n',
  },
}

let second

export function afterStart(t) {
  second = `${t.vault}-second`
  fs.mkdirSync(second)
  fs.writeFileSync(path.join(second, 'Second note.md'), 'in the second vault\n')
}

export async function run(t) {
  const { page, ok, wait, read } = t
  const menu = page.locator('.main-menu')
  const found = () => page.locator('aside.left .file .name').allInnerTexts()
  const rows = () => page.locator('.tree .row').allInnerTexts().then((list) => list.map((row) => row.trim()))
  const vaultName = path.basename(t.vault)

  await page.waitForSelector('.tree .row')
  // The sidebar gets tabs once the search plugin has loaded.
  await page.waitForSelector('aside.left .tabs')
  await page.evaluate(() => app.metadata.ready)
  ok('the main menu is at the bottom with the vault name', (await menu.locator('.vault').innerText()).trim() === vaultName && (await menu.evaluate((el) => el.getBoundingClientRect().bottom > innerHeight - 10)))
  ok('the file list no longer carries the vault name', !(await page.locator('.tree').evaluate((tree) => tree.previousElementSibling.textContent)).includes(vaultName))

  await page.evaluate(() => app.commands.run('search:open-panel'))
  // The field takes the focus a moment after its panel is shown.
  await page.waitForFunction(() => document.activeElement?.type === 'search')
  await page.keyboard.type('plan')
  await wait(600)
  ok('search ranks title, then alias, then heading, then text', JSON.stringify(await found()) === JSON.stringify(['Project Plan', 'Other', 'Deep', 'Text only']), JSON.stringify(await found()))
  ok('a note found by an alias says which', (await page.locator('aside.left .file', { hasText: 'Other' }).locator('.alias').innerText()) === 'Plan B')
  await page.locator('aside.left input').fill('roadmap')
  await wait(600)
  ok('search finds a note by an alias alone', JSON.stringify(await found()) === JSON.stringify(['Other']), JSON.stringify(await found()))
  await page.locator('aside.left input').fill('unrel')
  await wait(600)
  ok('search finds a note by a part of its title', JSON.stringify(await found()) === JSON.stringify(['Unrelated']))

  // ---- several words are a phrase first; small words do not match inside other words
  t.write('Phrase.md', 'intro\n\nHe is watching you from the dark.\n')
  t.write('Scattered.md', 'he said\n\nthis is it\n\nwatching birds\n\nyou too\n')
  t.write('Noise.md', 'the theory of youtube isbn\n')
  await wait(1500)
  await page.locator('aside.left input').fill('He is watching you')
  await wait(700)
  ok('a phrase is found first where it stands as written; parts of other words do not count', JSON.stringify(await found()) === JSON.stringify(['Phrase', 'Scattered']), JSON.stringify(await found()))
  ok('and only the lines that answer are shown, the phrase lit whole', (await page.locator('aside.left .line').first().innerText()).includes('He is watching you from the dark') && (await page.locator('aside.left .line').first().locator('mark').first().innerText()) === 'He is watching you', await page.locator('aside.left .results').innerText())
  await page.locator('aside.left input').fill('unrel')
  await wait(500)

  await page.keyboard.press('Control+o')
  await page.keyboard.type('road')
  await wait(200)
  ok('quick switcher finds aliases', (await t.flat(page.locator('dialog [role=option]').first())) === 'Roadmap → Other', await t.flat(page.locator('dialog [role=option]').first()))
  await page.keyboard.press('Enter')
  await wait(600)
  ok('and opens the note behind the alias', (await t.activeTab()) === 'Other')

  await page.locator('aside.left .widget-tab[title="Файлы"]').click()
  await t.open('Draft')
  await page.keyboard.type(' [[Road')
  await wait(600)
  await page.keyboard.press('Enter')
  await wait(900)
  ok('link completion inserts an alias as [[Note|alias]]', read('Draft.md').includes('[[Other|Roadmap]]'), read('Draft.md'))

  await menu.locator('button[aria-label="Справка"]').click()
  await wait(300)
  const help = await t.flat(page.locator('dialog[aria-label="Справка"]'))
  ok('help lists shortcuts, including plugin ones', help.includes('Ctrl+P') && help.includes('Палитра команд') && help.includes('Поиск по всем заметкам'), help.slice(0, 200))
  await page.keyboard.press('Escape')
  await wait(300)

  // ---- vaults ----
  const openManager = async () => {
    await menu.locator('.vault').click()
    await page.locator('.main-menu .popup button', { hasText: 'Управление хранилищами' }).click()
    await page.waitForSelector('dialog[aria-label="Хранилища"]')
  }
  await openManager()
  await page.locator('#vault-folder').fill('relative/path')
  await page.keyboard.press('Enter')
  await wait(400)
  ok('a relative path is refused with an explanation', (await page.locator('dialog .error').innerText()).includes('полный путь'))
  await page.locator('#vault-folder').fill(second)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.tree .row', { state: 'detached' }).catch(() => {})
  await page.waitForFunction((name) => document.querySelector('.main-menu .vault')?.textContent.trim() === name, path.basename(second), { timeout: 10000 })
  await wait(800)
  ok('another folder opens as a vault', JSON.stringify(await rows()) === JSON.stringify(['Second note']), JSON.stringify(await rows()))
  ok('tabs of the previous vault are not carried over', (await t.count('.tab')) === 0)
  ok("the address names the vault that is open", decodeURIComponent(new URL(page.url()).pathname) === `/${path.basename(second)}/`, page.url())
  // Another tab of the browser can be on another vault at the same time: the address alone decides.
  const context = await page.context().browser().newContext({ viewport: { width: 1300, height: 900 } })
  const other = await context.newPage()
  await other.goto(`${t.url}${encodeURIComponent(vaultName)}/Draft`)
  await other.waitForSelector('.leaf:not([hidden]) .cm-content')
  await other.waitForTimeout(800)
  const both = [await other.locator('.main-menu .vault').innerText(), await page.locator('.main-menu .vault').innerText()].map((name) => name.trim())
  ok('two tabs of the browser show two vaults at once', both[0] === vaultName && both[1] === path.basename(second) && (await other.locator('.leaf:not([hidden]) .cm-content').innerText()).includes('start'), both.join(' | '))
  fs.writeFileSync(path.join(second, 'Fresh.md'), 'new here\n')
  fs.writeFileSync(path.join(t.vault, 'Only first.md'), 'new there\n')
  await wait(2500)
  ok('each follows the changes of its own vault only', (await rows()).includes('Fresh') && !(await rows()).includes('Only first') && (await other.locator('.tree .row .name', { hasText: 'Only first' }).count()) === 1 && (await other.locator('.tree .row .name', { hasText: 'Fresh' }).count()) === 0, JSON.stringify(await rows()))
  await context.close()
  fs.rmSync(path.join(second, 'Fresh.md'))
  fs.rmSync(path.join(t.vault, 'Only first.md'))
  await wait(1500)

  await menu.locator('.vault').click()
  await wait(300)
  const listed = await page.locator('.main-menu .popup button .name').allInnerTexts()
  ok('the menu lists both vaults, the open one checked', listed.length === 2 && (await t.flat(page.locator('.main-menu .popup button', { hasText: '✓' }))).includes(path.basename(second)), JSON.stringify(listed))
  await page.locator('.main-menu .popup button', { hasText: vaultName }).first().click()
  await page.waitForFunction((name) => document.querySelector('.main-menu .vault')?.textContent.trim() === name, vaultName, { timeout: 10000 })
  await page.waitForSelector('.tree .row')
  await wait(800)
  ok('switching back from the menu', (await rows()).includes('Project Plan') && !(await rows()).includes('Second note'))
  ok('each vault remembers its own tabs', (await t.count('.tab')) === 2 && (await t.activeTab()) === 'Draft', await t.count('.tab'))

  await openManager()
  await page.locator('dialog .vault', { hasText: path.basename(second) }).locator('button', { hasText: 'Забыть' }).click()
  await wait(500)
  ok('a vault can be forgotten; its folder stays', (await t.count('dialog .vault')) === 1 && fs.existsSync(path.join(second, 'Second note.md')))
  fs.rmSync(second, { recursive: true, force: true })

  // ---- starting with the computer: a file where the system looks for programs to run at sign-in
  await page.keyboard.press('Escape')
  await wait(400)
  const state = await page.evaluate(() => app.vault.autostart())
  ok('start with the computer is offered and off at first', state.supported === true && state.enabled === false && /flintnotes/i.test(state.file), JSON.stringify(state))
  await page.evaluate(() => app.commands.run('core:settings'))
  await page.locator('nav button', { hasText: 'Программа' }).click()
  await wait(700)
  ok('the program page lists the vaults with their addresses', (await page.locator('.panel-setting a').first().getAttribute('href')) === `/${encodeURIComponent(vaultName)}/`, await page.locator('.panel-settings').innerText().catch(() => 'none'))
  await page.locator('.autostart-switch').check()
  await wait(900)
  const files = await import('node:fs')
  const made = files.existsSync(state.file) ? files.readFileSync(state.file, 'utf8') : ''
  ok('switching it on writes that file, naming this server', made.includes('server') && (await t.flat(page.locator('.autostart'))).includes('Включено'), made.slice(0, 200))
  await page.locator('.autostart-switch').uncheck()
  await wait(900)
  ok('switching it off removes the file', !files.existsSync(state.file) && (await t.flat(page.locator('.autostart'))).includes('Выключено'))
  await page.keyboard.press('Escape')
}
