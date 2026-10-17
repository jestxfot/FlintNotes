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
  plugins: ['properties', 'dataview', 'tasks'],
  files: {
    'Варюша.md': `---\nдень рождения: ${yearsAgo(17, 3)}\nсрок: ${day(-2)}\nвстреча: ${day(20)}\nзаметка: просто текст\n---\n\nВарюше \`= (date(today) - this["день рождения"]).years\` лет.\n\n- [ ] Поздравить, \`= (date(today) - date(${yearsAgo(17, 3)})).years\` лет 📅 ${day(3)}\n\nend\n`,
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
  ok('an inline query gives an age in whole years', shown.includes('Варюше 16 лет') && shown.includes('Поздравить, 16 лет'), shown)
}
