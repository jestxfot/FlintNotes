// The day planner: lines of the daily note that begin with a time, as blocks on a scale of hours.
import { day } from '../helpers.mjs'

const today = day()
const data = { plannerHeading: 'Day planner', plannerHeadingLevel: 1, startHour: 2, zoomLevel: 1, snapStepMinutes: 10, defaultDurationMinutes: 30, showCompletedTasks: true, eventFormatOnCreation: 'task' }
export const viewport = { width: 1500, height: 1000 }
export const vault = {
  plugins: ['day-planner'],
  files: {
    '.obsidian/app.json': '{}',
    '.obsidian/plugins/obsidian-day-planner/data.json': JSON.stringify(data),
    [`${today}.md`]: `# Notes\n\ntext\n\n# Day planner\n- [x] 08:00 - 08:30 Coffee ✅ ${today}\n- [ ] 09:00 - 11:00 Deep work [[Other]]\n- [ ] 10:00 - 10:30 Call\n- 13:00 Lunch\n- [ ] No time yet\n\n\`\`\`\n- [ ] 05:00 - 06:00 not a block\n\`\`\`\n`,
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
}
