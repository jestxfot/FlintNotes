// Templates (Templater syntax, {{date}} variables, rules per folder), the calendar widget with
// periodic notes, settings taken over from Obsidian, movable widgets, task queries with functions.
// The vault is laid out like a real Obsidian one: config in a dot-folder, templates and daily notes in subfolders.
import { day } from '../helpers.mjs'

const today = day()
const month = today.slice(0, 7)
const obsidian = (file, data) => [`.obsidianmain/${file}`, JSON.stringify(data)]

const NOTE = `<%*
// The hub of a folder: the nearest note up the tree named like its folder.
let dir = tp.file.folder(true), hub = "Home";
while (dir && dir !== "/") {
  const cut = dir.lastIndexOf("/"), name = dir.slice(cut + 1), up = cut > 0 ? dir.slice(0, cut) : "";
  if (app.vault.getAbstractFileByPath(\`\${dir}/\${name}.md\`)) { hub = name; break }
  dir = up;
}
-%>
---
date: <% tp.date.now("YYYY-MM-DD") %>
link:
  - "[[<% hub %>]]"
---

<% tp.file.cursor() %>
`

const BOARD = `\`\`\`tasks
not done
filter by function \\
    !/(^|\\/)(Calendar|template)\\//.test(task.file.path) \\
    && (/^(?:life\\/)?(?:ToDo|Notes)\\//.test(task.file.folder) || task.file.tags.includes("#todo"))
group by function \\
    const d = task.due.moment; \\
    if (!d) return '%%4%% Без даты'; \\
    const diff = d.clone().startOf('day').diff(window.moment().startOf('day'), 'days'); \\
    if (diff < 0)   return '%%0%% Просрочено'; \\
    if (diff === 0) return '%%1%% Сегодня'; \\
    return '%%3%% Дальше';
sort by due
hide postpone button
hide toolbar
\`\`\`

end
`

export const viewport = { width: 1400, height: 1000 }
export const vault = {
  plugins: ['templates', 'calendar', 'tasks', 'bases', 'links'],
  // Reminders would cover the screen; they have a suite of their own.
  settings: { tasks: { remindDue: false } },
  files: Object.fromEntries([
    obsidian('app.json', { openBehavior: 'daily' }),
    obsidian('workspace.json', {}),
    obsidian('daily-notes.json', { format: 'YYYY-MM/YYYY-MM-DD', folder: 'life/Calendar', template: 'life/template/Daily.md' }),
    obsidian('templates.json', { folder: 'life/template' }),
    obsidian('plugins/templater-obsidian/data.json', {
      templates_folder: 'life/template',
      trigger_on_file_creation: true,
      trigger_on_file_creation_mode: 'folder',
      folder_templates: [
        { folder: '/', template: 'life/template/Note.md' },
        { folder: 'life/Projects', template: 'life/template/Project.md' },
      ],
      user_scripts_folder: 'life/scripts',
      auto_jump_to_cursor: true,
    }),
    obsidian('plugins/calendar/data.json', { weekStart: 'monday', shouldConfirmBeforeCreate: true, wordsPerDot: 250, showWeeklyNote: true }),
    ['life/template/Note.md', NOTE],
    ['life/template/Project.md', '# <% tp.file.title %>\n\nfolder: <% tp.file.folder() %>\n<%* if (tp.file.title.startsWith("Без")) { -%>\nuntitled\n<%* } else { -%>\nnamed\n<%* } -%>\nnotes: <% app.vault.getMarkdownFiles().length > 3 %>\n'],
    ['life/template/Daily.md', '---\ntags: [calendar]\n---\n[[{{date-1d:YYYY-MM-DD}}|вчера]] | [[{{date:YYYY-MM}}]] | [[{{date+1d:YYYY-MM-DD}}|завтра]]\n\n# {{title}}\n\n![[Day.base]]\n'],
    ['life/template/Ask.md', '<%* const name = await tp.system.prompt("Имя?", "мир"); const mood = await tp.system.suggester(["Хорошо", "Плохо"], ["good", "bad"]); -%>\nПривет, <% name %>! <% mood %> <% tp.date.now("YYYY", "P1Y") %> <% tp.user.shout("ok") %> [<% tp.file.selection() %>]'],
    ['life/scripts/shout.js', 'module.exports = (text) => text.toUpperCase() + "!"\n'],
    ['life/Bases/Day.base', 'views:\n  - type: cards\n    name: Заметки дня\n    filters:\n      and:\n        - file.hasLink(this.file)\n    order:\n      - file.name\n    cardSize: 170\n'],
    ['life/Notes/Notes.md', '# Notes\n'],
    ['life/Notes/Existing.md', 'выделенное слово\n'],
    ['life/Notes/Ref.md', `Про [[${today}]]\n\n- [ ] в заметках 📅 ${today}\n- [ ] просрочено 📅 ${day(-3)}\n- [ ] без даты\n`],
    ['life/Projects/Old.md', 'old\n'],
    [`life/Calendar/${day(-1).slice(0, 7)}/${day(-1)}.md`, `${'слово '.repeat(600)}\n\n- [ ] задача из календаря 📅 ${today}\n`],
    ['Board.md', BOARD],
  ]),
}

export async function run(t) {
  const { page, ok, wait, read, exists, leaf } = t
  const settings = () => JSON.parse(read('.flint/settings.json'))
  const right = page.locator('aside.right')
  const left = page.locator('aside.left')
  const cell = (date) => page.locator(`.calendar .day[data-date="${date}"]`)
  // A folder and its hub note share a name; folders are the rows that can be expanded.
  const folder = (name) => page.locator('.row[aria-expanded]', { hasText: new RegExp(`${name}$`) })
  const context = async (name, item) => {
    await folder(name).click({ button: 'right' })
    await page.locator('.menu button', { hasText: item }).click()
  }

  await page.waitForSelector('.calendar')
  const ready = await page.evaluate(() => Promise.race([app.metadata.ready.then(() => 'ready'), new Promise((r) => setTimeout(() => r('index never became ready'), 8000))]))
  ok('the note index finishes loading', ready === 'ready', ready)
  await wait(900)

  // ---- settings come from Obsidian's config and live in the vault ----
  const saved = settings()
  ok('template settings taken from Templater', saved.templates.folder === 'life/template' && saved.templates.scripts === 'life/scripts', JSON.stringify(saved.templates))
  ok('folder rules imported, deeper folder first', saved.templates.rules === 'life/Projects = life/template/Project.md\n/ = life/template/Note.md', saved.templates.rules)
  ok('daily note settings taken from Obsidian', saved.calendar.dailyFormat === 'YYYY-MM/YYYY-MM-DD' && saved.calendar.dailyFolder === 'life/Calendar' && saved.calendar.dailyTemplate === 'life/template/Daily', JSON.stringify(saved.calendar))

  // ---- calendar widget ----
  ok('the daily note is created and opened at start, as the Obsidian setting asks', saved.calendar.openOnStart === true && exists(`life/Calendar/${month}/${today}.md`) && (await t.activeTab()) === today, await t.activeTab().catch(() => 'no tab'))
  ok('calendar is a widget in the right sidebar', (await right.locator('.calendar').count()) === 1 && (await cell(today).getAttribute('class')).includes('today'))
  const dots = await cell(day(-1)).evaluate((el) => ({ filled: el.querySelectorAll('.dots i:not(.hollow)').length, hollow: el.querySelectorAll('.dots i.hollow').length }))
  ok('dots show how much is written and open tasks', dots.filled === 3 && dots.hollow === 1, JSON.stringify(dots))
  const daily = `life/Calendar/${month}/${today}.md`
  await cell(day(2)).click()
  await wait(1500)
  ok('a click on a day creates its note where Obsidian would', exists(`life/Calendar/${day(2).slice(0, 7)}/${day(2)}.md`) && (await t.activeTab()) === day(2))
  await cell(today).click()
  await wait(900)
  ok('date variables with shifts are filled in', read(daily).includes(`[[${day(-1)}|вчера]] | [[${month}]] | [[${day(1)}|завтра]]\n\n# ${today}\n`), read(daily))
  ok('the general template is not added on top of the daily one', read(daily).startsWith('---\ntags: [calendar]\n---\n[['))
  ok('the open day is marked', (await cell(today).getAttribute('class')).includes('active'))
  await wait(800)
  ok('an embedded base uses the embedding note as "this"', (await t.flat(page.locator(`${leaf} .lp-embed.base`))).includes('Ref'), await page.locator(`${leaf} .lp-embed`).innerText().catch(() => 'no embed'))

  const title = () => page.locator('.calendar .title').innerText()
  const before = await title()
  await page.locator('.calendar .nav').last().click()
  ok('next month', (await title()) !== before)
  await page.locator('.calendar .today').click()
  ok('back to today', (await title()) === before)
  await page.locator('.calendar .week').first().click()
  await wait(1200)
  ok('a week number opens the weekly note', /^\d{4}-W\d{2}$/.test(await t.activeTab()), await t.activeTab())

  // ---- templates by rule ----
  await folder('life').click()
  await folder('Notes').click()
  await context('Notes', 'Новая заметка')
  await page.waitForSelector('input.rename')
  await page.keyboard.press('Escape')
  await wait(1500)
  let text = read('life/Notes/Без названия.md')
  ok('a new note gets the general template; code using Obsidian API works', text === `---\ndate: ${today}\nlink:\n  - "[[Notes]]"\n---\n\n\n`, JSON.stringify(text))
  ok('the cursor mark is taken out and the cursor put there', !text.includes('tp.file.cursor') && (await page.evaluate(() => app.workspace.activeEditor.state.selection.main.head)) === text.length - 1)

  await folder('Projects').click()
  await context('Projects', 'Новая заметка')
  await page.waitForSelector('input.rename')
  await page.keyboard.press('Escape')
  await wait(1500)
  text = read('life/Projects/Без названия.md')
  ok('a higher rule wins for its folder; conditions and whitespace control work', text === '# Без названия\n\nfolder: Projects\nuntitled\nnotes: true\n', JSON.stringify(text))

  // ---- inserting a template that asks questions ----
  await t.row('Existing').click()
  await page.waitForSelector(`${leaf} .cm-content`)
  await wait(500)
  await page.evaluate(() => {
    const editor = app.workspace.activeEditor
    editor.dispatch({ selection: { anchor: 0, head: 10 } })
    editor.focus()
  })
  await page.keyboard.press('Alt+e')
  await page.keyboard.type('Ask')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.tpl-dialog input')
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Юля')
  await page.keyboard.press('Enter')
  await page.waitForSelector('dialog [role=option]')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await wait(1200)
  const year = Number(today.slice(0, 4)) + 1
  ok('prompt, suggester, date offset, user script and selection in one template', read('life/Notes/Existing.md') === `Привет, Юля! bad ${year} OK! [выделенное] слово\n`, read('life/Notes/Existing.md'))

  // ---- task query written for Obsidian Tasks ----
  await t.open('Board')
  text = await t.flat(page.locator(`${leaf} .tasks-block`))
  ok('filter and group by function, continuation lines, hidden sort marks', /ПРОСРОЧЕНО\s*1 просрочено.*СЕГОДНЯ\s*1 в заметках.*БЕЗ ДАТЫ\s*1 без даты/i.test(text) && !text.includes('%%') && !text.includes('из календаря'), text)

  // ---- widgets ----
  const tab = (name) => page.locator(`.widget-tab[title="${name}"]`)
  await tab('Задачи').click()
  await wait(400)
  text = await t.flat(right.locator('.tasks-panel'))
  ok('all tasks as a widget, in sections by time', /ПРОСРОЧЕНО.*СЕГОДНЯ.*БЕЗ СРОКА/i.test(text) && text.includes('задача из календаря'), text)

  await tab('Календарь').dragTo(left.locator('.tabs').first())
  await wait(900)
  ok('a widget can be dragged to the other sidebar', (await left.locator('.calendar').count()) === 1 && (await right.locator('.calendar').count()) === 0)
  // The gaps between blocks only open up once a drag is under way, so this one is done by hand.
  const from = await tab('Календарь').boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 4 })
  await wait(300)
  const gap = await left.locator('.gap').first().boundingBox()
  await page.mouse.move(gap.x + gap.width / 2, gap.y + gap.height / 2, { steps: 6 })
  await wait(200)
  await page.mouse.up()
  await wait(900)
  const blocks = await left.locator('.group').evaluateAll((groups) => groups.map((g) => [...g.querySelectorAll('.widget-tab')].map((tab) => tab.title).join('+')))
  ok('and dropped between blocks to stand on its own', JSON.stringify(blocks) === JSON.stringify(['Календарь', 'Файлы']), JSON.stringify(blocks))
  ok('a compact widget takes only its own height', await left.locator('.group').first().evaluate((g) => g.classList.contains('compact') && g.getBoundingClientRect().height < 330))
  await wait(900)
  const layout = JSON.parse(read('.flint/workspace.json')).layout
  ok('the layout is saved in the vault', JSON.stringify(layout.left.map((group) => group.tabs)) === JSON.stringify([['calendar'], ['files']]), JSON.stringify(layout))
  await page.reload()
  await page.waitForSelector('.calendar')
  await wait(1200)
  ok('and survives a reload', (await left.locator('.calendar').count()) === 1 && (await page.locator('.tab').count()) > 2)
}
