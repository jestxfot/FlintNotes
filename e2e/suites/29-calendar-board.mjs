// The calendar with a tab to itself: a month, a week, a year or a list, and beside it everything of the chosen day.
import { day } from '../helpers.mjs'

const today = day()
export const viewport = { width: 1600, height: 1000 }
export const vault = {
  plugins: ['calendar', 'tasks'],
  settings: { tasks: { remindDue: false, planner: false, sound: false }, calendar: { confirm: false, boardLines: 8 } },
  files: {
    '.obsidian/app.json': '{}',
    [`${today}.md`]: `# Day planner\n- [x] 08:00 - 08:30 Coffee ✅ ${today}\n- [ ] 09:00 - 11:00 Deep work\n- 13:00 Lunch\n- [ ] Buy milk\n\n\`\`\`\n- [ ] 05:00 not a line\n\`\`\`\n`,
    'Projects.md': `- [ ] Send report 📅 ${today}\n- [ ] Far away 📅 2031-01-15\n- [ ] No date at all\n`,
  },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  await page.waitForFunction(() => app.metadata.ready.then(() => true))
  await wait(900)
  ok('in a sidebar the calendar stays the small month', (await page.locator('aside .calendar').count()) === 1 && (await page.locator('aside .board').count()) === 0)
  await page.evaluate(() => app.commands.run('core:panel-tab:calendar'))
  const board = page.locator(`${t.leaf} .board`)
  await board.waitFor()
  await wait(600)
  const sizes = await page.evaluate(() => [document.querySelector('.leaf:not([hidden]) .board').getBoundingClientRect().width, document.querySelector('.leaf:not([hidden])').getBoundingClientRect().width])
  ok('as a tab it is the large calendar over the whole page', sizes[0] > sizes[1] - 60 && (await board.locator('.cell').count()) === 42 && (await board.locator('.modes [role=tab]').allInnerTexts()).join('|') === 'Месяц|Неделя|Год|Список', JSON.stringify(sizes))
  const cell = board.locator(`.cell[data-date="${today}"]`)
  const inCell = await t.flat(cell)
  ok('a day shows its plan, the tasks of its note and the tasks dated to it; code is not a line', inCell.includes('08:00') && inCell.includes('Deep work') && inCell.includes('Lunch') && inCell.includes('Buy milk') && inCell.includes('Send report') && !inCell.includes('not a line') && !inCell.includes('No date'), inCell)
  ok('with how many are not done yet', (await cell.locator('.count').innerText()) === '3' && (await cell.getAttribute('class')).includes('today'))

  // ---- the chosen day
  const side = board.locator('aside.day')
  const sideText = await t.flat(side)
  ok('beside the calendar stands everything of the chosen day, in groups', /План дня\s*3/i.test(sideText) && /Задачи на этот день\s*1/i.test(sideText) && /В заметке дня\s*1/i.test(sideText) && sideText.includes('Projects'), sideText)
  await side.locator('.item', { hasText: 'Deep work' }).locator('input').check()
  await wait(1300)
  ok('a line is ticked there', read(`${today}.md`).includes(`- [x] 09:00 - 11:00 Deep work ✅ ${today}`), read(`${today}.md`))
  const tabBefore = await t.activeTab()
  await side.locator('.item', { hasText: 'Send report' }).locator('.text').click()
  await page.waitForSelector('dialog[open] textarea')
  ok('a click on a task opens its window, not the note', (await page.locator('dialog[open] textarea').inputValue()).includes('Send report') && (await t.activeTab()) === tabBefore)
  await page.keyboard.press('Escape')
  await wait(300)
  await side.locator('.add input').fill('Call mum')
  await page.keyboard.press('Enter')
  await wait(1300)
  ok('a new task of the day is written into its note', read(`${today}.md`).endsWith('- [ ] Call mum\n') && (await t.flat(side)).includes('Call mum'), read(`${today}.md`).slice(-60))

  // ---- another day, the other views
  const other = board.locator('.cell:not(.outside):not(.today)').first()
  const otherDate = await other.getAttribute('data-date')
  await other.click()
  await wait(400)
  ok('a click on a day chooses it and shows what it holds', (await other.getAttribute('class')).includes('chosen') && (await t.flat(side)).includes('На этот день ничего нет') && (await t.activeTab()) === tabBefore && !t.exists(`${otherDate}.md`))
  await board.locator('.now').click()
  const mode = (name) => board.locator('.modes [role=tab]', { hasText: name })
  await mode('Неделя').click()
  await wait(500)
  ok('a week is seven days with all their lines', (await board.locator('.cell').count()) === 7 && (await t.flat(board.locator(`.cell[data-date="${today}"]`))).includes('Call mum'))
  await mode('Год').click()
  await wait(500)
  ok('a year is twelve months; a day with open tasks is marked', (await board.locator('.mini').count()) === 12 && (await board.locator(`.mini-day[data-date="${today}"]`).getAttribute('class')).includes('busy'))
  await mode('Список').click()
  await wait(500)
  ok('a list is the days of the month that hold something', (await board.locator('.list section').count()) === 1 && (await t.flat(board.locator('.list section'))).includes('Send report'))
  await page.reload()
  await board.waitFor()
  await wait(900)
  ok('the chosen view comes back', (await mode('Список').getAttribute('aria-selected')) === 'true')

  // ---- carrying a line to another day
  await mode('Месяц').click()
  await wait(500)
  const next = await page.evaluate((today) => {
    const d = new Date(`${today}T12:00:00`)
    d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, today)
  const nextCell = board.locator(`.cell[data-date="${next}"]`)
  await board.locator(`.cell[data-date="${today}"] .item`, { hasText: 'Send report' }).dragTo(nextCell)
  await wait(1500)
  ok('a task of another note dragged to another day gets that date', read('Projects.md').includes(`- [ ] Send report 📅 ${next}`), read('Projects.md'))
  await board.locator(`.cell[data-date="${today}"] .item`, { hasText: 'Buy milk' }).dragTo(nextCell)
  await wait(1800)
  ok('a line of the daily note moves to the other day\'s note', !read(`${today}.md`).includes('Buy milk') && t.exists(`${next}.md`) && read(`${next}.md`).includes('- [ ] Buy milk') && (await t.flat(nextCell)).includes('Buy milk'), t.exists(`${next}.md`) ? read(`${next}.md`) : 'no note')

  // ---- what is shown
  await mode('Месяц').click()
  await wait(400)
  await board.locator('.options').click()
  await page.locator('.menu button', { hasText: 'Выполненное' }).click()
  await wait(500)
  ok('what is done can be left out', !(await t.flat(board.locator(`.cell[data-date="${today}"]`))).includes('Coffee') && (await page.evaluate(() => app.settings.get('calendar', 'boardDone'))) === false)
  await page.screenshot({ path: process.env.FLINT_SHOT ?? '/dev/null' }).catch(() => {})
}
