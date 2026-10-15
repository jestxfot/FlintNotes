// Buttons of the user's own for any command, anywhere in the frame; macros; every action is a command.
const cmdr = {
  leftRibbon: [
    { id: 'daily-notes', icon: 'lucide-calendar-days', name: 'Daily', mode: 'any', color: '#62b8f9' },
    { id: 'omnisearch:show-modal-infile', icon: 'lucide-search', name: 'Unknown here', mode: 'any' },
    { id: 'graph:open', icon: 'lucide-git-fork', name: 'Graph', mode: 'any' },
  ],
  pageHeader: [{ id: 'webviewer:open', icon: 'lucide-search', name: 'Web', mode: 'any' }],
  fileMenu: [
    { id: 'open-with-default-app:show', icon: 'lucide-files', name: 'Show in system explorer', mode: 'any' },
    { id: 'graph:open', icon: 'lucide-git-fork', name: 'Graph from the menu', mode: 'any' },
  ],
  macros: [],
}
export const viewport = { width: 1400, height: 900 }
export const vault = {
  plugins: ['commander', 'graph', 'calendar', 'word-count', 'buttons', 'widgets', 'tasks'],
  settings: { calendar: { openOnStart: false }, tasks: { remindDue: false } },
  files: {
    '.obsidian/app.json': '{}',
    '.obsidian/plugins/cmdr/data.json': JSON.stringify(cmdr),
    'Note.md': '# Note\n\n- [ ] a task\n\nend\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read, leaf } = t
  await t.open('Note')
  await wait(800)

  // ---- taken over from Obsidian's Commander
  const ribbon = page.locator('.toolbar[data-place="left-ribbon"]')
  ok('buttons of Commander appear, those of unknown commands are left out', (await ribbon.locator('button').count()) === 2 && (await ribbon.locator('button').first().getAttribute('title')) === 'Daily', await ribbon.locator('button').count())
  ok('a button keeps its colour and icon', (await ribbon.locator('button').first().evaluate((b) => b.style.color)) === 'rgb(98, 184, 249)' && (await ribbon.locator('button svg').count()) === 2)
  const saved = () => JSON.parse(read('.flint/commander.json'))
  ok("the setup is stored in Commander's format with this app's command ids", saved().leftRibbon.map((p) => p.id).join() === 'calendar:today,graph:open' && saved().pageHeader[0].id === 'buttons:web-viewer' && saved().fileMenu.map((p) => p.id).join() === 'graph:open', JSON.stringify(saved()))
  await ribbon.locator('button[title="Graph"]').click()
  await wait(600)
  // The button is the tab of the view it opens: the graph is on screen, and the strip of tabs has no tab for it.
  ok('a button runs its command, and is itself the tab of the view it opens', (await t.count(`${t.leaf} .graph-view`)) === 1 && (await t.tab('Граф').count()) === 0 && (await ribbon.locator('button[title="Graph"]').getAttribute('class')).includes('on'), `${await t.tab('Граф').count()} tabs`)
  await ribbon.locator('button[title="Graph"]').click()
  await wait(300)
  ok('a second click on it goes back to the note', (await t.activeTab()) === 'Note' && (await t.count(`${t.leaf} .graph-view`)) === 0)
  await t.tab('Note').click()

  // ---- a button for any command, put anywhere
  await ribbon.click({ button: 'right', position: { x: 20, y: 300 } })
  await page.locator('.menu button', { hasText: 'Добавить команду…' }).click()
  const palette = page.locator('dialog input')
  await palette.fill('Вставить виджет: часы')
  await wait(400)
  await page.keyboard.press('Enter')
  await wait(400)
  const picker = page.locator('.iconic-dialog')
  await picker.locator('.iconic-search').fill('alarm-clock')
  await wait(500)
  await picker.locator('.iconic-icon').first().click()
  await picker.locator('.iconic-color[title="green"]').click()
  await picker.locator('button', { hasText: 'Готово' }).click()
  await wait(800)
  ok('any command can be put on a strip', (await ribbon.locator('button').count()) === 3 && saved().leftRibbon[2].id === 'widgets:insert-clock' && saved().leftRibbon[2].color === 'green', JSON.stringify(saved().leftRibbon))
  await t.cursorToEnd()
  await ribbon.locator('button').nth(2).click()
  await wait(1000)
  ok('and the new button works on the open note', read('Note.md').includes('```widgets\ntype: clock'), read('Note.md'))

  await page.evaluate(() => app.commands.run('commander:add-titleBar'))
  await wait(400)
  await palette.fill('Переключить светлую и тёмную тему')
  await wait(400)
  await page.keyboard.press('Enter')
  await wait(400)
  await picker.locator('button', { hasText: 'Готово' }).click()
  await wait(800)
  const bar = page.locator('.tabbar .toolbar[data-place="tab-bar"] button')
  ok('a button in the tab strip', (await bar.count()) === 1)
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await bar.click()
  await wait(300)
  ok('a core action is a command too', (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== before)

  // ---- its menu: move and remove
  await ribbon.locator('button').nth(2).click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Сдвинуть к началу' }).click()
  await wait(600)
  ok('a button can be moved', saved().leftRibbon.map((p) => p.id).join() === 'calendar:today,widgets:insert-clock,graph:open')
  await ribbon.locator('button').nth(1).click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Убрать кнопку' }).click()
  await wait(600)
  ok('and removed', (await ribbon.locator('button').count()) === 2 && saved().leftRibbon.length === 2)

  // ---- items in the file menu
  await t.row('Note').click({ button: 'right' })
  ok('a command of the user in the file menu', (await page.locator('.menu button', { hasText: 'Graph from the menu' }).count()) === 1)
  ok('what the menu already offers is not added a second time', (await page.locator('.menu button', { hasText: /explorer|проводник/i }).count()) === 1)
  await page.keyboard.press('Escape')
  await page.mouse.click(700, 500)

  // ---- a button hides with its plugin and returns with it
  await page.evaluate(() => app.commands.run('core:toggle-plugin:graph'))
  await wait(600)
  ok('the button of a plugin that is switched off is hidden', (await ribbon.locator('button').count()) === 1)
  await page.evaluate(() => app.commands.run('core:toggle-plugin:graph'))
  await wait(1200)
  // Switched on again, the plugin also puts its own main button on the strip, next to the user's.
  ok('and comes back with the plugin', (await ribbon.locator('button').count()) === 3 && saved().leftRibbon.length === 2 && (await ribbon.locator('button[title="Граф связей"]').count()) === 1, String(await ribbon.locator('button').count()))

  // ---- macros
  await page.evaluate(() => app.commands.run('commander:new-macro'))
  await palette.fill('Отметить задачу в строке с курсором')
  await wait(400)
  await page.keyboard.press('Enter')
  await wait(400)
  await wait(600)
  ok('a macro is a command of its own', (await page.evaluate(() => !!app.commands.get('commander:macro-0'))) && saved().macros[0].macro[0].commandId === 'tasks:toggle-done')
  await page.evaluate(() => {
    const editor = app.workspace.activeEditor
    const at = editor.state.doc.toString().indexOf('a task')
    editor.dispatch({ selection: { anchor: at } })
    app.commands.run('commander:macro-0')
  })
  await wait(1200)
  ok('running the macro runs its commands', read('Note.md').includes('- [x] a task'), read('Note.md'))

  // ---- the settings page lists every place
  await page.keyboard.press('Control+Comma')
  await page.locator('nav button.sub', { hasText: 'Быстрые кнопки и команды' }).click()
  const places = page.locator('.commander-place')
  ok('the settings page shows all places and the macros', (await places.count()) === 9 && (await page.locator('.commander-place[data-place="leftRibbon"] .commander-row').count()) === 2, await places.count())
  await page.keyboard.press('Escape')

  // ---- the rule: every panel and every plugin has commands
  const ids = await page.evaluate(() => app.commands.list().map((c) => c.id))
  const need = ['calendar:show-calendar', 'tasks:show-tasks', 'core:toggle-plugin:word-count', 'core:go-back', 'core:next-tab', 'core:reveal-active', 'core:font-bigger', 'buttons:insert', 'widgets:insert-quote', 'tasks:insert-calendar', 'graph:open']
  ok('panels, plugins and frame actions are all commands', need.every((id) => ids.includes(id)), need.filter((id) => !ids.includes(id)).join())
}
