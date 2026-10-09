// Dataview: TABLE, LIST, TASK and CALENDAR queries, fields written in the text, inline values, scripts.
import { day } from '../helpers.mjs'

const today = day()
export const vault = {
  plugins: ['dataview', 'links'],
  // Opening a note in place of the current one is checked at the end of this suite.
  settings: { core: { reuseTab: true } },
  files: {
    'Books/Dune.md': '---\nauthor: Herbert\nrating: 5\ntags: [book, scifi]\nread: 2026-01-15\n---\n# Dune\n\npages:: 612\n\nA novel [genre:: fiction] about sand, see [[Emma]].\n\n- [ ] Reread Dune 📅 2026-12-01\n  - [ ] Take notes\n- [x] Buy Dune\n',
    'Books/Emma.md': '---\nauthor: Austen\nrating: 4\ntags: [book]\n---\n# Emma\n\npages:: 474\nside dish:: tea\n\n- [ ] Finish Emma\n',
    'Books/Notes/Draft.md': '---\nrating: 2\n---\nNo author here.\n\n```\nhidden:: yes\n- [ ] not a task\n```\n',
    [`life/Calendar/${today}.md`]: '---\ntags: [daily]\n---\nmood:: 7\nbreakfast:: [[Emma]]\n',
    'life/Calendar/2026-01-05.md': 'mood:: 3\n',
    'Q.md': [
      '# Queries',
      '',
      '```dataview',
      'TABLE author AS "Автор", rating, pages + 1 AS "Next"',
      'FROM "Books"',
      'WHERE rating >= 4',
      'SORT rating DESC',
      '```',
      '',
      '```dataview',
      'LIST "★" * rating FROM #book AND -#scifi',
      '```',
      '',
      '```dataview',
      'TASK FROM "Books" WHERE !completed GROUP BY file.name',
      '```',
      '',
      '```dataview',
      'TABLE WITHOUT ID file.link AS "Day", mood FROM "Calendar" WHERE regexmatch("\\d{4}-\\d{2}-\\d{2}", file.name) SORT file.name ASC',
      '```',
      '',
      '```dataview',
      'TABLE length(rows) AS "N", sum(rows.rating) AS "Sum" FROM "Books" GROUP BY default(author, "none")',
      '```',
      '',
      '```dataview',
      'CALENDAR file.day FROM "life/Calendar"',
      '```',
      '',
      '```dataview',
      'LIST FROM [[Emma]] WHERE regexmatch("^Du", file.name) OR regexmatch("\\d{4}-\\d{2}-\\d{2}", file.name)',
      '```',
      '',
      '```dataview',
      'TABLE nothing FROM',
      '```',
      '',
      '```dataviewjs',
      'const books = dv.pages(\'"Books"\').where(p => p.author)',
      'dv.header(3, "Books: " + books.length)',
      'dv.table(["Name", "Pages"], books.sort(p => p.pages, "desc").map(p => [p.file.link, p.pages]))',
      'dv.paragraph("names=" + books.file.name.join("+"))',
      '```',
      '',
      'Name is `= this.file.name` and sum is `= 2 + 3 * 2`, js `$= dv.pages(\'#book\').length`.',
      '',
      'end',
      '',
    ].join('\n'),
  },
}

export async function run(t) {
  const { page, ok, wait, read, leaf } = t
  await t.open('Q')
  await wait(800)
  const blocks = page.locator(`${leaf} .dv-block`)
  ok('every query is drawn', (await blocks.count()) === 9, await blocks.count())
  const text = async (n) => t.flat(blocks.nth(n))

  let s = await text(0)
  ok('table: headers with names from AS and the expression', s.includes('Файл') && s.includes('Автор') && s.includes('rating') && s.includes('Next'), s)
  ok('table: filter, sort and fields written in the text', /Dune Herbert 5 613 Emma Austen 4 475/.test(s) && !s.includes('Draft'), s)
  ok('table: row count next to the first header', /Файл\s*2/.test(s), s)

  s = await text(1)
  ok('list: source by tag with an exclusion, value after the link', s === 'Emma: ★★★★', s)

  s = await text(2)
  ok('task: open tasks grouped by note, with subtasks', /Dune\s*2 .*Reread Dune.*Take notes.*Emma\s*1 .*Finish Emma/.test(s) && !s.includes('Buy Dune') && !s.includes('not a task'), s)
  ok('task: subtask is nested under its task', (await blocks.nth(2).locator('.dv-tasks .dv-tasks .dv-task').count()) === 1)

  s = await text(3)
  ok('folder moved deeper is found by name; regexmatch needs no doubled backslashes', s.includes('Day') && new RegExp(`2026-01-05 3 ${today} 7`).test(s), s)

  s = await text(4)
  ok('group by: rows of a group and totals over them', /Группа\s*3 N Sum Austen 1 4 Herbert 1 5 none 1 2/.test(s), s)

  ok('calendar: a dot on the day that has a note', (await blocks.nth(5).locator('.dv-calendar-day.today .dv-calendar-dot').count()) === 1)
  await blocks.nth(5).locator('.dv-calendar-head button').first().click()
  ok('calendar: months can be turned', (await blocks.nth(5).locator('.dv-calendar-day.today').count()) === 0)

  s = await text(6)
  ok('list: notes that link to a note, links in fields included', s.includes('Dune') && s.includes(today) && !s.includes('Draft'), s)

  s = await text(7)
  ok('a mistake in a query is explained in its place', (await blocks.nth(7).locator('.dv-error').count()) === 1 && s.includes('FROM'), s)

  s = await text(8)
  ok('script: dv.pages, header, table and field of a list', s.includes('Books: 2') && /Name\s*2 Pages Dune 612 Emma 474/.test(s) && s.includes('names=Dune+Emma'), s)

  s = (await t.text()).replace(/\s+/g, ' ')
  ok('inline values in the text', s.includes('Name is Q and sum is 8, js 2.'), s.slice(-200))

  // Ticking a task writes to its note, and the list follows.
  await blocks.nth(2).locator('.dv-task', { hasText: 'Finish Emma' }).locator('input').check()
  await wait(1500)
  ok('ticking a task marks it in its note', read('Books/Emma.md').includes('- [x] Finish Emma'), read('Books/Emma.md'))
  s = await text(2)
  ok('the task list follows the change', !s.includes('Finish Emma') && s.includes('Reread Dune'), s)

  // A new note that matches appears without reopening anything.
  t.write('Books/Ubik.md', '---\nauthor: Dick\nrating: 5\n---\npages:: 202\n')
  await wait(3000)
  s = await text(0)
  ok('results follow the vault', s.includes('Ubik Dick 5 203'), s)

  // A link in a result opens its note in place of the current one; with Ctrl, in a new tab.
  await blocks.nth(0).locator('a', { hasText: 'Dune' }).click()
  await wait(600)
  ok('a link opens in the current tab', (await t.count('.tab')) === 1 && (await t.activeTab()) === 'Dune', await t.activeTab())
  await page.goBack()
  await wait(600)
  ok('Back returns to the note before', (await t.activeTab()) === 'Q' && (await t.count('.tab')) === 1, await t.activeTab())
  await t.row('Books').click()
  await t.row('Emma').click({ modifiers: ['Control'] })
  await wait(600)
  ok('Ctrl+click opens a new tab', (await t.count('.tab')) === 2 && (await t.activeTab()) === 'Emma', await t.count('.tab'))
  // Ctrl+click on a link whose source is showing (the cursor is in it) follows it too.
  await t.tab('Q').click()
  await wait(300)
  await page.evaluate(() => {
    const editor = app.workspace.activeEditor
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: '\nsee [[Dune]] here' } })
    editor.dispatch({ selection: { anchor: editor.state.doc.length - 8 } })
    editor.focus()
  })
  await wait(400)
  await page.locator(`${leaf} .lp-wikilink-source`).click({ modifiers: ['Control'] })
  await wait(600)
  ok('Ctrl+click follows a link shown as written, into a new tab', (await t.count('.tab')) === 3 && (await t.activeTab()) === 'Dune', `${await t.count('.tab')} ${await t.activeTab()}`)

  // Ctrl+wheel changes the size of the note's text, not the zoom of the page.
  const size = () => page.evaluate(() => getComputedStyle(document.querySelector('.leaf:not([hidden]) .cm-editor')).fontSize)
  const before = await size()
  await page.mouse.move(600, 400)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await wait(400)
  ok('Ctrl+wheel makes the text bigger', parseFloat(await size()) === parseFloat(before) + 1 && (await page.evaluate(() => window.devicePixelRatio)) === 1, `${before} -> ${await size()}`)
}
