// Tasks: ```tasks queries over the vault, completing with recurrence, the task form, fullscreen reminders.
import { day } from '../helpers.mjs'

const today = day()
export const vault = {
  plugins: ['tasks'],
  // Reminders for due dates fire at midnight, so the test does not depend on the time of day.
  settings: { tasks: { defaultTime: '00:00' } },
  files: {
    'Work.md': `# Work\n\n## Today\n- [ ] Write report 📅 ${today} ⏫ #work\n- [ ] Call client 📅 ${day(1)} #work\n- [x] Old thing ✅ 2026-01-01\n- [ ] Water plants 🔁 every week 📅 ${day(-1)} 🆔 abc123\n- [ ] No date task 🔽\n\n\`\`\`\n- [ ] not a task\n\`\`\`\n`,
    'Home.md': `- [ ] Buy milk 📅 ${day(10)} #home\n- [ ] Ping ⏰ ${today} 00:01\n`,
    'Query.md':
      '# Queries\n\n```tasks\nnot done\ngroup by due\n```\n\n```tasks\nwhere tags.contains("work") && due <= today() + "1d"\nsort by priority\nhide backlink\nbogus instruction\n```\n\n```tasks\n(due today) OR (priority is low)\npath includes Work\nlimit 5\nhide task count\n```\n\nend\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read, leaf } = t

  await page.waitForSelector('.task-alert[open]', { timeout: 8000 }).catch(() => {})
  const alert = page.locator('.task-alert')
  ok('fullscreen alert appears', (await alert.count()) === 1 && (await alert.getAttribute('data-count')) === '3', await alert.getAttribute('data-count').catch(() => 'none'))
  const box = await alert.boundingBox()
  ok('alert covers the whole screen', box?.width === 1300 && box?.height === 1000, JSON.stringify(box))
  let text = await alert.innerText()
  ok('alert lists the due tasks', text.includes('Ping') && text.includes('Write report') && text.includes('Water plants') && text.includes('Напоминания: 3'), text.slice(0, 200))
  await page.keyboard.press('Escape')
  await wait(300)
  ok('Escape does not dismiss the alert', (await t.count('.task-alert[open]')) === 1)
  await wait(1200)
  ok('sound signal is running', Number(await alert.getAttribute('data-beeps')) >= 1, await alert.getAttribute('data-beeps'))

  const item = (name) => alert.locator('.alert-task', { hasText: name })
  await item('Ping').locator('button', { hasText: 'Через 10 минут' }).click()
  await wait(600)
  ok('snooze removes the task for now', (await alert.getAttribute('data-count')) === '2')
  await item('Water plants').locator('button', { hasText: 'Выполнено' }).click()
  await wait(1500)
  ok(
    'done from the alert completes and repeats the task',
    read('Work.md').includes(`- [ ] Water plants 🔁 every week 📅 ${day(6)} 🆔 abc123\n- [x] Water plants 🔁 every week 📅 ${day(-1)} ✅ ${today} 🆔 abc123`),
    read('Work.md'),
  )
  ok('one reminder left', (await alert.getAttribute('data-count')) === '1', await alert.getAttribute('data-count'))
  await item('Write report').locator('button', { hasText: 'Закрыть' }).click()
  await wait(600)
  ok('alert closes when all are handled', (await t.count('.task-alert')) === 0 && (await page.title()) === 'FlintNotes', await page.title())
  await page.reload()
  await page.waitForSelector('.tree .row')
  await wait(2500)
  ok('handled reminders do not come back after reload', (await t.count('.task-alert')) === 0)

  await t.open('Query')
  await wait(400)
  const blocks = page.locator(`${leaf} .tasks-block`)
  ok('three task blocks rendered', (await blocks.count()) === 3, await blocks.count())
  text = await blocks.nth(0).innerText()
  ok('query spans the vault, skips done tasks and code', ['Write report', 'Call client', 'Water plants', 'No date task', 'Buy milk', 'Ping'].every((name) => text.includes(name)) && !text.includes('Old thing') && !text.includes('not a task'), text)
  ok('grouped by due with headings', text.toUpperCase().includes('СЕГОДНЯ') && text.toUpperCase().includes('БЕЗ СРОКА') && /6 задач/.test(text), text)
  text = await blocks.nth(1).innerText()
  ok('where-expression, sort and hide', /Write report[\s\S]*Call client/.test(text) && !text.includes('Buy milk') && !text.includes('Work ›') && /2 задачи/.test(text), text)
  ok('a bad line is reported, the rest still works', text.includes('bogus instruction'))
  text = await blocks.nth(2).innerText()
  ok('boolean condition with brackets', text.includes('Write report') && text.includes('No date task') && !text.includes('Call client') && !text.includes('задач'), text)

  await blocks.nth(1).locator('.task-row', { hasText: 'Call client' }).locator('input').click()
  await wait(1500)
  ok('ticking in a list edits the note', read('Work.md').includes(`- [x] Call client #work 📅 ${day(1)} ✅ ${today}`), read('Work.md'))
  ok('lists refresh after the edit', /5 задач/.test(await blocks.nth(0).innerText()) && (await blocks.nth(1).locator('.task-row.done').count()) === 1, await blocks.nth(0).innerText())

  await blocks.nth(0).locator('.task-row', { hasText: 'Buy milk' }).hover()
  await blocks.nth(0).locator('.task-row', { hasText: 'Buy milk' }).locator('.task-edit').click()
  await wait(300)
  await page.locator('dialog input.wide').fill('Buy oat milk #home')
  await page.locator('dialog select').selectOption('1')
  await page.locator('dialog button.primary').click()
  await wait(1500)
  ok('the edit form rewrites the task line', read('Home.md').includes(`- [ ] Buy oat milk #home ⏫ 📅 ${day(10)}`), read('Home.md'))

  await page.locator(`${leaf} .cm-content`).click({ position: { x: 5, y: 5 } })
  await t.cursorToEnd()
  await wait(200)
  await page.keyboard.press('Alt+t')
  await wait(300)
  await page.locator('dialog input.wide').fill('Brand new task')
  await page.locator('dialog input[type=date]').first().fill(day(3))
  await page.keyboard.press('Enter')
  await wait(1200)
  ok('a new task goes into the open note', read('Query.md').includes(`- [ ] Brand new task 📅 ${day(3)}`), read('Query.md').slice(-80))

  await t.open('Work')
  const noDate = page.locator(`${leaf} .cm-line`, { hasText: 'No date task' }).locator('.lp-checkbox')
  await noDate.click()
  await wait(1200)
  ok('ticking in the editor stamps the done date', read('Work.md').includes(`- [x] No date task 🔽 ✅ ${today}`), read('Work.md'))
  await noDate.click()
  await wait(1200)
  ok('unticking removes it', read('Work.md').includes('- [ ] No date task 🔽\n'), read('Work.md'))
}
