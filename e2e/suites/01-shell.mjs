// The core: file tree, editor with autosave, tabs, settings, plugin toggling.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from '../helpers.mjs'

// No vault: the server creates the welcome one on first start.
export const vault = null
export const viewport = { width: 1200, height: 760 }

const builtin = fs.readdirSync(path.join(ROOT, 'src/plugins')).length

export function afterStart(t) {
  fs.cpSync(path.join(ROOT, 'examples/plugins/hello-world'), path.join(t.vault, '.flint/plugins/hello-world'), { recursive: true })
  // This suite counts tabs with one tab per note; opening in place is checked in the Dataview suite.
  fs.writeFileSync(path.join(t.vault, '.flint/settings.json'), JSON.stringify({ core: { reuseTab: false } }))
}

export async function run(t) {
  const { page, ok, wait, read, exists } = t
  const palette = 'dialog:has(input[placeholder="Команда…"])'
  const status = () => page.locator('.status-bar').innerText()
  const focused = (className) => page.evaluate((c) => document.activeElement?.classList.contains(c), className)

  // The page may be served from another local port (the dev server), never from another site.
  const post = (headers) => fetch(`${t.url}api/folder?path=probe-${Math.random()}`, { method: 'POST', headers }).then((r) => r.status)
  ok('writes accepted from a local page on another port', (await post({ Origin: 'http://localhost:5173' })) === 200 && (await post({ Origin: 'http://127.0.0.1:5173' })) === 200)
  ok('writes refused from a foreign site', (await post({ Origin: 'http://evil.example' })) === 403)
  await page.reload()

  await page.waitForSelector('.tree .row')
  ok('tree lists welcome note', (await t.row('Добро пожаловать').count()) === 1)
  ok('empty state shown', (await t.count('.empty')) === 1)

  await t.row('Добро пожаловать').click()
  await page.waitForSelector('.cm-content')
  ok('editor shows file', (await t.text()).includes('Добро пожаловать в FlintNotes'))
  ok('editor focused after open', await focused('cm-content'))

  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nautosaved-line')
  await wait(900)
  ok('autosave writes to disk', read('Добро пожаловать.md').includes('autosaved-line'))

  t.write('Добро пожаловать.md', '# Changed outside\n')
  await wait(1500)
  ok('external change reloads editor', (await t.text()).includes('Changed outside'))

  await page.keyboard.press('Control+p')
  ok('palette opens on Ctrl+P', (await t.count(palette)) === 1)
  ok('palette lists core commands', (await t.count('[role=option]')) >= 6)
  await page.keyboard.type('настр')
  await page.keyboard.press('Enter')
  await page.waitForSelector('dialog[aria-label="Настройки"]')
  ok('palette runs a command and closes', (await t.count(palette)) === 0)

  await page.locator('nav button', { hasText: 'Плагины' }).click()
  const plug = (name) => page.locator('label.item', { hasText: name }).locator('input')
  ok('all plugins listed, all off', (await t.count('label.item')) === builtin + 1 && (await t.count('label.item input:checked')) === 0, await t.count('label.item'))
  await plug('Счётчик слов').check()
  await wait(300)
  ok('word count in status bar', /2 слова/.test(await status()), await status())
  ok('plugin settings section appears', (await page.locator('nav button.sub', { hasText: 'Счётчик слов' }).count()) === 1)
  await page.locator('nav button.sub', { hasText: 'Счётчик слов' }).click()
  await page.locator('label.item', { hasText: 'число символов' }).locator('input').check()
  await wait(100)
  ok('plugin setting applies live', /символ/.test(await status()), await status())
  await page.locator('nav button', { hasText: 'Плагины' }).click()
  await plug('Номера строк').check()
  await wait(300)
  ok('line numbers added to open editor', (await t.count('.cm-lineNumbers')) === 1)
  await plug('Номера строк').uncheck()
  await wait(200)
  ok('line numbers removed on disable', (await t.count('.cm-lineNumbers')) === 0)
  await plug('Hello World').check()
  await wait(500)
  ok('vault plugin enabled', await plug('Hello World').isChecked())
  await page.locator('nav button', { hasText: 'Оформление' }).click()
  await page.locator('select').first().selectOption('dark')
  await wait(100)
  ok('theme setting applies', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
  // The search finds settings on any page, plugins' pages included.
  await page.locator('nav .search').fill('шрифт')
  await wait(200)
  ok('settings can be searched', (await t.count('.body label.item')) === 1 && (await t.flat(page.locator('.body'))).includes('Размер шрифта'), await t.flat(page.locator('.body')))
  await page.locator('nav .search').fill('')
  // A shortcut of the user's own replaces the command's.
  await page.locator('nav button', { hasText: 'Сочетания клавиш' }).click()
  const key = page.locator('.key-row', { hasText: 'Закрыть вкладку' }).locator('.hotkey')
  ok('commands are listed with their shortcuts', (await key.innerText()) === 'Alt+W', await key.innerText())
  await key.click()
  await page.keyboard.press('Control+Alt+KeyQ')
  await wait(300)
  ok('a shortcut can be changed', (await key.innerText()) === 'Ctrl+Alt+Q', await key.innerText())
  await page.keyboard.press('Escape')
  await wait(600)
  ok('settings closed by Escape', (await t.count('dialog')) === 0)
  const saved = JSON.parse(read('.flint/settings.json'))
  ok('settings persisted in vault', saved.core.theme === 'dark' && saved.core.enabledPlugins.length === 2 && saved['word-count'].characters === true, JSON.stringify(saved))

  await page.keyboard.press('Control+p')
  await page.keyboard.type('hello')
  await page.keyboard.press('Enter')
  await wait(200)
  ok('vault plugin command shows notice', (await page.locator('.notice').innerText().catch(() => '')).includes('Привет'))

  await page.locator('button[title="Новая заметка"]').click()
  await page.waitForSelector('input.rename')
  await wait(500)
  ok('rename field keeps focus after create', await focused('rename'))
  await page.keyboard.type('Мой план')
  await page.keyboard.press('Enter')
  await wait(700)
  ok('new note renamed on disk', exists('Мой план.md') && !exists('Без названия.md'))
  ok('tab follows rename', (await t.activeTab()) === 'Мой план')
  ok('focus moves to editor after naming', await focused('cm-content'))
  await page.keyboard.type('текст заметки')
  await wait(900)
  ok('Enter in the name field does not leak into the note', read('Мой план.md') === 'текст заметки', JSON.stringify(read('Мой план.md')))
  ok('word count follows active tab', /2 слова/.test(await status()), await status())

  await page.locator('button[title="Новая папка"]').click()
  await page.waitForSelector('input.rename')
  await page.keyboard.type('Проекты')
  await page.keyboard.press('Enter')
  await wait(500)
  ok('folder created', fs.statSync(path.join(t.vault, 'Проекты')).isDirectory())
  await t.row('Проекты').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Новая заметка' }).click()
  await page.waitForSelector('input.rename')
  await page.keyboard.type('Вложенная')
  await page.keyboard.press('Enter')
  await wait(600)
  ok('note created inside folder via menu', exists('Проекты/Вложенная.md'))
  await t.row('Проекты').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Переименовать' }).click()
  await page.waitForSelector('input.rename')
  await page.keyboard.type('Архив')
  await page.keyboard.press('Enter')
  await wait(1500)
  ok('folder rename moves open note', exists('Архив/Вложенная.md') && (await page.locator('.tab.active .tab-title').getAttribute('title')) === 'Архив/Вложенная.md')
  ok('renamed folder stays expanded, tabs stay open', (await t.row('Вложенная').count()) === 1 && (await t.count('.tab')) === 3)

  t.write('pic.png', 'x')
  await wait(1200)
  await t.row('pic.png').click()
  await wait(300)
  ok('unsupported file shows fallback view', (await page.locator(`${t.leaf} .leaf-message`).innerText()).includes('.png'))
  await page.keyboard.press('Alt+w')
  await wait(200)
  ok('the old shortcut no longer works once changed', (await t.count('.tab')) === 4, await t.count('.tab'))
  await page.keyboard.press('Control+Alt+KeyQ')
  await wait(200)
  ok('Alt+W closes tab', (await t.count('.tab')) === 3)

  await t.row('Мой план').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Удалить' }).click()
  await wait(700)
  ok('delete moves to trash and closes tab', exists('.trash/Мой план.md') && (await t.count('.tab')) === 2)

  await page.reload()
  await page.waitForSelector(`${t.leaf} .cm-content`)
  await wait(800)
  ok('tabs restored after reload', (await t.count('.tab')) === 2 && (await t.activeTab()) === 'Вложенная')
  ok('plugins restored after reload', /слов/.test(await status()), await status())
  ok('theme restored after reload', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')

  // ---- many tabs come back, in order, each with its own note and nothing lying over another
  t.write('T1.md', 'first tab\n')
  t.write('T2.md', 'second tab\n')
  t.write('T3.md', 'third tab\n')
  await wait(1200)
  for (const name of ['T1', 'T2', 'T3']) await t.open(name)
  const names = async () => (await page.locator('.tab .tab-title').allInnerTexts()).map((n) => n.trim()).join(',')
  const before = await names()
  await wait(800)
  await page.reload()
  await page.waitForSelector(`${t.leaf} .cm-content`)
  await wait(1000)
  ok('five tabs come back in their order', (await names()) === before && before.split(',').length === 5 && (await t.activeTab()) === 'T3', `${before} -> ${await names()}`)
  ok('only the open tab is loaded, in one view', (await t.count('.leaf-view')) === 1 && (await t.text()).includes('third tab'), await t.count('.leaf-view'))
  await t.tab('T1').click()
  await wait(800)
  ok('another tab loads when it is shown', (await t.text()).includes('first tab') && (await t.count(`${t.leaf} .leaf-view`)) === 1 && (await t.count('.leaf:not([hidden])')) === 1)
  // A reload in the middle of restoring must not lose the tabs that were not shown yet.
  await page.reload()
  await page.reload()
  await page.waitForSelector(`${t.leaf} .cm-content`)
  await wait(1000)
  ok('and a reload right after a reload keeps them all', (await names()) === before, await names())
}
