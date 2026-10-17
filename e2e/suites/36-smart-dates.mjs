// Dates among the properties say what they mean today: an age and the next birthday, what is left until a deadline, how long ago.
import { day } from '../helpers.mjs'

/** The same day of the year `years` ago, shifted by `offset` days: a birthday that comes round in `-offset`... days. */
const yearsAgo = (years, offset = 0) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

export const vault = {
  plugins: ['properties', 'dataview', 'tasks', 'links'],
  files: {
    'Варюша.md': `---\nдень рождения: ${yearsAgo(17, 3)}\nсрок: ${day(-2)}\nвстреча: ${day(20)}\nзаметка: просто текст\n---\n\nВарюше \`= (date(today) - this["день рождения"]).years\` лет.\n\n- [ ] Поздравить [[Варюша]], \`= (date(today) - date(${yearsAgo(17, 3)})).years\` лет 📅 ${day(3)}\n\nend\n`,
    'Друзья.md': 'Позвать [[Варюша]] и [[Никто]].\n\n\`\`\`tasks\nnot done\n\`\`\`\n\nend\n',
    'Никто.md': '---\nсоздано: 2020-01-01\n---\n',
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  await t.open('Варюша')
  await t.cursorToEnd()
  await wait(800)
  const hint = (key) => page.locator(`${t.leaf} .props-row[data-key="${key}"] .props-hint`)
  const text = async (key) => ((await hint(key).count()) ? (await hint(key).innerText()).trim() : '(нет)')

  ok('a birthday shows the age and how soon the next one is', (await text('день рождения')) === '16 лет · через 3 дня исполнится 17 лет', await text('день рождения'))
  ok('and is marked as near', (await hint('день рождения').getAttribute('data-tone')) === 'soon')
  ok('a deadline that has passed says by how much, in red', (await text('срок')) === 'просрочено на 2 дня' && (await hint('срок').getAttribute('data-tone')) === 'late', await text('срок'))
  ok('any other date says how soon', (await text('встреча')) === 'через 20 дней', await text('встреча'))
  ok('text gets no hint', (await hint('заметка').count()) === 0)
  ok('the note itself is not changed', !t.read('Варюша.md').includes('лет ·'))

  // The meaning is chosen in the property's menu, for this name in every note.
  await page.locator(`${t.leaf} .props-row[data-key="встреча"] .props-icon`).click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Подсказка у даты' }).hover()
  await wait(300)
  await page.locator('.menu').nth(1).locator('button', { hasText: 'Годовщина' }).click()
  await wait(600)
  ok('a date can be made a deadline, an anniversary or nothing from its menu', /^через 20 дней исполнится|^0 лет/.test(await text('встреча')) || (await text('встреча')).includes('через 20 дней'), await text('встреча'))
  await page.locator(`${t.leaf} .props-row[data-key="встреча"] .props-icon`).click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Подсказка у даты' }).hover()
  await wait(300)
  await page.locator('.menu').nth(1).locator('button', { hasText: 'Срок' }).click()
  await wait(600)
  ok('as a deadline it says what is left', (await text('встреча')) === 'осталось 20 дней', await text('встреча'))
  const kept = JSON.parse(t.read('.flint/settings.json')).properties?.dateSenses
  ok('the choice is kept for the name, outside the note', kept?.['встреча'] === 'deadline' && !t.read('Варюша.md').includes('deadline'), JSON.stringify(kept))
  await page.locator(`${t.leaf} .props-row[data-key="встреча"] .props-icon`).click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Подсказка у даты' }).hover()
  await wait(300)
  await page.locator('.menu').nth(1).locator('button', { hasText: 'Без подсказки' }).click()
  await wait(600)
  ok('or have no hint at all', (await hint('встреча').count()) === 0)

  // In the text, an age counts itself the way Dataview counts it: whole years between two dates.
  const shown = await t.text()
  ok('an inline query gives an age in whole years', shown.includes('Варюше 16 лет') && /Поздравить.*, 16 лет/.test(shown), shown)
  // An edit of the note leaves the values where they are (the code's hidden backticks no longer win over them now and then).
  await page.evaluate(() => {
    const editor = app.workspace.activeEditor
    const at = editor.state.doc.toString().indexOf('Варюше')
    editor.dispatch({ changes: { from: at, insert: 'Итак. ' } })
  })
  await t.cursorToEnd()
  await wait(1500)
  const after = await t.text()
  ok('values stay after the note is edited', after.includes('Варюше 16 лет') && /Поздравить.*, 16 лет/.test(after), after)

  // Elsewhere: a mention of a person whose birthday is near stands out, and a task's text counts its value as in the note.
  await t.open('Друзья')
  await t.cursorToEnd()
  await wait(1200)
  const badges = page.locator(`${t.leaf} .cm-content .link-badge`)
  ok('a link to a person whose birthday is near carries a cake with the days left', (await badges.count()) >= 1 && (await badges.first().innerText()).includes('через 3 дня') && (await badges.first().getAttribute('data-tone')) === 'soon', await badges.allInnerTexts())
  ok('its tooltip says the date and the age to come', /исполнится 17 лет/.test((await badges.first().getAttribute('title')) ?? ''), await badges.first().getAttribute('title'))
  ok('a note without a birthday gets none', !(await t.text()).includes('Никто🎂'))
  const listed = await t.flat(page.locator(`${t.leaf} .cm-content`))
  ok('a task listed by a query shows its inline value, not the code', /Поздравить Варюша.*, 16 лет/.test(listed) && !listed.includes('= (date(today)'), listed)
  ok('and the mention in it carries the cake too', (await badges.count()) === 2, await badges.allInnerTexts())
}
