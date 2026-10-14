// The day planner: lines of the daily note that begin with a time, as blocks on a scale of hours.
import { day } from '../helpers.mjs'

const today = day()
const data = { plannerHeading: 'Day planner', plannerHeadingLevel: 1, startHour: 2, zoomLevel: 1, snapStepMinutes: 10, defaultDurationMinutes: 30, showCompletedTasks: true, eventFormatOnCreation: 'task' }
export const viewport = { width: 1500, height: 1000 }
export const vault = {
  plugins: ['day-planner', 'calendar'],
  files: {
    '.obsidian/app.json': '{}',
    '.obsidian/plugins/obsidian-day-planner/data.json': JSON.stringify(data),
    [`${today}.md`]: `# Notes\n\ntext\n\n# Day planner\n- [x] 08:00 - 08:30 Coffee ✅ ${today}\n- [ ] 09:00 - 11:00 Deep work [[Other]]\n- [ ] 10:00 - 10:30 Call\n- 13:00 Lunch\n- [ ] No time yet\n\n\`\`\`\n- [ ] 05:00 - 06:00 not a block\n\`\`\`\n`,
    [`${day(1)}.md`]: '# Day planner\n- [ ] 07:00 - 07:30 Tomorrow run\n',
    'Other.md': 'x\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  const file = `${today}.md`
  await page.waitForFunction(() => app.settings.get('day-planner', 'imported') === true, null, { timeout: 15000 }).catch(() => {})
  await wait(1200)
  ok('settings come from the Day Planner plugin', await page.evaluate(() => app.settings.get('day-planner', 'startHour') === 2 && app.settings.get('day-planner', 'zoomLevel') === 1))
  await page.evaluate(() => app.commands.run('core:panel-tab:day-planner'))
  const plan = page.locator(`${t.leaf} .day-plan`)
  await plan.waitFor()
  const blocks = plan.locator('.day-plan-grid .day-block')
  const texts = async () => (await blocks.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim())
  ok('lines with a time are blocks; code is not', (await blocks.count()) === 4 && (await texts()).join('|').includes('08:00–08:30 Coffee') && (await texts()).join('|').includes('13:00–13:30 Lunch') && !(await texts()).join('|').includes('not a block'), (await texts()).join('|'))
  ok('a done block is marked, and the progress counts it', (await plan.locator('.day-block.done').count()) === 1 && (await plan.locator('.day-plan-progress').getAttribute('title')) === 'Выполнено 1 из 3')
  ok('a task of the plan without a time waits above the scale', (await t.flat(plan.locator('.day-plan-loose'))).includes('No time yet'))
  const boxes = await blocks.evaluateAll((list) => list.map((el) => [Math.round(el.getBoundingClientRect().left), Math.round(el.getBoundingClientRect().width)]))
  ok('blocks that overlap stand side by side', boxes[1][0] !== boxes[2][0] && boxes[1][1] < boxes[0][1], JSON.stringify(boxes))

  // ---- ticking, moving and stretching rewrite the line
  await plan.locator('.day-block', { hasText: 'Call' }).locator('input').check()
  await wait(1200)
  ok('ticking a block completes its line', read(file).includes(`- [x] 10:00 - 10:30 Call ✅ ${today}`), read(file))
  const lunch = plan.locator('.day-plan-grid .day-block', { hasText: 'Lunch' })
  const perMinute = 42 / 60
  let box = await lunch.boundingBox()
  await page.mouse.move(box.x + 40, box.y + 6)
  await page.mouse.down()
  await page.mouse.move(box.x + 40, box.y + 6 + 60 * perMinute, { steps: 6 })
  await page.mouse.up()
  await wait(1200)
  ok('dragging a block moves it in time, in the note', read(file).includes('- 14:00 - 14:30 Lunch'), read(file))
  box = await plan.locator('.day-plan-grid .day-block', { hasText: 'Lunch' }).boundingBox()
  await page.mouse.move(box.x + 40, box.y + box.height - 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 40, box.y + box.height - 2 + 30 * perMinute, { steps: 6 })
  await page.mouse.up()
  await wait(1200)
  ok('dragging its lower edge makes it longer', read(file).includes('- 14:00 - 15:00 Lunch'), read(file))

  // ---- a new block
  await page.evaluate(() => app.commands.run('day-planner:add-block'))
  await wait(1500)
  const lines = read(file).split('\n')
  const made = lines.findIndex((line) => /^- \[ \] \d{2}:\d{2} - \d{2}:\d{2} $/.test(line))
  ok('a new block is a line under the plan heading, before the empty line that ends the list', made === lines.indexOf('- [ ] No time yet') + 1 && (await t.activeTab()) === today, JSON.stringify(lines.slice(4, 12)))
  await page.keyboard.type('Walk')
  await wait(1200)
  ok('and the cursor waits at its end', read(file).split('\n')[made].endsWith(' Walk'), read(file).split('\n')[made])

  // ---- three days, a week, a month
  await page.evaluate(() => app.commands.run('core:panel-tab:day-planner'))
  await wait(600)
  const tab = (name) => plan.locator('.day-plan-modes [role=tab]', { hasText: name })
  ok('the plan offers a day, three days, a week and a month', (await plan.locator('.day-plan-modes [role=tab]').allInnerTexts()).join('|') === 'День|3 дня|Неделя|Месяц' && (await tab('День').getAttribute('aria-selected')) === 'true')
  await tab('3 дня').click()
  await wait(500)
  const cols = plan.locator('.day-plan-col')
  ok('three days stand side by side, each with its own blocks', (await cols.count()) === 3 && (await t.flat(cols.nth(1))).includes('Tomorrow run') && !(await t.flat(cols.nth(0))).includes('Tomorrow run') && (await t.flat(cols.nth(0))).includes('Coffee'), await t.flat(cols.nth(1)))
  await tab('Неделя').click()
  await wait(500)
  ok('a week has seven days, today marked, the needle in it alone', (await cols.count()) === 7 && (await t.flat(plan.locator('.day-plan-col.today'))).includes('Coffee') && (await plan.locator('.day-now').count()) === 1 && (await plan.locator('.day-plan-days button').count()) === 7)
  await plan.locator('.day-plan-col.today .day-block', { hasText: 'Deep work' }).locator('input').check()
  await wait(1200)
  ok('a block is ticked from the week too', read(file).includes(`- [x] 09:00 - 11:00 Deep work [[Other]] ✅ ${today}`), read(file))
  await tab('Месяц').click()
  await wait(500)
  ok('a month is six weeks of days with the lines of their plans', (await plan.locator('.day-cell').count()) === 42 && (await t.flat(plan.locator('.day-cell.today'))).includes('08:00 Coffee'), await t.flat(plan.locator('.day-cell.today')))
  await page.reload()
  await plan.waitFor()
  await wait(900)
  ok('the chosen view comes back', (await tab('Месяц').getAttribute('aria-selected')) === 'true' && (await plan.locator('.day-cell').count()) === 42)
  await plan.locator('.day-cell.today .day-cell-date').click()
  await wait(500)
  ok('a date of the month opens that day', (await tab('День').getAttribute('aria-selected')) === 'true' && (await cols.count()) === 1 && (await t.flat(plan)).includes('Coffee'))
  // ---- a block carried sideways goes to another day
  await tab('3 дня').click()
  await wait(600)
  const run = plan.locator('.day-plan-col').nth(1).locator('.day-block', { hasText: 'Tomorrow run' })
  let from = await run.boundingBox()
  const toCol = await plan.locator('.day-plan-col').nth(2).boundingBox()
  await page.mouse.move(from.x + 30, from.y + 6)
  await page.mouse.down()
  await page.mouse.move(toCol.x + 30, from.y + 6 + 60 * perMinute, { steps: 8 })
  await page.mouse.up()
  await wait(1800)
  ok('a block dragged to the next column moves to that day, at its new time', !read(`${day(1)}.md`).includes('Tomorrow run') && t.exists(`${day(2)}.md`) && read(`${day(2)}.md`).includes('- [ ] 08:00 - 08:30 Tomorrow run'), read(`${day(2)}.md`))
  await tab('Месяц').click()
  await wait(600)
  const moving = plan.locator(`.day-cell .day-line`, { hasText: 'Tomorrow run' })
  const target = (await moving.evaluate((el) => [...el.closest('.day-plan-month').children].indexOf(el.closest('.day-cell')))) + 1
  await moving.dragTo(plan.locator('.day-cell').nth(target))
  await wait(1800)
  ok('a line of the month dragged to another day moves there', !read(`${day(2)}.md`).includes('Tomorrow run') && t.exists(`${day(3)}.md`) && read(`${day(3)}.md`).includes('- [ ] 08:00 - 08:30 Tomorrow run'), t.exists(`${day(3)}.md`) ? read(`${day(3)}.md`) : 'no note')
  await tab('День').click()
  await wait(500)

  // ---- a click on a block opens its window, not the note
  const tabBefore = await t.activeTab()
  await plan.locator('.day-plan-grid .day-block', { hasText: 'Lunch' }).click({ position: { x: 200, y: 8 } })
  const dialog = page.locator('dialog.day-dialog')
  await dialog.waitFor()
  ok('a click on a block opens its window with what it says', (await t.activeTab()) === tabBefore && (await dialog.locator('input[type=text]').inputValue()) === 'Lunch' && (await dialog.locator('input[type=time]').first().inputValue()) === '14:00')
  await dialog.locator('input[type=text]').fill('Long lunch')
  await dialog.locator('input[type=time]').first().fill('13:30')
  await dialog.locator('input[type=time]').last().fill('14:45')
  await dialog.locator('button', { hasText: 'Сохранить' }).click()
  await wait(1200)
  ok('saving the window rewrites the line of the block', read(file).includes('- 13:30 - 14:45 Long lunch') && (await dialog.count()) === 0, `${await dialog.count()} dialogs; ${await page.evaluate(() => [...document.querySelectorAll('dialog.day-dialog input')].map((i) => i.value + ':' + i.validationMessage).join(' / '))}; ${await page.locator('.notice').allInnerTexts()}`)
  await plan.locator('.day-plan-loose .day-block', { hasText: 'No time yet' }).click({ position: { x: 120, y: 8 } })
  await dialog.waitFor()
  await dialog.locator('input[type=time]').first().fill('16:00')
  await dialog.locator('button', { hasText: '45 мин' }).click()
  await dialog.locator('button', { hasText: 'Сохранить' }).click()
  await wait(1200)
  ok('a task without a time gets one in its window and becomes a block', read(file).includes('- [ ] 16:00 - 16:45 No time yet'), read(file))
  await plan.locator('.day-plan-grid .day-block', { hasText: 'Walk' }).click({ position: { x: 200, y: 8 } })
  await dialog.waitFor()
  await dialog.locator('button', { hasText: 'Удалить' }).click()
  await wait(1200)
  ok('and a block can be removed there', !read(file).includes('Walk'), read(file))
  await tab('Неделя').click()
  await wait(500)
  await page.screenshot({ path: process.env.FLINT_SHOT ?? '/dev/null' }).catch(() => {})
}
