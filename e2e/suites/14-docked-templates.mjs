// A note tab dragged into a sidebar becomes a widget; template code in the editor; dynamic template commands.
export const viewport = { width: 1400, height: 1000 }
export const vault = {
  plugins: ['templates', 'outline', 'tasks'],
  settings: { tasks: { remindDue: false }, templates: { folder: 'Templates', onCreate: false } },
  files: {
    'Side.md': '# Side note\n\n- [ ] in the sidebar\n',
    'Main.md': '# Main\n\nYear is <%+ tp.date.now("YYYY") %> and title is <%+ tp.file.title %>.\n\nPlain <% 1 * 2 * 3 %> here.\n\nend\n',
    'Templates/Note.md': '<%*\nconst stars = 2 * 3\n    let indented = `a*b*c`\n-%>\n# <% tp.file.title %>\n\nDynamic <%+ tp.file.title %> stays code here.\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read, leaf } = t
  await t.open('Main')
  await wait(600)
  let s = (await t.text()).replace(/\s+/g, ' ')
  ok('dynamic commands show their values', s.includes(`Year is ${new Date().getFullYear()} and title is Main.`), s)
  ok('an ordinary command stays as code, set apart from the text', (await t.count(`${leaf} .lp-template`)) === 1 && s.includes('Plain <% 1 * 2 * 3 %> here.'), s)
  ok('stars inside a command are not italics', (await t.count(`${leaf} .cm-content em, ${leaf} .lp-em`)) === 0)

  await t.row('Templates').click()
  await t.open('Note')
  await wait(600)
  ok('a code block of a template is one element', (await t.count(`${leaf} .lp-template-line`)) === 4, await t.count(`${leaf} .lp-template-line`))
  ok('an indented line in it is not a Markdown code block', (await t.count(`${leaf} .lp-code`)) === 0)
  s = (await t.text()).replace(/\s+/g, ' ')
  ok('in a template, a dynamic command is left as written', s.includes('Dynamic <%+ tp.file.title %> stays code here.'), s)
  const colours = await page.evaluate(() => new Set([...document.querySelectorAll('.leaf:not([hidden]) .lp-template-line span')].map((span) => getComputedStyle(span).color)).size)
  ok('template code is highlighted as JavaScript', colours >= 3, colours)

  // ---- a tab dragged into a sidebar
  await t.open('Side')
  await wait(400)
  const tabs = await t.count('.tab')
  const right = page.locator('aside.right')
  await t.tab('Side').dragTo(right.locator('.panel:not([hidden])').first())
  await wait(1200)
  ok('the tab leaves the tab bar', (await t.count('.tab')) === tabs - 1 && (await t.tab('Side').count()) === 0, await t.count('.tab'))
  const docked = right.locator('.docked-body')
  ok('the note is shown in the sidebar', (await docked.count()) === 1 && (await t.flat(right.locator('.panel:not([hidden])').first())).includes('Side note'), await docked.count())
  ok('it has a tab among the widgets', (await page.locator('.widget-tab[title="Side"]').count()) === 1)

  await docked.locator('input[type=checkbox]').check()
  await wait(1500)
  ok('the docked note is editable and saves', read('Side.md').includes('- [x] in the sidebar'), read('Side.md'))

  await t.row('Side').click()
  await wait(500)
  ok('opening a docked note shows its widget instead of a second editor', (await t.tab('Side').count()) === 0 && (await docked.isVisible()))

  await page.reload()
  await page.waitForSelector('.tree .row')
  await wait(1500)
  ok('docked notes come back after a reload', (await page.locator('aside.right .docked-body').count()) === 1 && (await t.flat(page.locator('aside.right .docked-body'))).includes('Side note'))

  await page.locator('aside.right .docked-head button[title="Открыть во вкладке"]').click()
  await wait(800)
  ok('"open in a tab" moves it back', (await t.tab('Side').count()) === 1 && (await t.count('.docked-body')) === 0 && (await page.locator('.widget-tab[title="Side"]').count()) === 0)
  await page.reload()
  await page.waitForSelector('.tree .row')
  await wait(1200)
  ok('and it stays undocked', (await t.count('.docked-body')) === 0)

  // ---- a new note asks which template to use
  await page.evaluate(() => app.settings.set('templates', 'onCreate', true))
  await page.evaluate(() => app.commands.run('core:new-note'))
  const chooser = page.locator('dialog:has(input[placeholder^="Шаблон для"])')
  await chooser.waitFor()
  ok('a new note opens the list of templates', (await t.flat(chooser)).includes('Note') && (await t.flat(chooser)).includes('Без шаблона'), await t.flat(chooser))
  ok('and there is no note yet while the choice is open', !t.exists('Без названия.md'))
  await page.keyboard.press('Enter')
  await wait(1500)
  ok('the chosen template fills the note', read('Без названия.md').startsWith('# Без названия') && (await t.activeTab()) === 'Без названия', read('Без названия.md'))
  const tabsBefore = await t.count('.tab')
  await page.evaluate(() => app.commands.run('core:new-note'))
  await chooser.waitFor()
  await page.keyboard.press('Escape')
  await wait(800)
  ok('Esc creates no note at all', !t.exists('Без названия 1.md') && (await t.count('.tab')) === tabsBefore, await t.count('.tab'))
  // A template that fails, or whose question is left unanswered, leaves nothing behind either.
  t.write('Templates/Broken.md', '<%* throw new Error("нет названия") %>\n')
  t.write('Templates/Asks.md', '<%* const name = await tp.system.prompt("Название", "", true) %># <% name %>\n')
  await wait(1500)
  const choose = async (name) => {
    await page.evaluate(() => app.commands.run('core:new-note'))
    await chooser.waitFor()
    await chooser.locator('input').fill(name)
    await wait(200)
    await page.keyboard.press('Enter')
    await wait(900)
  }
  await choose('Broken')
  ok('a template that fails creates no note and says why', !t.exists('Без названия 1.md') && (await page.locator('.notice').allInnerTexts()).join(' ').includes('Заметка не создана'), (await page.locator('.notice').allInnerTexts()).join(' | '))
  await choose('Asks')
  ok('the template asks before there is a note', (await t.count('dialog[open] input')) > 0 && !t.exists('Без названия 1.md'))
  await page.keyboard.press('Escape')
  await wait(900)
  ok('an unanswered question creates no note', !t.exists('Без названия 1.md'))
  await choose('Asks')
  await page.keyboard.type('Answered')
  await page.keyboard.press('Enter')
  await wait(1500)
  ok('answered, the note is created filled in', t.exists('Без названия 1.md') && read('Без названия 1.md').startsWith('# Answered'), t.exists('Без названия 1.md') ? read('Без названия 1.md') : 'no file')
  ok('templates see Obsidian\'s app while they run, and the page gets its own back', await page.evaluate(() => typeof app.vault.getMarkdownFiles !== 'function' && !!app.workspace.leaves))
}
