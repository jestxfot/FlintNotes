// Notes as objects: types are notes of the types folder, objects are notes whose `type` links to one. `@` offers the
// types, `@type/` their objects, Enter links or makes one; a starter type gets its note when first used; a new type
// comes from its dialog; links are drawn in the type's look; the panel shows a note as an object; «My Life» places
// what has no place yet; a relation property offers the objects of its type.
export const viewport = { width: 1400, height: 900 }
const PERSON = '---\naliases: [Person]\nicon: user\ncolor: pink\nworld: outer\nfolder: Внешний мир/Люди\nfields: [company, birthday]\nmy life: true\n---\n\nЧеловек.\n'
export const vault = {
  plugins: ['links', 'properties', 'bases', 'objects'],
  files: {
    'Типы/Человек.md': PERSON,
    'Внешний мир/Люди/Sara Kim.md': '---\ntype: "[[Человек]]"\ncompany:\n---\n',
    'Внешний мир/Люди/Jonas Weber.md': '---\ntype: "[[Человек]]"\n---\n',
    'Day.md': 'Day\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read, exists, leaf } = t
  const list = () => page.locator('.cm-tooltip-autocomplete').innerText().catch(() => '')
  const doc = () => page.evaluate(() => app.workspace.activeEditor.state.doc.toString())
  await page.waitForFunction(() => app.metadata.resolvedLinks.has('Внешний мир/Люди/Sara Kim.md'), null, { timeout: 15000 })

  const known = await page.evaluate(() => {
    const objects = app.services.get('objects')
    return { sara: objects.typeOf('Внешний мир/Люди/Sara Kim.md')?.name, types: objects.types().map((type) => `${type.name}${type.path ? '' : '*'}`) }
  })
  ok('a note whose type links to a type note is an object of it', known.sara === 'Человек', JSON.stringify(known))
  ok('starter types are offered before their notes exist', known.types.includes('Тема*') && known.types.includes('Проект*') && !known.types.includes('Человек*'), known.types.join(', '))
  const look = await page.evaluate(() => app.icons.look('file', 'Внешний мир/Люди/Sara Kim.md'))
  ok('an object has its type’s icon and colour', look?.icon === 'user' && look?.color === 'pink', JSON.stringify(look))

  await t.open('Day')
  await page.keyboard.press('Enter')
  await page.keyboard.type('mail me at a@b')
  await wait(400)
  ok('an @ inside a word (an e-mail) offers nothing', !(await list()), await list())
  await page.keyboard.press('Enter')
  await page.keyboard.type('@')
  await wait(400)
  const types = await list()
  ok('@ offers the types', types.includes('Человек') && types.includes('Тема') && types.includes('Ключевой элемент'), types)
  ok('the list explains its keys', (await page.locator('.cm-tooltip-autocomplete').evaluate((el) => getComputedStyle(el, '::after').content)).includes('esc'))
  await page.keyboard.type('pers')
  await wait(400)
  ok('a type is found by its alias', (await page.locator('.cm-tooltip-autocomplete li').first().innerText()).includes('Человек'), await list())
  await page.keyboard.press('Enter')
  await wait(500)
  ok('choosing a type puts @Type/ in', (await doc()).endsWith('@Человек/'), await doc())
  const people = await list()
  ok('…and lists its objects', people.includes('Sara Kim') && people.includes('Jonas Weber'), people)
  await page.keyboard.type('Paco')
  await wait(400)
  ok('a name no object has can be made', (await list()).includes('Создать «Paco»'), await list())
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => app.workspace.activeEditor.state.doc.toString().includes('[[Paco]]'), null, { timeout: 5000 }).catch(() => {})
  await wait(800)
  ok('Enter makes the object and links it', (await doc()).endsWith('[[Paco]] '), await doc())
  const paco = 'Внешний мир/Люди/Paco.md'
  ok('the object is made in its type’s folder with its fields', exists(paco) && /^---\ntype: "\[\[Человек\]\]"\ncompany:\nbirthday:\nkey element:\nproject:\ntopic:\n---/.test(read(paco)), exists(paco) ? read(paco) : 'missing')
  await page.keyboard.type(', what if I told you ')
  await page.waitForFunction(() => document.querySelector('.cm-editor .obj-link'), null, { timeout: 5000 }).catch(() => {})
  ok('a link to an object is drawn in its type’s colour', (await t.count(`${leaf} .obj-link[data-object-type="Человек"]`)) === 1)

  // A starter type: its note is written when its first object is made.
  await page.keyboard.type('@Тема/object-oriented paradigm')
  await wait(500)
  await page.keyboard.press('Enter')
  const topic = 'Внутренний мир/Моя жизнь/Темы/object-oriented paradigm.md'
  await page.waitForFunction(() => app.vault.get('Внутренний мир/Моя жизнь/Темы/object-oriented paradigm.md'), null, { timeout: 5000 }).catch(() => {})
  await wait(800)
  ok('a starter type gets its note when first used', exists('Типы/Тема.md') && read('Типы/Тема.md').includes('life part: topic') && read('Типы/Тема.md').includes('```base'), exists('Типы/Тема.md') ? read('Типы/Тема.md') : 'missing')
  ok('…and the object is made in its folder', exists(topic) && read(topic).startsWith('---\ntype: "[[Тема]]"\n'), exists(topic) ? read(topic) : 'missing')
  ok('…and linked', (await doc()).includes('[[object-oriented paradigm]] '), await doc())

  // A new type from its dialog.
  await page.keyboard.press('Enter')
  await page.keyboard.type('@Tools')
  await wait(400)
  ok('a name no type has offers a new type', (await list()).includes('Новый тип «Tools»…') && (await list()).includes('Новый «Tools» как…'), await list())
  await page.locator('.cm-tooltip-autocomplete li', { hasText: 'Новый тип «Tools»' }).click()
  await page.waitForSelector('.obj-dialog[open]', { timeout: 5000 }).catch(() => {})
  ok('the dialog of a new type opens with the name', (await page.inputValue('.obj-dialog input[aria-label="Имя типа"]').catch(() => '')) === 'Tools')
  ok('…its folder follows the name, in the outer world', (await page.inputValue('.obj-dialog input[aria-label="Папка"]').catch(() => '')) === 'Tools' && (await page.locator('.obj-dialog .obj-path').innerText()).includes('Внешний мир/Tools'))
  await page.fill('.obj-dialog input[aria-label="Имя типа"]', 'Tool')
  ok('…which becomes a plural for a singular name', (await page.inputValue('.obj-dialog input[aria-label="Папка"]')) === 'Tools')
  await page.fill('.obj-dialog input[aria-label="Поля"]', 'website, company')
  await wait(200)
  ok('…and tells which fields link to a type', (await page.locator('.obj-dialog .obj-hint').innerText().catch(() => '')).includes('Компания'))
  await page.locator('.obj-dialog input[aria-label="Поля"]').press('Control+Enter')
  await page.waitForFunction(() => app.vault.get('Типы/Tool.md'), null, { timeout: 5000 }).catch(() => {})
  await wait(600)
  const tool = exists('Типы/Tool.md') ? read('Типы/Tool.md') : 'missing'
  ok('Ctrl+Enter writes the type’s note', tool.includes('world: outer') && tool.includes('folder: Внешний мир/Tools') && tool.includes('fields: [website, company]') && tool.includes('my life: true'), tool)
  ok('…and goes on to its objects', (await doc()).endsWith('@Tool/'), await doc())
  await page.keyboard.type('Hammer')
  await wait(400)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => app.vault.get('Внешний мир/Tools/Hammer.md'), null, { timeout: 5000 }).catch(() => {})
  ok('an object of the new type is made where the type says', exists('Внешний мир/Tools/Hammer.md') && read('Внешний мир/Tools/Hammer.md').includes('website:\ncompany:'))

  // The panel of the open note as an object.
  await page.evaluate(() => app.panels.reveal('object'))
  await page.evaluate(() => app.workspace.openFile('Внешний мир/Люди/Paco.md'))
  await page.waitForFunction(() => app.workspace.active?.path === 'Внешний мир/Люди/Paco.md', null, { timeout: 5000 }).catch(() => {})
  await wait(1200)
  const panel = await page.locator('.obj-panel').innerText().catch(() => '')
  ok('the panel shows the object, its type and fields', panel.includes('Paco') && panel.includes('Человек') && panel.includes('company') && panel.includes('topic'), panel)
  ok('…and the notes that mention it', panel.toLowerCase().includes('упоминания') && panel.includes('Day'), panel)

  // My Life: what has no place yet, and placing it.
  await page.evaluate(() => app.commands.run('objects:my-life'))
  await page.waitForSelector('.obj-life', { timeout: 5000 }).catch(() => {})
  await wait(400)
  const life = await page.locator('.obj-life').innerText().catch(() => '')
  ok('My Life shows the four parts', ['Ключевые элементы', 'Проекты', 'Темы', 'Привычки'].every((part) => life.includes(part)) && life.includes('object-oriented paradigm'), life)
  ok('…and what has no place on the map', /Без места[\s\S]*Paco/.test(life), life)
  await page.locator('.obj-life-unplaced li', { hasText: 'Paco' }).locator('.obj-place').click()
  await wait(300)
  await page.keyboard.type('object')
  await wait(200)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /topic: "\[\[object-oriented paradigm\]\]"/.test(app.metadata.text?.('Внешний мир/Люди/Paco.md') ?? ''), null, { timeout: 4000 }).catch(() => {})
  await wait(800)
  ok('placing writes the link under the part’s property', /\ntopic: "\[\[object-oriented paradigm\]\]"\n/.test(read(paco)), read(paco))
  await wait(400)
  ok('…and it leaves «no place»', !/Без места[\s\S]*Paco/.test(await page.locator('.obj-life').innerText()))

  // A relation property offers the objects of its type.
  const values = await page.evaluate(() => app.services.get('objects').suggestValues('topic', 'Внешний мир/Люди/Sara Kim.md'))
  ok('a relation field offers the objects of its type', JSON.stringify(values) === JSON.stringify(['[[object-oriented paradigm]]']), JSON.stringify(values))

  // The type note lists its objects with a base, as Obsidian would.
  await page.evaluate(() => app.workspace.openFile('Типы/Тема.md'))
  await page.waitForSelector(`${leaf} .cm-content`)
  await wait(1500)
  const base = await page.locator(`${leaf}`).innerText()
  ok('the type’s note lists its objects', base.includes('object-oriented paradigm'), base.slice(0, 800))
}
