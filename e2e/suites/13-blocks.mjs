// Blocks in the formats of Obsidian plugins: link cards, widgets, buttons, tabs; the calendar of ```tasks; the task form from the editor.
import { day, fixture } from '../helpers.mjs'

const today = day()
const fence = '```'
export const vault = {
  plugins: ['link-embed', 'widgets', 'buttons', 'tabs', 'tasks', 'word-count'],
  settings: { tasks: { remindDue: false } },
  files: {
    'Blocks.md': [
      '# Blocks',
      '',
      `${fence}embed`,
      'title: "Example Domain"',
      'image: "pic.png"',
      'description: "A page for use in examples"',
      'url: "https://example.com/page"',
      'favicon: ""',
      'aspectRatio: "50"',
      fence,
      '',
      `${fence}widgets`,
      'type: clock',
      'format: "24hr"',
      fence,
      '',
      `${fence}widgets`,
      'type: countdown',
      'date: +2d',
      'to: Release',
      'show: days, hours',
      fence,
      '',
      `${fence}widgets`,
      'type: counter',
      'text: Glasses',
      'increment: 2',
      'id: water',
      fence,
      '',
      `${fence}widgets`,
      'type: quote',
      'quote: Stay hungry',
      'author: Someone',
      fence,
      '',
      `${fence}button`,
      'name Count words',
      'type command',
      'action Web viewer: Open web viewer',
      'color blue',
      fence,
      '',
      `${fence}button`,
      'name Add line',
      'type append text',
      'action appended by button',
      fence,
      '',
      `${fence}button`,
      'name Go',
      'type link',
      'action Target',
      fence,
      '',
      `${fence}${fence.slice(0, 1)}tabs`,
      'tab: First',
      'Text of **one**',
      '- [ ] tick me',
      'tab: Second',
      '## Two',
      fence + 'js',
      'const a = 1',
      fence,
      `${fence}${fence.slice(0, 1)}`,
      '',
      'end',
      '',
    ].join('\n'),
    'Target.md': '# Target\n',
    'pic.png': fixture('pic.png'),
    'Plan.md': `# Plan\n\n- [ ] Pay rent 📅 ${today} ⏫\n- [ ] Call mom ⏳ ${day(1)}\n- [x] Done thing 📅 ${today} ✅ ${today}\n- [ ] Someday\n\n${fence}tasks\n# view calendar\nhappens after 2020-01-01\n${fence}\n\nend\n`,
  },
}

export async function run(t) {
  const { page, ok, wait, read, leaf } = t
  await t.open('Blocks')
  await wait(600)

  const card = page.locator(`${leaf} .embed-card`)
  ok('embed: a card with title, description and address', /Example Domain.*A page for use in examples.*https:\/\/example\.com\/page/.test(await t.flat(card)), await t.flat(card))
  ok('embed: the card is a link that opens outside the app', (await card.getAttribute('href')) === 'https://example.com/page' && (await card.getAttribute('target')) === '_blank')

  const widgets = page.locator(`${leaf} .widget-block`)
  ok('widgets: four drawn', (await widgets.count()) === 4, await widgets.count())
  const time = await widgets.nth(0).locator('.widget-clock-time').innerText()
  ok('clock: 24-hour time with seconds, and the date', /^\d{2}:\d{2}:\d{2}$/.test(time) && (await widgets.nth(0).locator('.widget-clock-date').innerText()).includes(String(new Date().getFullYear())), time)
  let s = await t.flat(widgets.nth(1))
  ok('countdown: only the asked units, and what it counts to', /^1 дней \d+ часов Release$/.test(s), s)
  await widgets.nth(2).locator('button', { hasText: '+' }).click()
  await widgets.nth(2).locator('button', { hasText: '+' }).click()
  await widgets.nth(2).locator('button', { hasText: '−' }).click()
  s = await t.flat(widgets.nth(2))
  ok('counter: counts by its step', s === 'Glasses − 2 +', s)
  ok('quote: text and author', (await t.flat(widgets.nth(3))) === '«Stay hungry» Someone', await t.flat(widgets.nth(3)))

  const button = (name) => page.locator(`${leaf} .button-block button`, { hasText: name })
  ok('button: name and colour from the block', (await button('Count words').getAttribute('class')).includes('blue'))
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 5000 }).catch(() => null), button('Count words').click()])
  ok("button: Obsidian's web viewer command opens a browser tab", !!popup)
  await popup?.close()
  await button('Add line').click()
  await wait(1200)
  ok('button: "append text" adds the text below the button', read('Blocks.md').includes(`action appended by button\n${fence}\nappended by button\n`), read('Blocks.md').slice(-400))
  ok('the note stays as it was otherwise', read('Blocks.md').startsWith('# Blocks\n\n```embed\ntitle: "Example Domain"'))

  const tabs = page.locator(`${leaf} .tabs-block`)
  ok('tabs: one tab per "tab:" line, the first open', (await t.flat(tabs.locator('.tabs-strip'))) === 'First Second' && (await t.flat(tabs.locator('.tabs-pane:not([hidden])'))).includes('Text of one'), await t.flat(tabs))
  await tabs.locator('.tabs-pane:not([hidden]) input[type=checkbox]').check()
  await wait(1200)
  ok('tabs: ticking a checkbox inside a tab changes the note', read('Blocks.md').includes('tab: First\nText of **one**\n- [x] tick me\ntab: Second'), read('Blocks.md').slice(-300))
  await tabs.locator('.tabs-tab', { hasText: 'Second' }).click()
  await wait(400)
  s = await t.flat(tabs.locator('.tabs-pane:not([hidden])'))
  ok('tabs: the other tab shows its text, code block included', s.includes('Two') && s.includes('const a = 1') && !s.includes('Text of one'), s)

  await page.reload()
  await page.waitForSelector(`${leaf} .widget-block`)
  await wait(800)
  s = await t.flat(page.locator(`${leaf} .widget-block`).nth(2))
  ok('counter: the number survives a reload', s === 'Glasses − 2 +', s)

  await button('Go').click()
  await wait(600)
  ok('button: "link" opens a note', (await t.activeTab()) === 'Target', await t.activeTab())

  // ---- the calendar of ```tasks
  await t.open('Plan')
  await wait(600)
  const calendar = page.locator(`${leaf} .tasks-calendar`)
  const cell = (date) => calendar.locator(`.tasks-calendar-day[data-date="${date}"]`)
  ok('tasks calendar: a month with today marked', (await calendar.count()) === 1 && (await calendar.locator('.tasks-calendar-day.today').getAttribute('data-date')) === today)
  s = await t.flat(cell(today))
  ok('tasks calendar: tasks sit on their dates', s.includes('Pay rent') && s.includes('Done thing') && !s.includes('Call mom'), s)
  ok('tasks calendar: "happens" keeps only tasks with a date', (await calendar.locator('.tasks-calendar-undated').count()) === 0 && (await calendar.locator('.tasks-calendar-task').count()) === 3, await calendar.locator('.tasks-calendar-task').count())

  // Dragging a task to another day changes its date in the note.
  const other = day(new Date().getDate() > 15 ? -3 : 3)
  await cell(today).locator('.tasks-calendar-task', { hasText: 'Pay rent' }).dragTo(cell(other))
  await wait(1500)
  ok('tasks calendar: dragging to a day sets the date', read('Plan.md').includes(`- [ ] Pay rent ⏫ 📅 ${other}`) || read('Plan.md').includes(`- [ ] Pay rent 📅 ${other} ⏫`), read('Plan.md'))
  ok('tasks calendar: the task moved on screen', (await t.flat(cell(other))).includes('Pay rent') && !(await t.flat(cell(today))).includes('Pay rent'))
  await cell(other).locator('input').check()
  await wait(1500)
  ok('tasks calendar: ticking completes the task', new RegExp(`- \\[x\\] Pay rent.*✅ ${today}`).test(read('Plan.md')), read('Plan.md'))

  // ---- a click on a task's date in the editor opens its form
  await page.locator(`${leaf} .lp-task-field`, { hasText: day(1) }).click()
  await wait(500)
  const dialog = page.locator('dialog[open]')
  ok('a click on a task field opens the task form', (await dialog.count()) === 1 && (await dialog.locator('input').first().inputValue()) === 'Call mom', await dialog.count())
  await dialog.locator('input').first().fill('Call mother')
  await dialog.locator('button', { hasText: 'Сохранить' }).click()
  await wait(1500)
  ok('the form writes the line back', read('Plan.md').includes(`- [ ] Call mother ⏳ ${day(1)}`), read('Plan.md'))
}
