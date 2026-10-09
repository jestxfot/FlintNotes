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
}

export async function run(t) {
  const { page, ok, wait, read, exists } = t
  const palette = 'dialog:has(input[placeholder="Команда…"])'
  const status = () => page.locator('.status-bar').innerText()
  const focused = (className) => page.evaluate((c) => document.activeElement?.classList.contains(c), className)

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
  await page.locator('nav button', { hasText: 'Основные' }).click()
  await page.locator('select').first().selectOption('dark')
  await wait(100)
  ok('theme setting applies', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
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
}
