// Folder notes after the Obsidian plugin; the "⋮" menu of a note, made of commands; floating sidebars; groups in the graph.
const fnData = { folderNoteName: '{{folder_name}}', storageLocation: 'insideFolder', hideFolderNote: true, underlineFolder: true, boldName: true, openByClick: true, enableCollapsing: false, syncFolderName: true, ctrlKey: true, excludeFolders: [{ type: 'folder', path: 'Skip' }] }
export const viewport = { width: 1400, height: 900 }
export const vault = {
  plugins: ['folder-notes', 'graph', 'templates', 'links'],
  settings: { templates: { folder: 'Templates', onCreate: false } },
  files: {
    '.obsidian/app.json': '{}',
    '.obsidian/plugins/folder-notes/data.json': JSON.stringify(fnData),
    'Projects/Projects.md': '# Projects hub\n\n```folder-overview\nshowTitle: true\ntitle: "{{folderName}} inside"\ndepth: 2\nincludeTypes:\n  - folder\n  - markdown\n```\n\nend\n',
    'Projects/Alpha.md': 'alpha [[Beta]]\n',
    'Projects/Beta.md': 'beta [[Alpha]]\n',
    'Projects/Sub/Deep.md': 'deep\n',
    'Empty/keep.md': 'x\n',
    'Skip/Skip.md': 'not a folder note here\n',
    'Lone.md': 'lone [[Other]]\n',
    'Other.md': 'other [[Lone]]\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  const leaf = t.leaf

  // ---- folder notes
  await page.waitForFunction(() => app.settings.get('folder-notes', 'imported') === true, null, { timeout: 15000 }).catch(() => {})
  await wait(500)
  ok('settings come from the Folder notes plugin', await page.evaluate(() => app.settings.get('folder-notes', 'boldName') === true && app.settings.get('folder-notes', 'excludeFolders') === 'Skip'), await page.evaluate(() => JSON.stringify([app.settings.get('folder-notes', 'boldName'), app.settings.get('folder-notes', 'excludeFolders')])))
  ok('a folder with a note is marked', (await t.row('Projects').getAttribute('class')).includes('fn-underline') && (await t.row('Projects').getAttribute('class')).includes('fn-bold') && !(await t.row('Empty').getAttribute('class')).includes('fn-'))
  await t.row('Projects').locator('.name').click()
  await page.waitForSelector(`${leaf} .cm-content`)
  await wait(800)
  ok('a click on the folder opens its note and leaves the folder closed', (await t.activeTab()) === 'Projects' && (await t.row('Projects').getAttribute('aria-expanded')) === 'false')
  await t.row('Projects').locator('.chevron').click()
  await wait(300)
  ok('the arrow opens the folder, and its note is not listed', (await t.row('Projects').getAttribute('aria-expanded')) === 'true' && (await t.count('.tree .row')) > 0 && (await t.row('Alpha').count()) === 1 && (await page.locator('.tree .row .name', { hasText: /^Projects$/ }).count()) === 1)
  const overview = page.locator(`${leaf} .folder-overview`)
  ok('folder-overview lists the folder', (await t.flat(overview)).includes('Projects inside') && (await t.flat(overview)).includes('Alpha') && (await t.flat(overview)).includes('Deep') && !(await t.flat(overview)).includes('Projects.md'), await t.flat(overview).catch(() => 'no overview'))
  await t.row('Skip').locator('.chevron').click()
  await wait(300)
  ok('an excluded folder keeps its files as they are', (await page.locator('.tree .row .name', { hasText: /^Skip$/ }).count()) === 2)

  await t.row('Empty').locator('.name').click({ modifiers: ['Control'] })
  await wait(1500)
  ok('Ctrl+click on a folder without a note creates it', t.exists('Empty/Empty.md') && (await t.activeTab()) === 'Empty')
  await t.row('Empty').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Переименовать' }).click()
  await page.keyboard.type('Full')
  await page.keyboard.press('Enter')
  await wait(1800)
  ok('renaming the folder renames its note', t.exists('Full/Full.md') && !t.exists('Full/Empty.md'))
  await t.row('Lone').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Сделать заметкой папки' }).click()
  await wait(1800)
  ok('a note can become the note of a new folder', t.exists('Lone/Lone.md') && !t.exists('Lone.md'))

  // ---- the path above the note
  await t.row('Alpha').click()
  await wait(800)
  const crumb = page.locator('.view-header .crumb', { hasText: 'Projects' })
  ok('a folder in the path is marked too', (await crumb.getAttribute('class')).includes('fn-has-note'))
  await crumb.click()
  await wait(800)
  ok('and a click on it opens the folder note', (await t.activeTab()) === 'Projects')

  // ---- the "⋮" menu of a note is made of commands and of what plugins add
  await t.row('Alpha').click()
  await wait(600)
  await page.locator('.view-header .note-menu').click()
  await wait(300)
  let menu = await t.flat(page.locator('.menu').first())
  ok('the note menu lists the commands that act on a note', ['Переименовать открытую заметку', 'Удалить открытый файл', 'Вставить', 'Создать или открыть заметку папки', 'Вставить шаблон'].every((title) => menu.includes(title)), menu)
  await page.locator('.menu button', { hasText: /^\s*Вставить\s*›?\s*$/ }).hover()
  await wait(300)
  ok('what can be inserted is one list', (await t.flat(page.locator('.menu').nth(1))).includes('Обзор папки'), await t.flat(page.locator('.menu').nth(1)).catch(() => 'no submenu'))
  await page.locator('.menu').nth(1).locator('button', { hasText: 'Обзор папки' }).click()
  await wait(900)
  ok('choosing one runs its command on the note', (await page.evaluate(() => app.workspace.activeEditor.state.doc.toString())).includes('```folder-overview'))

  // ---- floating sidebars
  const width = () => page.locator('main').evaluate((el) => el.getBoundingClientRect().width)
  const docked = await width()
  await page.evaluate(() => app.settings.set('core', 'floatingSidebars', true))
  await wait(500)
  ok('floating sidebars leave the whole width to the note', (await t.count('aside')) === 0 && (await width()) > docked + 150, `${docked} -> ${await width()}`)
  await page.mouse.move(700, 400)
  await page.mouse.move(2, 400)
  await wait(500)
  ok('the pointer at the left edge brings the sidebar out over the note', (await t.count('aside.left.floating')) === 1 && (await width()) > docked + 150 && (await t.row('Projects').count()) === 1)
  await page.mouse.move(800, 400)
  await wait(800)
  ok('and it leaves with the pointer', (await t.count('aside')) === 0, await page.evaluate(() => JSON.stringify({ menu: !!document.querySelector('.menu'), dialog: !!document.querySelector('dialog[open]'), focus: document.querySelector('aside :focus')?.outerHTML.slice(0, 120), hover: [...document.querySelectorAll(':hover')].map((e) => e.tagName + '.' + e.className).slice(-3) })))
  await page.evaluate(() => app.settings.set('core', 'floatingSidebars', false))
  await wait(400)
  ok('switched off, the sidebar is back in its place', (await t.count('aside.left:not(.floating)')) === 1)

  // ---- the graph finds groups
  await page.evaluate(() => app.commands.run('graph:open'))
  await page.waitForSelector(`${leaf} .graph-view canvas`, { timeout: 15000 })
  await wait(2500)
  const groups = await page.evaluate(() => {
    const view = app.workspace.active.view.graph ?? app.workspace.active.view
    const nodes = view.nodes ?? view.graph?.nodes
    if (!nodes) return null
    const of = (name) => nodes.find((n) => n.label === name)?.cluster
    return { alpha: of('Alpha'), beta: of('Beta'), other: of('Other'), lone: of('Lone') }
  })
  ok('notes that link to one another are one group, apart from the others', !!groups && groups.alpha === groups.beta && groups.other === groups.lone && groups.alpha !== groups.other, JSON.stringify(groups))
}
