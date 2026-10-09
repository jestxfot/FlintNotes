import path from 'node:path'
import { ROOT } from '../helpers.mjs'
const fixturePath = (name) => path.join(ROOT, 'e2e/fixtures', name)
// Obsidian's look: tab strip, path header, inline title; the context menu; icons and colours in Iconic's format.
const iconic = {
  showAllFileIcons: false,
  showAllFolderIcons: true,
  someOtherSetting: 'kept',
  fileIcons: { 'Food/Soup.md': { icon: 'food-soup' }, Food: { icon: '🍲', color: 'orange', unsynced: ['abc'] }, 'Plain.md': { icon: 'lucide-star', color: '#ff0000' } },
  tagIcons: { song: { icon: 'lucide-music-4', color: 'purple' } },
  propertyIcons: { tags: { icon: 'lucide-tags', color: 'purple' } },
  fileRules: [{ id: 'a', name: 'Cal', match: 'any', conditions: [{ source: 'tree', operator: 'is', value: 'Calendar' }], enabled: true, icon: '📆' }],
  folderRules: [],
}
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>'

export const viewport = { width: 1300, height: 700 }
export const vault = {
  plugins: ['iconic', 'tags', 'properties'],
  files: {
    '.obsidian/app.json': '{}',
    '.obsidian/plugins/iconic/data.json': JSON.stringify(iconic, null, 2),
    '.obsidian/custom-icons/food-soup.svg': SVG,
    'Plain.md': '---\ntags: [song, other]\n---\nText with #song and #other.\n',
    'Food/Soup.md': '# Soup\n',
    'Other.md': '---\nrefs:\n  - "[[Many/File 00]]"\n  - "[[Food/Soup]]"\nlink: "[[Elsewhere]]"\n---\n',
    'Linked.md': '---\nlink: "[[Plain]]"\nrefs:\n  - "[[Food/Soup]]"\nsite: https://example.com\n---\ntext\n',
    'Calendar/2026/Day.md': 'day\n',
    'Zeta/Deep/Deeper/Note.md': 'x\n',
    ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`Many/File ${String(i).padStart(2, '0')}.md`, 'x\n'])),
  },
}

export async function run(t) {
  const { page, ok, wait, read, leaf } = t
  await t.open('Plain')
  await wait(800)

  // ---- the look
  ok('the tab strip has a button for a new note and for each sidebar', (await t.count('.tabbar .bar-button')) === 3)
  ok('the path of the note is shown above it', (await t.flat(page.locator('.view-header .crumbs'))) === 'Plain', await t.flat(page.locator('.view-header .crumbs')))
  const title = page.locator(`${leaf} .inline-title`)
  ok('the name of the note is its heading', (await title.inputValue()) === 'Plain')
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  ok("the page uses Obsidian's colours", ['rgb(255, 255, 255)', 'rgb(30, 30, 30)'].includes(bg), bg)

  // ---- icons and colours from Iconic's data
  const row = (name) => t.row(name)
  ok('a file has its icon and colour', (await row('Plain').locator('.row-icon svg').count()) === 1 && (await row('Plain').locator('.name').evaluate((el) => getComputedStyle(el).color)) === 'rgb(255, 0, 0)')
  ok('a folder has its emoji', (await row('Food').locator('.row-icon').innerText()) === '🍲', await row('Food').innerText())
  ok('folders without an icon get the plain one, files do not', (await row('Many').locator('.row-icon svg').count()) === 1)
  ok('the open tab shows the icon', (await page.locator('.tab.active .tab-icon svg').count()) === 1)
  await row('Food').click()
  await wait(300)
  ok('a custom icon is a picture from the settings folder', (await row('Soup').locator('.row-icon img').count()) === 1)
  await row('Calendar').click()
  await row('2026').click()
  await wait(300)
  ok('a rule gives icons to everything below a folder', (await row('Day').locator('.row-icon').innerText()) === '📆')
  ok('files without an icon stay plain', (await row('Soup').count()) === 1 && (await t.count('.tree .row .row-icon')) >= 5)

  const tag = page.locator(`${leaf} .cm-content .lp-tag`, { hasText: 'song' })
  const purple = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-purple').trim())
  ok('a tag in the text has its colour and icon', (await tag.evaluate((el) => el.style.getPropertyValue('--tag-color'))) === 'var(--color-purple)' && (await t.count(`${leaf} .cm-content .lp-tag-icon svg`)) === 1 && purple.startsWith('#'), purple)
  ok('so does the tag among the properties', (await page.locator(`${leaf} .props-tag`, { hasText: 'song' }).locator('.icon svg').count()) === 1)
  ok('a property has its icon', (await page.locator(`${leaf} .props-row[data-key="tags"] .props-icon svg`).count()) === 1)

  // ---- a click on an icon, wherever it is shown, opens the choice of icons for that item
  await row('Plain').locator('.row-icon .icon').click()
  ok('a click on a file\'s icon opens the choice of icons', (await page.locator('.iconic-dialog h2').innerText()) === 'Plain.md' && (await t.activeTab()) === 'Plain')
  await page.keyboard.press('Escape')
  await page.locator(`${leaf} .props-row[data-key="tags"] .props-icon`).click()
  ok('and so does a click on a property\'s', (await page.locator('.iconic-dialog h2').innerText()) === 'tags')
  await page.keyboard.press('Escape')
  ok('tags among the properties are shown without #', (await page.locator(`${leaf} .props-tag`).first().innerText()).trim().startsWith('song'))

  // ---- the context menu
  await row('Many').click()
  await wait(300)
  const last = t.row('File 29')
  await last.scrollIntoViewIfNeeded()
  await last.click({ button: 'right' })
  const menu = page.locator('.menu').first()
  await wait(300)
  const box = await menu.boundingBox()
  ok('the menu stays on the screen', box.y >= 0 && box.y + box.height <= 700 && box.x + box.width <= 1300, JSON.stringify(box))
  const text = await t.flat(menu)
  ok('the menu has the usual items in sections', /Новая заметка Новая папка.*Открыть в новой вкладке.*Создать копию.*Копировать путь.*Показать в проводнике.*Задать значок….*Переименовать Удалить/.test(text) && (await menu.locator('hr').count()) >= 5, text)
  ok('items have icons, deleting is red', (await menu.locator('.menu-icon svg').count()) >= 8 && (await menu.locator('button.danger').innerText()).includes('Удалить'))
  await menu.locator('button', { hasText: 'Копировать путь' }).hover()
  await wait(300)
  ok('a submenu opens beside its item', (await t.count('.menu')) === 2 && (await t.flat(page.locator('.menu').nth(1))).includes('Путь в хранилище'))
  await page.keyboard.press('Escape')
  await page.mouse.click(700, 300)
  await wait(200)
  ok('a click elsewhere closes the menu', (await t.count('.menu')) === 0)

  await last.click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Создать копию' }).click()
  await wait(1200)
  ok('"make a copy" copies the file', t.exists('Many/File 29 1.md') && read('Many/File 29 1.md') === 'x\n')

  // ---- giving an icon writes Iconic's file
  await t.row('Zeta').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Задать значок…' }).click()
  const dialog = page.locator('.iconic-dialog')
  await dialog.locator('.iconic-search').fill('rocket')
  await wait(600)
  await dialog.locator('.iconic-icon[title="rocket"]').click()
  await dialog.locator('.iconic-color[title="green"]').click()
  await dialog.locator('button', { hasText: 'Готово' }).click()
  await wait(1200)
  const saved = JSON.parse(read('.obsidian/plugins/iconic/data.json'))
  ok("the choice is saved in Iconic's own file and format", JSON.stringify(saved.fileIcons.Zeta) === '{"icon":"lucide-rocket","color":"green"}' && saved.someOtherSetting === 'kept' && saved.fileIcons.Food.unsynced[0] === 'abc' && read('.obsidian/plugins/iconic/data.json').startsWith('{\n  "showAllFileIcons"'), JSON.stringify(saved.fileIcons))
  ok('and shows at once', (await t.row('Zeta').locator('.row-icon svg').count()) === 1 && (await t.row('Zeta').locator('.name').evaluate((el) => el.style.color)) === 'var(--color-green)')

  await t.open('Plain')
  await tag.click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Изменить значок…' }).click()
  await dialog.locator('button', { hasText: 'Убрать значок и цвет' }).click()
  await wait(1200)
  ok('a tag can lose its icon from its own menu', !('song' in JSON.parse(read('.obsidian/plugins/iconic/data.json')).tagIcons) && (await t.count(`${leaf} .cm-content .lp-tag-icon`)) === 0)

  // A rename keeps the look, in the file too.
  await t.row('Zeta').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Переименовать' }).click()
  await page.waitForSelector('input.rename')
  await page.keyboard.type('Alpha')
  await page.keyboard.press('Enter')
  await wait(1500)
  const after = JSON.parse(read('.obsidian/plugins/iconic/data.json')).fileIcons
  ok('a renamed folder keeps its icon', after.Alpha?.icon === 'lucide-rocket' && !after.Zeta && (await t.row('Alpha').locator('.row-icon svg').count()) === 1, JSON.stringify(after))

  // ---- links among the properties open what they point to
  await t.open('Linked')
  const prop = (key) => page.locator(`${leaf} .props-row[data-key="${key}"]`)
  ok('a property that is a link is shown as one', (await prop('link').locator('a.inline-link').innerText()) === 'Plain' && (await prop('refs').locator('.props-chip a.inline-link').count()) === 1 && (await prop('site').locator('a.inline-link').count()) === 1)
  await prop('refs').locator('a.inline-link').click()
  await wait(600)
  ok('a link in a list property opens its note', (await t.activeTab()) === 'Soup', await t.activeTab())
  await t.open('Linked')
  await prop('link').hover()
  await prop('link').locator('.props-edit').click()
  ok('the pencil brings back the text of the link for editing', (await prop('link').locator('input.props-value').inputValue()) === '[[Plain]]')
  await prop('link').locator('a.inline-link').count()
  await page.keyboard.press('Escape')
  await t.cursorToEnd()
  await prop('link').locator('a.inline-link, input.props-value').first().waitFor()

  // ---- a property's field offers the values that same property has elsewhere
  await t.open('Linked')
  await prop('refs').locator('.props-list input').click()
  const offered = page.locator('.props-suggest .props-suggest-row')
  ok('values of the same property in other notes are offered, and nothing else', (await offered.allInnerTexts()).map((v) => v.trim()).join('|') === 'File 00', (await offered.allInnerTexts()).join('|'))
  await offered.first().dispatchEvent('mousedown')
  await wait(900)
  ok('a chosen value is added to the property', read('Linked.md').includes('[[Many/File 00]]'), read('Linked.md'))

  // ---- the menu of a property
  await t.open('Linked')
  await prop('site').locator('.props-icon').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Тип свойства' }).hover()
  await wait(300)
  ok('a property has a menu with its type, the clipboard and deleting', /Тип свойства.*Вырезать.*Копировать.*Вставить.*Удалить/.test(await t.flat(page.locator('.menu').first())) && (await t.flat(page.locator('.menu').nth(1))).includes('Дата и время'), await t.flat(page.locator('.menu').first()))
  await page.locator('.menu').nth(1).locator('button', { hasText: 'Список' }).click()
  await wait(900)
  ok('the type is changed from the menu', read('Linked.md').includes('site:\n  - https://example.com') || read('Linked.md').includes('site: [https://example.com]'), read('Linked.md'))
  await prop('site').locator('.props-icon').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Удалить' }).click()
  await wait(900)
  ok('and the property deleted', !read('Linked.md').includes('site'))

  // ---- the inline title renames the note
  await t.open('Plain')
  await title.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('Renamed')
  const typed = await title.inputValue()
  await page.keyboard.press('Enter')
  await wait(1500)
  ok('editing the heading renames the note', t.exists('Renamed.md') && !t.exists('Plain.md') && (await t.activeTab()) === 'Renamed', `typed "${typed}", tab "${await t.activeTab()}", focus ${await page.evaluate(() => document.activeElement?.className)}, text ${(await t.text()).slice(0, 80)}`)
  ok('and its icon follows', JSON.parse(read('.obsidian/plugins/iconic/data.json')).fileIcons['Renamed.md']?.icon === 'lucide-star')

  // ---- a picture of the user's own becomes an SVG icon that is kept
  await t.row('Renamed').click({ button: 'right' })
  await page.locator('.menu button', { hasText: /значок…/ }).click()
  const own = page.locator('.iconic-dialog')
  await own.locator('input[type=file]').setInputFiles(fixturePath('pic.png'))
  await wait(1500)
  const svg = t.exists('.obsidian/custom-icons/pic.svg') ? read('.obsidian/custom-icons/pic.svg') : ''
  ok('an uploaded PNG is kept as an SVG among the custom icons', svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.includes('viewBox="0 0 100 100"') && svg.includes('href="data:image/png;base64,'), svg.slice(0, 120))
  ok('and is chosen in the picker at once', (await own.locator('.iconic-icon.selected').getAttribute('title')) === 'pic' && (await own.locator('.iconic-preview img').count()) === 1)
  await own.locator('button', { hasText: 'Готово' }).click()
  await wait(1200)
  ok('the note takes it', JSON.parse(read('.obsidian/plugins/iconic/data.json')).fileIcons['Renamed.md']?.icon === 'pic' && (await t.row('Renamed').locator('.row-icon img').evaluate((img) => img.complete && img.naturalWidth > 0)))
  await page.reload()
  await page.waitForSelector('.tree .row')
  await wait(1500)
  ok('and it is still there after a reload', (await t.row('Renamed').locator('.row-icon img').evaluate((img) => img.naturalWidth > 0).catch(() => false)) === true, await t.row('Renamed').innerHTML().catch(() => 'no row'))
}
