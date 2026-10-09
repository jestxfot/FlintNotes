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
  ok('the task form opens with the task in it', (await page.locator('dialog textarea').inputValue()) === 'Buy milk #home' && (await page.locator('dialog input[type=radio]:checked').inputValue()) === '3')
  await page.locator('dialog textarea').fill('Buy oat milk #home')
  await page.locator('dialog .level', { hasText: 'Высокий' }).locator('input').check()
  await page.locator('dialog button.primary').click()
  await wait(1500)
  ok('the edit form rewrites the task line', read('Home.md').includes(`- [ ] Buy oat milk #home ⏫ 📅 ${day(10)}`), read('Home.md'))

  await page.locator(`${leaf} .cm-content`).click({ position: { x: 5, y: 5 } })
  await t.cursorToEnd()
  await wait(200)
  await page.keyboard.press('Alt+t')
  await wait(300)
  await page.locator('dialog textarea').fill('Brand new task')
  // A date is typed in words: "+3d" and a space.
  await page.locator('dialog #task-due').pressSequentially('+3d ')
  ok('a date typed in words lands in the date field', (await page.locator('dialog .row:has(#task-due) input[type=date]').inputValue()) === day(3))
  await page.locator('dialog #task-scheduled').fill('tm')
  await page.locator('dialog #task-status').selectOption('/')
  await page.locator('dialog button.primary').click()
  await wait(1200)
  ok('a new task goes into the open note', read('Query.md').includes(`- [/] Brand new task ⏳ ${day(1)} 📅 ${day(3)}`) || read('Query.md').includes(`- [/] Brand new task 📅 ${day(3)} ⏳ ${day(1)}`), read('Query.md').slice(-80))

  await t.open('Work')
  const noDate = page.locator(`${leaf} .cm-line`, { hasText: 'No date task' }).locator('.lp-checkbox')
  await noDate.click()
  await wait(1200)
  ok('ticking in the editor stamps the done date', read('Work.md').includes(`- [x] No date task 🔽 ✅ ${today}`), read('Work.md'))
  await noDate.click()
  await wait(1200)
  ok('unticking removes it', read('Work.md').includes('- [ ] No date task 🔽\n'), read('Work.md'))

  // ---- "after this" and "before this": tasks are found by their words, the ids are written for the user
  await t.open('Query')
  await wait(400)
  const edit = async (name) => {
    const row = page.locator(`${leaf} .tasks-block`).nth(0).locator('.task-row', { hasText: name })
    await row.hover()
    await row.locator('.task-edit').click()
    await wait(300)
  }
  await edit('Write report')
  await page.locator('dialog #task-after').fill('water')
  ok('typing in "after this" finds tasks by their words', (await page.locator('dialog .found-task').count()) === 1 && (await page.locator('dialog .found-task').innerText()).includes('Water plants'), await page.locator('dialog .found').innerText().catch(() => 'no list'))
  await page.locator('dialog .found-task').click()
  await page.locator('dialog #task-before').fill('buy')
  await page.keyboard.press('Enter')
  ok('chosen tasks are listed in the form', (await page.locator('dialog .linked').count()) === 2, await page.locator('dialog .linked').count())
  await page.locator('dialog button.primary').click()
  await wait(1500)
  const report = /Write report.*/.exec(read('Work.md'))?.[0] ?? ''
  const made = /🆔 ([a-z0-9]{6})/.exec(report)?.[1]
  ok('the task waits for the one chosen, by its id', report.includes('⛔ abc123') && !!made, report)
  ok('and the task chosen as later waits for this one', !!made && read('Home.md').includes(`⛔ ${made}`), read('Home.md'))
  await edit('Write report')
  ok('the form shows the links again', (await page.locator('dialog .linked').count()) === 2 && (await page.locator('dialog .row:has(#task-before) .linked').innerText()).includes('Buy'), await page.locator('dialog .linked').count())
  await page.locator('dialog .row:has(#task-before) .unlink').click()
  await page.locator('dialog button.primary').click()
  await wait(1500)
  ok('removing a link takes the id out of the other task', !read('Home.md').includes('⛔'), read('Home.md'))

  // ---- an ordinary line with (@date time) reminds too
  const now = new Date(Date.now() - 60_000)
  const pad = (n) => String(n).padStart(2, '0')
  const moment = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  t.write('Plain.md', `# Notes\n\nCall the dentist (@${moment})\n`)
  await page.waitForSelector('.task-alert[open]', { timeout: 20000 }).catch(() => {})
  const plain = page.locator('.task-alert .alert-task', { hasText: 'Call the dentist' })
  ok('a line without a checkbox reminds as well', (await plain.count()) === 1 && !(await plain.innerText()).includes('(@'), await page.locator('.task-alert').innerText().catch(() => 'no alert'))
  ok('and is not a task in the lists', !(await page.locator(`${leaf} .tasks-block`).nth(0).innerText()).includes('dentist'))
  await plain.locator('button', { hasText: 'Завтра' }).click()
  await wait(1500)
  ok('"later" rewrites the time in that line', /Call the dentist \(@\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)/.test(read('Plain.md')) && !read('Plain.md').includes(moment), read('Plain.md'))
  ok('and the alert goes', (await t.count('.task-alert')) === 0)
}
