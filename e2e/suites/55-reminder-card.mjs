import { day } from '../helpers.mjs'

export const vault = {
  plugins: ['tasks'],
  settings: { tasks: { sound: false, alertStyle: 'banner', laterOptions: '10 минут\n30 минут\n1 час\nЗавтра' } },
  files: { 'План.md': `- [ ] Проверить план на неделю ⏰ ${day(-1)} 12:00\n` },
}

export async function run(t) {
  const { page, ok } = t
  const card = page.locator('.task-alert.banner[open]')
  await card.waitFor()
  const actions = card.locator('.alert-actions')
  ok('the card keeps two main actions and a separate quiet overdue caption', await actions.locator('button').count() === 2 && await card.locator('.alert-status .days.overdue').count() === 1 && await card.locator('.alert-text .days').count() === 0)
  const box = await card.boundingBox()
  ok('a single reminder fits in a compact card', box.width <= 380 && box.height < 270, JSON.stringify(box))
  await card.screenshot({ path: '/tmp/flint-reminder-card-light.png' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await card.screenshot({ path: '/tmp/flint-reminder-card-dark.png' })
  await page.emulateMedia({ colorScheme: 'light' })

  await actions.getByRole('button', { name: 'Напомнить позже' }).click()
  const menu = page.getByRole('menu')
  await menu.waitFor()
  ok('snooze options come from the plugin settings and the menu sits above the card', await menu.getByRole('menuitem').count() === 4 && await menu.getByRole('menuitem', { name: 'Завтра', exact: true }).isVisible())
  await menu.getByRole('menuitem', { name: 'Через 10 минут', exact: true }).click()
  await card.waitFor({ state: 'detached' })
  ok('postponing from the menu closes the card', await page.locator('.task-alert').count() === 0)

  // A task with its own time is rewritten by postponing, so add a fresh reminder.
  t.write('Проверка.md', `- [ ] Очень длинное название задачи, которое должно переноситься аккуратно и оставаться полностью читаемым ⏰ ${day(-1)} 12:00\n`)
  await card.waitFor()
  await page.setViewportSize({ width: 360, height: 720 })
  const narrow = await card.boundingBox()
  ok('the card fits a narrow window without horizontal scrolling', narrow.width <= 328 && await card.evaluate((el) => el.scrollWidth <= el.clientWidth))
  await card.screenshot({ path: '/tmp/flint-reminder-card-narrow.png' })
  t.write('Ещё.md', `- [ ] Второе напоминание ⏰ ${day(-1)} 13:00\n`)
  await page.waitForFunction(() => document.querySelector('.task-alert')?.dataset.count === '2')
  await card.locator('.alert-task', { hasText: 'Второе напоминание' }).getByRole('button', { name: 'Закрыть напоминание', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.task-alert')?.dataset.count === '1')
  ok('a reminder in a group can be dismissed individually', await card.locator('.alert-task').count() === 1)
  await card.getByRole('button', { name: 'Закрыть напоминания' }).click()
  await card.waitFor({ state: 'detached' })
  ok('the header close button dismisses the reminder', await page.locator('.task-alert').count() === 0)
}
