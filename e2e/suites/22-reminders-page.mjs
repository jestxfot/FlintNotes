// The page of reminders: lines of a day's plan, counts, putting off and closing, muting; a widget opened as a tab.
import { day } from '../helpers.mjs'

const today = day()
const at = (minutes) => {
  const d = new Date(Date.now() + minutes * 60_000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
// The plan needs moments today on both sides of now; near midnight there is no room for them.
const room = new Date().getHours() >= 1 && new Date().getHours() < 23
export const vault = {
  plugins: ['tasks'],
  settings: { tasks: { remindDue: false, alertStyle: 'banner', sound: false } },
  files: {
    [`${today}.md`]: `# Day planner\n\n- [ ] ${at(-30)} - ${at(-20)} 💊 Vitamin D\n- [ ] ${at(45)} - ${at(50)} Evening tea\n- [x] ${at(-50)} Done already\n`,
    [`${day(-5)}.md`]: `- [ ] 10:00 - 10:15 Old plan never ticked\n`,
    'Other.md': `- [ ] Call bank ⏰ ${day(2)} 12:00\n- [ ] ${at(-10)} not a plan, this is no daily note\n`,
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  if (!room) return ok('skipped near midnight', true)
  const banner = page.locator('.task-alert.banner')
  await banner.waitFor({ timeout: 15000 }).catch(() => {})
  ok('a line of the day plan whose time has come alerts, as a card in the corner', (await banner.count()) === 1 && (await t.flat(banner)).includes('Vitamin D') && !(await t.flat(banner)).includes('Old plan') && !(await t.flat(banner)).includes('not a plan'), await t.flat(banner).catch(() => 'no banner'))
  ok('the card does not take the page away', (await page.evaluate(() => document.querySelector('.task-alert').matches(':modal'))) === false)

  // ---- the same list as a tab of its own
  await page.evaluate(() => app.commands.run('core:panel-tab:reminders'))
  const list = page.locator(`${t.leaf} .reminders-panel`)
  await list.waitFor()
  ok('the reminders open as a tab', (await t.activeTab()) === 'Напоминания' && (await t.count(`${t.leaf}.panel-tab .reminders-panel, ${t.leaf} .panel-tab .reminders-panel`)) === 1)
  const text = await t.flat(list)
  ok('groups carry their counts, the overdue in front', /Просрочено\s*1/.test(text) && /Сегодня\s*1/.test(text) && text.includes('Vitamin D') && text.includes('Evening tea') && text.includes('Call bank') && !text.includes('Old plan') && !text.includes('Done already'), text)

  await list.locator('.reminder-row', { hasText: 'Vitamin D' }).locator('button[title^="Закрыть"]').click()
  await wait(700)
  ok('a closed reminder leaves the list and the alert', !(await t.flat(list)).includes('Vitamin D') && (await t.count('.task-alert')) === 0, await t.flat(list))
  await list.locator('.reminders-tool').click()
  await page.locator('.menu button', { hasText: 'Показать закрытые' }).click()
  await wait(400)
  ok('closed ones can be shown and brought back', (await list.locator('.reminder-row.closed', { hasText: 'Vitamin D' }).count()) === 1)
  await list.locator('.reminder-row', { hasText: 'Vitamin D' }).locator('button[title="Вернуть"]').click()
  await banner.waitFor({ timeout: 8000 }).catch(() => {})
  ok('brought back, it alerts again', (await banner.count()) === 1)

  // ---- do not disturb
  await list.locator('.reminders-tool').click()
  await page.locator('.menu button', { hasText: 'Не беспокоить 1 час' }).click()
  await wait(700)
  ok('"do not disturb" takes the alert away and keeps the list', (await t.count('.task-alert')) === 0 && (await t.flat(list)).includes('Vitamin D') && (await list.locator('.reminders-tool.on').count()) === 1)
  await page.evaluate(() => app.commands.run('tasks:unmute'))
  await banner.waitFor({ timeout: 8000 }).catch(() => {})
  ok('and the command lets alerts through again', (await banner.count()) === 1)

  // ---- putting off from the list
  await list.locator('.reminder-row', { hasText: 'Vitamin D' }).locator('button[title="Отложить"]').click()
  await page.locator('.menu button', { hasText: '10 минут' }).click()
  await wait(700)
  ok('a plan line put off stays as written and says until when', (await t.count('.task-alert')) === 0 && (await t.flat(list.locator('.reminder-row', { hasText: 'Vitamin D' }))).includes('отложено до') && t.read(`${today}.md`).includes('💊 Vitamin D\n'))

  // ---- a widget can be put away from the sidebar and stays available as a tab
  await page.evaluate(() => app.panels.setHidden('reminders', true))
  await wait(300)
  ok('a widget put away is gone from the sidebar, its tab stays', (await page.locator('aside .widget-tab[title="Напоминания"]').count()) === 0 && (await list.count()) === 1)
}
