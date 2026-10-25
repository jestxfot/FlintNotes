// The place of new notes, whichever way they are made: Alt+N, a link, the quick switcher, the file list, a template, a base.
import { day } from '../helpers.mjs'

export const vault = {
  plugins: ['new-note-place', 'links', 'quick-switcher', 'templates', 'bases'],
  settings: { 'new-note-place': { all: 'source' }, templates: { folder: 'Templates', ask: false, onCreate: false } },
  files: {
    'Projects/Alpha/Plan.md': 'Plan with [[Fresh link]] and [[Explicit/Named]] and [[Another one]].\n\nend\n',
    'Diary/Today.md': 'Today with [[Diary idea]].\n\nend\n',
    'Root.md': 'Root with [[Rooted link]].\n\nend\n',
    'Templates/Plain.md': 'From a template\n',
    'Tasks.base': 'filters:\n  and:\n    - file.folder == "Projects"\nviews:\n  - type: table\n    name: T\n',
    'Projects/Existing.md': 'x\n',
  },
}

const folders = (t) => t.page.evaluate(() => app.vault.files().map((file) => file.path))

export async function run(t) {
  const { page, ok, wait, exists } = t
  const set = (key, value) => page.evaluate(([k, v]) => app.settings.set('new-note-place', k, v), [key, value])
  const PATHS = { Plan: 'Projects/Alpha/Plan.md', Today: 'Diary/Today.md', 'Diary/Today': 'Diary/Today.md', Root: 'Root.md' }
  // The notes lie in folders that are shut in the list: opened by their path.
  const open = async (note) => {
    await page.evaluate((path) => app.workspace.openFile(path), PATHS[note] ?? note)
    await wait(600)
  }
  const click = async (note, text) => {
    await open(note)
    await t.cursorToEnd()
    await wait(500)
    await page.locator(`${t.leaf} .lp-wikilink`, { hasText: text }).click()
    await wait(900)
  }

  // ---- a click on a link: beside the note with the link
  await click('Plan', 'Fresh link')
  ok('a link makes its note beside the note with the link', exists('Projects/Alpha/Fresh link.md'), (await folders(t)).join(', '))
  await click('Plan', 'Explicit/Named')
  ok('a folder written in the link is the user\'s word, and stays', exists('Explicit/Named.md') && !exists('Projects/Alpha/Named.md'), (await folders(t)).join(', '))
  await set('keepExplicit', false)
  await click('Plan', 'Another one')
  ok('unless the settings say otherwise', exists('Projects/Alpha/Another one.md'))
  await set('keepExplicit', true)

  // ---- the places: root, a folder with a date, a subfolder, the main settings
  await set('link', 'root')
  await click('Root', 'Rooted link')
  ok('the root, if that is chosen for links', exists('Rooted link.md'))
  await set('link', 'folder')
  await set('folder', 'Входящие/{{date:YYYY}}/{{source}}')
  await click('Diary/Today', 'Diary idea')
  ok('a named folder, with the date and the note\'s name written in', exists(`Входящие/${new Date().getFullYear()}/Today/Diary idea.md`), (await folders(t)).join(', '))

  // ---- Alt+N follows its own choice, or the common one
  await set('link', 'all')
  await open('Plan')
  await page.keyboard.press('Alt+n')
  await wait(900)
  ok('Alt+N makes the new note beside the open one', exists('Projects/Alpha/Без названия.md'), (await folders(t)).join(', '))
  await set('new', 'sub')
  await set('subfolder', 'Новые')
  await open('Plan')
  await page.keyboard.press('Alt+n')
  await wait(900)
  ok('or in a subfolder next to it', exists('Projects/Alpha/Новые/Без названия.md'), (await folders(t)).join(', '))
  await set('new', 'rules')
  await set('rules', 'Diary → Diary/Идеи\n* → Входящие/Прочее\nProjects → Projects/Входящие')
  await open('Today')
  await page.keyboard.press('Alt+n')
  await wait(900)
  ok('by a rule for the folder of the open note', exists('Diary/Идеи/Без названия.md'), (await folders(t)).join(', '))
  await open('Plan')
  await page.keyboard.press('Alt+n')
  await wait(900)
  ok('the deepest rule that fits wins', exists('Projects/Входящие/Без названия.md'), (await folders(t)).join(', '))
  await set('new', 'core')
  await page.evaluate(() => app.settings.set('core', 'newNoteLocation', 'root'))
  await open('Plan')
  await page.keyboard.press('Alt+n')
  await wait(900)
  ok('or as the main settings say', exists('Без названия.md'), (await folders(t)).join(', '))
  await set('new', 'keep')
  await page.evaluate(() => app.settings.set('core', 'newNoteLocation', 'folder'))
  await page.evaluate(() => app.settings.set('core', 'newNoteFolder', 'Core place'))
  await open('Plan')
  await page.keyboard.press('Alt+n')
  await wait(900)
  ok('or untouched, as without the plugin', exists('Core place/Без названия.md'), (await folders(t)).join(', '))
  await page.evaluate(() => app.settings.set('core', 'newNoteLocation', 'root'))
  await set('new', 'all')

  // ---- asking: the places the settings name, then every folder, then a new one
  await set('all', 'ask')
  await open('Plan')
  await page.keyboard.press('Alt+n')
  const dialog = page.locator('dialog:has(input[placeholder^="Куда положить"])')
  await dialog.waitFor({ timeout: 5000 }).catch(() => {})
  ok('it asks where, offering the folder of the open note first', (await dialog.count()) === 1 && (await t.flat(dialog.locator('[role=option]').first())).includes('Projects/Alpha'), await t.flat(dialog).catch(() => 'none'))
  await dialog.locator('input').fill('Diary')
  await wait(300)
  await dialog.locator('[role=option]', { hasText: 'Diary' }).first().click()
  await wait(900)
  ok('and puts the note where the answer says', (await folders(t)).filter((path) => /^Diary\/Без названия/.test(path)).length === 1, (await folders(t)).join(', '))
  await page.keyboard.press('Alt+n')
  await dialog.waitFor({ timeout: 5000 }).catch(() => {})
  await dialog.locator('input').fill('Совсем/Новая папка')
  await wait(300)
  await page.keyboard.press('Enter')
  await wait(900)
  ok('a name that no folder has makes a new folder', exists('Совсем/Новая папка/Без названия.md'), (await folders(t)).join(', '))
  const before = (await folders(t)).length
  await page.keyboard.press('Alt+n')
  await dialog.waitFor({ timeout: 5000 }).catch(() => {})
  await page.keyboard.press('Escape')
  await wait(700)
  ok('closing the question makes no note', (await folders(t)).length === before && (await dialog.count()) === 0)

  // ---- the other ways
  await set('all', 'rules')
  await set('rules', '* → Куда-то')
  await page.evaluate(() => app.commands.run('quick-switcher:open'))
  await wait(300)
  await page.locator('dialog input').fill('Из переключателя')
  await wait(300)
  await page.keyboard.press('Enter')
  await wait(900)
  ok('the quick switcher follows the choice too', exists('Куда-то/Из переключателя.md'), (await folders(t)).join(', '))
  await open('Projects/Existing.md')
  await page.evaluate(() => app.commands.run('templates:create'))
  await wait(500)
  await page.locator('dialog [role=option]', { hasText: 'Plain' }).first().click()
  await wait(1000)
  ok('a note from a template, too', (await folders(t)).some((path) => /^Куда-то\/Без названия/.test(path)), (await folders(t)).join(', '))
  await t.row('Projects').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Новая заметка' }).click()
  await wait(900)
  ok('the file list keeps the folder that was clicked', (await folders(t)).some((path) => /^Projects\/Без названия/.test(path)), (await folders(t)).join(', '))
  await set('keepExplicit', false)
  await t.row('Projects').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Новая заметка' }).click()
  await wait(900)
  ok('unless it is asked to follow the choice', (await folders(t)).filter((path) => /^Куда-то\/Без названия/.test(path)).length >= 2, (await folders(t)).join(', '))
  await set('keepExplicit', true)
  ok('nothing changes with the plugin off', await page.evaluate(async () => {
    await app.plugins.disable('new-note-place')
    return app.creation.locate === null
  }))
}
