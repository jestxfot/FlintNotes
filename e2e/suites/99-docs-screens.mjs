// Pictures for the README, from a made-up vault. Runs only when asked: FLINT_DOCS=docs node e2e/run.mjs 99
import path from 'node:path'
import { day } from '../helpers.mjs'

const pad = (n) => String(n).padStart(2, '0')
const now = new Date()
const at = (minutes) => {
  const d = new Date(now.getTime() + minutes * 60_000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const plan = (lines) => `# ${'План'}\n\n## Day planner\n${lines.join('\n')}\n`
export const viewport = { width: 1600, height: 960 }
export const vault = {
  plugins: ['tasks', 'calendar', 'day-planner'],
  settings: {
    core: { theme: 'dark' },
    tasks: { sound: false, plannerOverdueDays: 2 },
    calendar: { confirm: false, weekNumbers: true },
    'day-planner': { startHour: 7, zoomLevel: 1, plannerHeading: 'Day planner', imported: true },
  },
  files: {
    [`${day(-2)}.md`]: plan(['- [x] 09:00 - 09:30 Зарядка', '- [x] 10:00 - 12:00 Отчёт для клиента', '- [x] 19:00 - 20:00 Английский']),
    [`${day(-1)}.md`]: plan(['- [x] 08:30 - 09:00 Пробежка', '- [x] 11:00 - 11:30 Созвон с командой', '- [ ] 15:00 - 16:00 Разобрать почту', '- [x] 21:00 - 21:20 Чтение']),
    [`${day()}.md`]: plan([
      `- [x] 08:00 - 08:30 Кофе и план на день`,
      `- [x] 09:00 - 10:30 Макет главной страницы`,
      `- [ ] ${at(-75)} - ${at(-60)} Позвонить в банк`,
      `- [ ] ${at(-45)} - ${at(-30)} Витамины`,
      `- [ ] ${at(-25)} - ${at(-15)} Ответить Марине`,
      `- [ ] ${at(-10)} - ${at(10)} Ревью пулл-реквестов`,
      `- [ ] 20:00 - 21:00 Тренировка`,
      '- [ ] Купить продукты',
    ]),
    [`${day(1)}.md`]: plan(['- [ ] 10:00 - 11:00 Встреча с дизайнером', '- [ ] 14:00 - 15:30 Подготовить презентацию', '- [ ] 19:30 - 21:00 Кино']),
    [`${day(2)}.md`]: plan(['- [ ] 09:00 - 09:20 Стендап', '- [ ] 12:00 - 13:00 Обед с Олегом', '- [ ] 16:00 - 18:00 Релиз 2.4']),
    [`${day(4)}.md`]: plan(['- [ ] 11:00 - 12:00 Стоматолог', '- [ ] 18:00 - 19:00 Йога']),
    'Проекты/Сайт.md': `# Сайт\n\n- [ ] Собрать отзывы клиентов 📅 ${day(1)}\n- [ ] Перевести главную на английский 📅 ${day(3)} ⏫\n- [ ] Обновить фотографии команды 📅 ${day(6)}\n- [x] Новый логотип ✅ ${day(-3)} 📅 ${day(-3)}\n`,
    'Проекты/Дом.md': `# Дом\n\n- [ ] Оплатить интернет 📅 ${day()} ⏰ ${day()} ${at(-90)}\n- [ ] Записать машину на ТО 📅 ${day(5)}\n- [ ] Купить лампу в коридор 📅 ${day(8)}\n`,
    'Входящие.md': '# Входящие\n\n- [ ] Посмотреть доклад про CRDT\n- [ ] Идеи для отпуска\n',
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  const dir = process.env.FLINT_DOCS
  if (!dir) return ok('pictures for the README are made only when asked', true)
  const shot = (name) => page.screenshot({ path: path.join(dir, name) })
  const alert = page.locator('.task-alert[open]')
  await alert.waitFor({ timeout: 20000 })
  await wait(1500)
  await shot('reminders-alert.png')
  // "Do not disturb" takes the alert away and leaves every reminder in its list.
  await page.evaluate(() => {
    app.commands.run('tasks:mute-hour')
    app.commands.run('core:toggle-right-sidebar')
  })
  await wait(800)

  await page.evaluate(() => app.commands.run('core:panel-tab:calendar'))
  await page.locator(`${t.leaf} .board`).waitFor()
  await wait(1200)
  await shot('calendar.png')

  await page.evaluate(() => app.commands.run('core:panel-tab:day-planner'))
  const planner = page.locator(`${t.leaf} .day-plan`)
  await planner.waitFor()
  await planner.locator('.day-plan-modes [role=tab]', { hasText: 'Неделя' }).click()
  await wait(1200)
  await shot('day-planner.png')

  await page.evaluate(() => app.commands.run('core:panel-tab:reminders'))
  await page.locator(`${t.leaf} .reminders-panel`).waitFor()
  await wait(1000)
  await shot('reminders.png')
  ok('pictures made', true)
}
