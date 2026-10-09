// Bases: notes as records, with filters, formulas, four view types and editing that writes back.
const LIBRARY = `# Library

\`\`\`base
filters:
  and:
    - file.inFolder("Books")
    - file.hasTag("book")
formulas:
  with_tax: 'price * 1.2'
  label: 'if(rating, "★".repeat(rating), "нет оценки")'
properties:
  note.price:
    displayName: Цена
summaries:
  Total: 'values.sum().round(1)'
views:
  - type: table
    name: Все книги
    order:
      - file.name
      - status
      - note.price
      - formula.with_tax
      - formula.label
      - owned
      - due
      - author
    summaries:
      note.price: Total
      formula.with_tax: Average
  - type: board
    name: По статусу
    groupBy:
      property: status
    order: [file.name, note.price]
  - type: cards
    name: Читаю
    filters: 'status == "reading"'
    order: [file.name, status, file.tags]
  - type: list
    name: Дорогие
    filters: 'price > 10'
    sort:
      - property: note.price
        direction: DESC
    order: [file.name, note.price]
\`\`\`

end
`

export const viewport = { width: 1400, height: 1000 }
export const vault = {
  plugins: ['bases', 'links'],
  files: {
    'Books/Dune.md': '---\nstatus: reading\nprice: 12.5\nrating: 5\ndue: 2026-12-01\nowned: true\nauthor: "[[Herbert]]"\ntags: [book, scifi]\n---\n# Dune\n',
    'Books/Emma.md': '---\nstatus: done\nprice: 8\nrating: 4\nowned: false\ntags: [book]\n---\n# Emma\n',
    'Books/Ulysses.md': '---\nstatus: todo\nprice: 20\ntags: [book]\n---\n# Ulysses\n',
    'Herbert.md': '# Herbert\n',
    'Other.md': '---\nstatus: reading\n---\nnot a book\n',
    'Library.md': LIBRARY,
    'Broken.md': "```base\nfilters: 'nope('\nviews:\n  - type: table\n```\n\n```base\nviews: [\n```\n\nx\n",
    'Books.base': 'filters:\n  and:\n    - file.hasTag("book")\nviews:\n  - type: table\n    name: Table\n    order: [file.name, status]\n  - type: list\n    name: Names\n',
    'Embed.md': '![[Books.base#Names]]\n\nend\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read, leaf, flat } = t
  const base = page.locator(`${leaf} .base`).first()
  // Views are behind the switcher on the left of the toolbar.
  const openViews = async () => {
    if (!(await base.locator('.base-tabs').count())) await base.locator('.base-view-switch').click()
  }
  const tab = (name) => ({
    click: async () => {
      await openViews()
      await base.locator('.base-tabs button', { hasText: name }).click()
    },
  })
  const cells = async (name) => (await base.locator('tbody tr', { hasText: name }).locator('td').allInnerTexts()).map((cell) => cell.trim())
  const names = () => base.locator('tbody td:first-child').allInnerTexts()
  const type = async (value) => {
    await page.keyboard.press('Control+a')
    await page.keyboard.type(value)
    await page.keyboard.press('Enter')
    await wait(1500)
  }

  await t.open('Library')
  await wait(700)
  await openViews()
  ok('base renders with four view tabs', (await base.locator('.base-tabs button').count()) === 4, await base.innerText().catch(() => 'no base'))
  await base.locator('.base-view-switch').click()
  await wait(200)
  let text = await flat(base)
  ok('filters select the books only', text.includes('Dune') && text.includes('Emma') && text.includes('Ulysses') && !text.includes('Other') && text.includes('3 записи'), text)
  ok('columns, display name and formulas', (await flat(base.locator('thead'))).includes('Имя status Цена with_tax label owned due author') && JSON.stringify((await cells('Dune')).slice(1, 5)) === JSON.stringify(['reading', '12.5', '15', '★★★★★']), JSON.stringify(await cells('Dune')))
  ok('formula on a missing value', (await cells('Ulysses'))[4] === 'нет оценки', JSON.stringify(await cells('Ulysses')))
  ok('date and link values', (await cells('Dune'))[6] === '2026-12-01' && (await base.locator('tbody tr', { hasText: 'Dune' }).locator('a', { hasText: 'Herbert' }).count()) === 1, JSON.stringify(await cells('Dune')))
  text = await flat(base.locator('tfoot'))
  ok('summaries: custom and built-in', /total\s*40\.5/i.test(text) && /average\s*16\.2/i.test(text), text)

  await base.locator('tbody tr', { hasText: 'Emma' }).locator('td').nth(1).click()
  await wait(200)
  await type('reading')
  ok('editing a cell writes frontmatter and nothing else', read('Books/Emma.md') === '---\nstatus: reading\nprice: 8\nrating: 4\nowned: false\ntags: [book]\n---\n# Emma\n', read('Books/Emma.md'))
  ok('the cell editor is gone after Enter', (await t.count('.base-input')) === 0)
  await base.locator('tbody tr', { hasText: 'Ulysses' }).locator('td').nth(2).click()
  await wait(200)
  await type('30')
  ok('a number cell stays a number, totals follow', read('Books/Ulysses.md').includes('price: 30\n') && /total\s*50\.5/i.test(await flat(base.locator('tfoot'))), read('Books/Ulysses.md'))
  await base.locator('tbody tr', { hasText: 'Emma' }).locator('input[type=checkbox]').click()
  await wait(1500)
  ok('a checkbox cell toggles the property', read('Books/Emma.md').includes('owned: true'), read('Books/Emma.md'))
  await base.locator('tbody tr', { hasText: 'Ulysses' }).locator('td').nth(6).click()
  await wait(200)
  await page.locator('.base-input').fill('2027-01-15')
  await page.keyboard.press('Enter')
  await wait(1500)
  ok('an empty date cell gets a date editor', read('Books/Ulysses.md').includes('due: 2027-01-15'), read('Books/Ulysses.md'))

  await base.locator('thead th', { hasText: 'Цена' }).click()
  await wait(600)
  ok('a header click writes the sort into the block', /name: Все книги[\s\S]*?sort:\n\s+- property: note\.price\n\s+direction: ASC/.test(read('Library.md')), read('Library.md'))
  ok('rows sorted ascending', JSON.stringify(await names()) === JSON.stringify(['Emma', 'Dune', 'Ulysses']), JSON.stringify(await names()))
  await base.locator('thead th', { hasText: 'Цена' }).click()
  await wait(600)
  ok('a second click sorts descending', (await names())[0] === 'Ulysses' && read('Library.md').includes('direction: DESC'))
  ok('the rest of the block is untouched', read('Library.md').includes("with_tax: 'price * 1.2'") && read('Library.md').includes('order: [file.name, note.price]') && read('Library.md').endsWith('```\n\nend\n'), read('Library.md').slice(-60))

  await tab('По статусу').click()
  await wait(400)
  const titles = (await base.locator('.base-column .base-group-title').allInnerTexts()).map((title) => title.replace(/\s+/g, '').toUpperCase())
  ok('board has a column per status', JSON.stringify(titles) === JSON.stringify(['READING2', 'TODO1']), JSON.stringify(titles))
  await base.locator('.base-card', { hasText: 'Dune' }).dragTo(base.locator('.base-column', { hasText: /todo/i }))
  await wait(1500)
  ok('dragging a card changes the property', read('Books/Dune.md').includes('status: todo'), read('Books/Dune.md'))
  ok('board redraws after the move', (await flat(base.locator('.base-column', { hasText: /todo/i }))).includes('Dune'))

  await tab('Читаю').click()
  await wait(400)
  text = await flat(base)
  ok('cards view with its own filter', (await base.locator('.base-card').count()) === 1 && text.includes('Emma') && (await base.locator('.base-card .base-pill').allInnerTexts()).includes('book') && text.includes('1 запись'), text)
  await tab('Дорогие').click()
  await wait(400)
  ok('list view sorted by price', JSON.stringify(await base.locator('.base-list li a').allInnerTexts()) === JSON.stringify(['Ulysses', 'Dune']))

  await base.locator('.base-tool', { hasText: 'Группа' }).click()
  await wait(300)
  await base.locator('.base-setting', { hasText: 'Группировка' }).locator('select').first().selectOption('status')
  await wait(700)
  ok('the settings panel writes groupBy', /name: Дорогие[\s\S]*groupBy:\n\s+property: status/.test(read('Library.md')) && (await base.locator('.base-group-title').count()) === 1, read('Library.md').slice(-200))
  await base.locator('.base-tool', { hasText: 'Свойства' }).click()
  await wait(300)
  await base.locator('.base-props-search').fill('rat')
  await wait(200)
  ok('the property list can be searched', (await base.locator('.base-check').count()) === 1)
  await base.locator('.base-check', { hasText: 'rating' }).locator('input').check()
  await wait(700)
  ok('the settings panel adds a property', /name: Дорогие[\s\S]*rating/.test(read('Library.md')), read('Library.md').slice(-260))
  await openViews()
  await base.locator('.base-add-view').click()
  await base.locator('.base-add-type', { hasText: 'Карточки' }).click()
  await wait(700)
  ok('a view can be added from the toolbar', (await base.locator('.base-view-switch b').innerText()) === 'Карточки' && /- type: cards\n\s+name: Карточки/.test(read('Library.md')), read('Library.md').slice(-120))
  // The settings of the new view: its size and its pictures.
  await base.locator('.base-setting', { hasText: 'Размер карты' }).locator('input').evaluate((input) => {
    input.value = '240'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await wait(700)
  ok('a view is set up in its panel: name, layout, card size', /name: Карточки\n\s+cardSize: 240/.test(read('Library.md')) && (await t.flat(base.locator('.base-pop'))).includes('Настройка представления') && (await base.locator('.base-setting', { hasText: 'Расположение' }).count()) === 1, read('Library.md').slice(-160))
  await base.locator('.base-setting', { hasText: 'Расположение' }).locator('select').selectOption('calendar')
  await wait(700)
  ok('the calendar layout puts notes on their days', (await base.locator('.base-calendar-grid .base-calendar-day').count()) >= 28 && (await base.locator('.base-calendar-note').count()) >= 1 && (await t.flat(base.locator('.base-calendar-by'))).includes('по'), await t.flat(base.locator('.base-calendar')).catch(() => 'none'))
  await base.locator('.base-delete').click()
  await wait(700)
  ok('and removed again', (await base.locator('.base-tabs button').count()) === 4 && (await base.locator('.base-delete').count()) === 0 && !/name: Карточки/.test(read('Library.md')))

  // ---- the tools on the right of the toolbar
  await tab('Все книги').click()
  await wait(300)
  await base.locator('.base-tool', { hasText: 'Сортировка' }).click()
  await base.locator('.base-pop-add').click()
  await wait(600)
  const before = await base.locator('.base-pop .base-setting').count()
  await base.locator('.base-pop .base-setting').last().locator('select').first().selectOption('rating')
  await wait(600)
  await base.locator('.base-pop .base-setting').last().locator('select').nth(1).selectOption('DESC')
  await wait(700)
  ok('the sort panel adds a sort rule to the base', before >= 1 && /- property: rating\n\s+direction: DESC/.test(read('Library.md')), read('Library.md').slice(0, 500))
  await base.locator('.base-pop-remove').last().click()
  await wait(600)
  ok('and removes it', !/- property: rating\n\s+direction: DESC/.test(read('Library.md')) && (await base.locator('.base-pop .base-setting').count()) === before - 1)

  await base.locator('.base-tool', { hasText: 'Фильтр' }).click()
  await wait(300)
  const filters = base.locator('.base-filter')
  ok('the filter panel shows the conditions of the base and of the view', (await filters.count()) === 2 && (await filters.first().locator('.base-condition').count()) >= 1, await t.flat(base.locator('.base-pop')))
  const rows = filters.nth(1).locator('.base-condition')
  const had = await rows.count()
  await filters.nth(1).locator('.base-pop-add', { hasText: 'Добавить фильтр' }).last().click()
  await wait(700)
  // A condition is three fields: what, how, and against what.
  await rows.last().locator('.base-condition-op').selectOption('!hasTag')
  await wait(600)
  await rows.last().locator('.base-condition-value').fill('nope')
  await rows.last().locator('.base-condition-value').press('Tab')
  await wait(800)
  ok('a condition is set with fields and written as an expression', (await rows.count()) === had + 1 && read('Library.md').includes('!file.hasTag("nope")') && (await base.locator('tbody tr').count()) === 3, read('Library.md').slice(0, 500))
  // The same condition as an expression, for what the fields cannot say.
  await rows.last().locator('button[title="Показать выражением"]').click()
  await wait(400)
  await rows.last().locator('.base-filter-expr').fill('price > 20')
  await rows.last().locator('.base-filter-expr').press('Tab')
  await wait(800)
  ok('a condition added there filters the view and is written to the base', /price > 20/.test(read('Library.md')) && (await base.locator('tbody tr').count()) === 1, `${await base.locator('tbody tr').count()}`)
  ok('a plain comparison is shown with fields again', (await rows.last().locator('.base-condition-op').inputValue()) === '>' && (await rows.last().locator('.base-condition-value').inputValue()) === '20')
  await rows.last().locator('.base-pop-remove').last().click()
  await wait(700)
  ok('and removing it brings the rows back', !/price > 20/.test(read('Library.md')) && (await base.locator('tbody tr').count()) === 3)
  await filters.nth(1).locator('.base-pop-add', { hasText: 'Добавить группу фильтров' }).last().click()
  await wait(700)
  ok('a nested group of conditions can be added', (await filters.nth(1).locator('.base-filter-group.nested').count()) === 1 && /- and:\n\s+- file\.hasTag\(""\)/.test(read('Library.md')), read('Library.md').slice(0, 600))
  await filters.nth(1).locator('.base-filter-group.nested button[title="Убрать группу"]').click()
  await wait(700)
  // The panel is not cut off by the base it belongs to, however short that is.
  const [panelBox, baseBox] = [await base.locator('.base-pop').boundingBox(), await base.boundingBox()]
  const onTop = await base.locator('.base-pop .base-pop-add').last().evaluate((button) => {
    const box = button.getBoundingClientRect()
    return document.elementFromPoint(box.left + 5, box.top + 5) === button
  })
  ok('the panel lies over the page, whole and clickable', onTop && panelBox.height > 100 && panelBox.y >= baseBox.y && panelBox.y + panelBox.height <= 1000, JSON.stringify([panelBox, baseBox]))
  await page.mouse.click(5, 5)
  await wait(300)
  ok('a click elsewhere closes the panel', (await base.locator('.base-pop').count()) === 0)

  await base.locator('.base-tool', { hasText: 'Поиск' }).click()
  await base.locator('.base-search').pressSequentially('emm')
  await wait(400)
  ok('the search narrows the rows without touching the base', (await base.locator('tbody tr').count()) === 1 && (await t.flat(base.locator('.base-count'))) === '1 запись' && !read('Library.md').includes('emm'))
  await base.locator('.base-search').fill('')
  await wait(300)

  await base.locator('.base-toolbar button', { hasText: 'Создать' }).click()
  await wait(1500)
  ok('a new record satisfies the filters', read('Books/Без названия.md').startsWith('---\ntags:\n  - book\n---'), read('Books/Без названия.md'))
  await t.tab('Library').click()
  await wait(1200)
  text = await flat(base)
  ok('the new record appears in the base', text.includes('Без названия') && text.includes('4 записи'), text)

  await t.open('Broken')
  text = await flat(page.locator(leaf))
  ok('errors are shown, not thrown', text.includes('nope(') && text.includes('Ошибка в YAML'), text)

  await t.row('Books.base').click()
  await wait(1200)
  await page.locator(`${leaf} .base-file .base-view-switch`).click()
  text = await flat(page.locator(`${leaf} .base-file`))
  await page.locator(`${leaf} .base-file .base-view-switch`).click()
  ok('a .base file opens as a base', text.includes('Table') && text.includes('Names') && text.includes('Dune') && text.includes('Исходный текст'), text)
  await page.locator(`${leaf} .base-file thead th`, { hasText: 'status' }).click()
  await wait(800)
  ok('changes are saved into the .base file', read('Books.base').includes('sort:') && read('Books.base').endsWith('\n'), read('Books.base'))
  await page.locator(`${leaf} .base-file-head button`).click()
  await wait(400)
  ok('the source view shows the YAML', (await page.locator(`${leaf} textarea`).inputValue()).includes('file.hasTag("book")'))
  await page.locator(`${leaf} .base-file-head button`).click()
  await wait(600)

  await t.open('Embed')
  await wait(900)
  text = await flat(page.locator(`${leaf} .lp-embed`))
  ok('an embedded base opens on the named view', (await page.locator(`${leaf} .lp-embed .base-view-switch b`).innerText()) === 'Names' && text.includes('Ulysses') && (await page.locator(`${leaf} .lp-embed .base-list`).count()) === 1, text)
}
