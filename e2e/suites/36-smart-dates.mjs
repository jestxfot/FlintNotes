// Dates among the properties say what they mean today: an age and the next birthday, what is left until a deadline, how long ago.
import { day } from '../helpers.mjs'

/** The same day of the year `years` ago, shifted by `offset` days: a birthday that comes round in `-offset`... days. */
const yearsAgo = (years, offset = 0) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  d.setDate(d.getDate() + offset)
  // The day where the app lives (the runner sets it), not in UTC: after midnight in Moscow UTC is still on the day before.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const vault = {
  plugins: ['properties', 'dataview', 'tasks', 'links'],
  files: {
    'Варюша.md': `---\nдень рождения: ${yearsAgo(17, 3)}\nсрок: ${day(-2)}\nвстреча: ${day(20)}\nзаметка: просто текст\n---\n\nВарюше \`= (date(today) - this["день рождения"]).years\` лет.\n\n- [ ] Поздравить [[Варюша]], \`= (date(today) - date(${yearsAgo(17, 3)})).years\` лет 📅 ${day(3)}\n\nend\n`,
    'Друзья.md': 'Позвать [[Варюша]] и [[Никто]].\n\n\`\`\`tasks\nnot done\n\`\`\`\n\nend\n',
    'Никто.md': '---\nсоздано: 2020-01-01\n---\n',
    // A year that is not known is written as a placeholder, or not at all.
    'Без года.md': `---\nдень рождения: 1000-${day(40).slice(5)}\n---\n`,
    'Только день.md': `---\nbirthday: ${Number(day(200).slice(8))} ${['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][Number(day(200).slice(5, 7)) - 1]}\n---\n`,
    'Слова.md': 'ДР Айтац и день рождения Миши, а также и др. слова.\n\nПозвать [[Без года]] и [[Только день]].\n\nend\n',
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
  // The planner and the reminders draw task text outside the editor: the words stand out there too.

  // The days left are always written, however far the birthday is; a quiet cake then, a bright one when it is near.
  await t.open('Слова')
  await t.cursorToEnd()
  await wait(1000)
  const words = page.locator(`${t.leaf} .cm-content .word-birthday`)
  ok('the words «ДР» and «день рождения» stand out, while «др.» does not', (await words.allInnerTexts()).join('|') === 'ДР|день рождения', await words.allInnerTexts())
  const many = page.locator(`${t.leaf} .cm-content .link-badge`)
  const texts = await many.allInnerTexts()
  ok('a birthday of an unknown year says the days left and no age', texts[0] === '🎂 через 40 дней' && !/лет/.test(texts[0]), texts.join('|'))
  ok('so does one written as «11 октября»', texts[1] === '🎂 через 200 дней', texts.join('|'))
  ok('a far birthday is quiet, with no tone', (await many.first().getAttribute('data-tone')) === null)
  await t.open('Друзья')
  await t.cursorToEnd()
  await wait(1000)
  const drawn = await page.evaluate(() => {
    const box = document.createElement('div')
    box.append(flint.renderInline(app, 'ДР Айтац, [[Варюша]] ДР и т. др.', ''))
    return { marked: [...box.querySelectorAll('.word-birthday')].map((e) => e.textContent), badges: [...box.querySelectorAll('.link-badge')].map((e) => e.textContent) }
  })
  ok('outside the editor (the planner, reminders) the word stands out and the link has its cake', drawn.marked.join('|') === 'ДР|ДР' && drawn.badges.length === 1 && /через 3 дня/.test(drawn.badges[0]), JSON.stringify(drawn))
  ok('and for Варюша it is the days left too', (await badges.first().innerText()).includes('через 3 дня'))
}
