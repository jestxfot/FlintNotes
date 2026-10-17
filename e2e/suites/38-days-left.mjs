// How long is left is written for any task and any reminder: in the note, in the task manager, on the reminders page.
import { day } from '../helpers.mjs'

export const viewport = { width: 1500, height: 950 }
export const vault = {
  plugins: ['tasks'],
  settings: { tasks: { remindDue: false, alertStyle: 'banner', sound: false } },
  files: {
    'Plan.md': `- [ ] In five days 📅 ${day(5)}\n- [ ] Tomorrow thing 📅 ${day(1)}\n- [ ] Late thing 📅 ${day(-2)}\n- [ ] Only planned ⏳ ${day(3)}\n- [x] Done thing 📅 ${day(4)} ✅ ${day(0)}\n- [ ] No day at all\n- [ ] Call bank ⏰ ${day(9)} 12:00\n\nend\n`,
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  await t.open('Plan')
  await t.cursorToEnd()
  await wait(900)
  const chips = page.locator(`${t.leaf} .cm-content .lp-days-left`)
  const texts = await chips.allInnerTexts()
  ok('an open task with a day says how long is left, at the end of its line', texts.join('|') === 'осталось 5 дней|завтра|просрочено на 2 дня|осталось 3 дня', texts.join('|'))
  ok('a late one is marked, and a near one', (await chips.nth(2).getAttribute('class')).includes('overdue') && (await chips.nth(1).getAttribute('class')).includes('soon'))
  ok('a done task and one with no day get none', texts.length === 4)
  ok('the note itself is not changed', !t.read('Plan.md').includes('осталось'))

  // ---- the task manager
  await page.keyboard.press('Alt+Shift+T')
  const manager = page.locator(`${t.leaf} .manager`)
  await manager.waitFor()
  await manager.locator('nav .side-item', { has: page.locator('.side-name', { hasText: /^Все задачи$/ }) }).click()
  await wait(500)
  const row = (name) => manager.locator('.task', { hasText: name })
  ok('the task manager writes it too', (await t.flat(row('In five days'))).includes('осталось 5 дней') && (await t.flat(row('Late thing'))).includes('просрочено на 2 дня'), await t.flat(row('Late thing')))
  ok('and not for a task with no day', !(await t.flat(row('No day at all'))).includes('осталось'))

  // ---- the reminders page: a reminder with a time and no day of its own counts to its time's day
  await page.evaluate(() => app.commands.run('core:panel-tab:reminders'))
  await wait(900)
  const page_ = page.locator(`${t.leaf} .reminders-panel`)
  const text = await t.flat(page_)
  ok('the reminders page says it for a reminder, too', /Call bank.*осталось 9 дней/.test(text), text)
}
