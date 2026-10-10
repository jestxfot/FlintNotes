// The task manager: a tab over every task of the vault; tasks stay lines of Markdown in their notes.
import { day } from '../helpers.mjs'

const today = day()
export const viewport = { width: 1500, height: 950 }
export const vault = {
  plugins: ['tasks'],
  settings: { tasks: { remindDue: false, managerFile: 'Inbox.md' } },
  files: {
    'Work.md': `# Work\n\n- [ ] Write report 📅 ${today} ⏫ #work\n- [ ] Call client 📅 ${day(1)} #work\n- [ ] Old debt 📅 ${day(-3)}\n- [x] Shipped ✅ ${day(-1)}\n`,
    'Home.md': `- [ ] Buy milk #home\n- [ ] Fix tap 📅 ${day(4)} 🔽\n`,
  },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  await wait(1200)
  await page.keyboard.press('Alt+Shift+T')
  const manager = page.locator(`${t.leaf} .manager`)
  await manager.waitFor()
  const side = (name) => manager.locator('nav .side-item', { has: page.locator('.side-name', { hasText: new RegExp(`^${name}$`) }) })
  const rows = () => manager.locator('.task .what').allInnerTexts()
  const flat = (locator) => t.flat(locator)

  ok('the manager opens as a tab on today', (await t.activeTab()) === 'Задачи' && (await flat(manager.locator('h2'))) === 'Сегодня')
  ok('today holds what is due and what is overdue, the overdue apart', JSON.stringify(await rows()) === JSON.stringify(['Old debt', 'Write report #work']) && (await flat(manager.locator('.group.late'))).includes('Просрочено'), JSON.stringify(await rows()))
  ok('the lists are counted', (await flat(side('Сегодня'))).endsWith('2') && (await flat(side('Все задачи'))).endsWith('5') && (await flat(side('Без срока'))).endsWith('1') && (await flat(side('Work'))).endsWith('3') && (await flat(side('home'))).endsWith('1'), await flat(manager.locator('nav')))

  // ---- adding: one line, with the day and the priority in words
  await manager.locator('.add input').fill('Pay rent завтра !1')
  await manager.locator('.add input').press('Enter')
  await wait(1500)
  ok('a task typed in one line goes to the inbox note as a line of Markdown', read('Inbox.md') === `- [ ] Pay rent ⏫ 📅 ${day(1)}\n`, read('Inbox.md'))
  await manager.locator('.add input').fill('Stretch')
  await manager.locator('.add input').press('Enter')
  await wait(1500)
  ok('in "today" a task without a day is for today', read('Inbox.md').endsWith(`- [ ] Stretch 📅 ${today}\n`) && (await rows()).includes('Stretch'), read('Inbox.md'))
  await side('Home').click()
  await manager.locator('.add input').fill('Water plants')
  await manager.locator('.add input').press('Enter')
  await wait(1500)
  ok("in a note's list a new task goes into that note", read('Home.md').endsWith('- [ ] Water plants\n') && (await rows()).includes('Water plants'), read('Home.md'))

  // ---- ticking and the card
  await side('Все задачи').click()
  await manager.locator('.task', { hasText: 'Buy milk' }).locator('.tick').click()
  await wait(1500)
  ok('ticking completes the task in its note', read('Home.md').includes(`- [x] Buy milk #home ✅ ${today}`) && !(await rows()).some((row) => row.includes('Buy milk')), read('Home.md'))
  await manager.locator('.task', { hasText: 'Call client' }).click()
  const card = manager.locator('.card')
  await card.waitFor()
  ok('a click opens the card of the task', (await card.locator('.card-title').inputValue()) === 'Call client #work' && (await card.locator('input[type=date]').first().inputValue()) === day(1))
  await card.locator('.level.high').click()
  await wait(1200)
  await card.locator('.quick button', { hasText: 'Через неделю' }).click()
  await wait(1200)
  ok('the card changes priority and day in the note', read('Work.md').includes(`- [ ] Call client #work ⏫ 📅 ${day(7)}`), read('Work.md'))
  await card.locator('.card-title').fill('Call the client back #work')
  await card.locator('.card-title').press('Enter')
  await wait(1200)
  ok('and the text', read('Work.md').includes(`- [ ] Call the client back #work ⏫ 📅 ${day(7)}`) && (await card.locator('.card-title').inputValue()) === 'Call the client back #work', read('Work.md'))

  // ---- other lists and views
  await side('work').click()
  ok('a tag is a list', JSON.stringify((await rows()).sort()) === JSON.stringify(['Call the client back #work', 'Write report #work']), JSON.stringify(await rows()))
  await side('Выполненные').click()
  ok('what was done is listed by day', (await rows()).includes('Shipped') && (await rows()).includes('Buy milk #home') && (await flat(manager.locator('.group').first())).includes('Сегодня'), JSON.stringify(await rows()))
  await side('Все задачи').click()
  await manager.locator('select').selectOption('priority')
  await wait(300)
  ok('tasks can be put in order of priority', (await flat(manager.locator('.group').first())).includes('Высокий'), await flat(manager.locator('.group').first()))
  await manager.locator('.modes button[title="Календарём"]').click()
  await wait(500)
  ok('and shown as a calendar', (await manager.locator('.calendar').innerText()).includes('Write report'))
  await page.reload()
  await page.waitForSelector(`${t.leaf} .manager`)
  await wait(800)
  ok('the manager comes back as it was left', (await flat(manager.locator('h2'))) === 'Все задачи' && (await manager.locator('.calendar').count()) === 1)
}
