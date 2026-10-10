// Many reminders at once: a list to go through, a line for each, with actions for all of them.
import { day } from '../helpers.mjs'

const today = day()
const pad = (n) => String(n).padStart(2, '0')
const at = (minutes) => {
  const d = new Date(Date.now() + minutes * 60_000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const room = new Date().getHours() >= 2
export const viewport = { width: 1500, height: 950 }
export const vault = {
  plugins: ['tasks'],
  settings: { tasks: { sound: false } },
  files: {
    'Work.md': `- [ ] Alpha ⏰ ${today} ${at(-50)}\n- [ ] Beta ⏰ ${today} ${at(-40)}\n- [ ] Gamma ⏰ ${today} ${at(-30)}\n- [ ] Delta ⏰ ${today} ${at(-20)}\n- [ ] Old one ⏰ ${day(-1)} 09:00\nA plain line (@${today} ${at(-10)})\n`,
  },
}

export async function run(t) {
  const { page, ok, wait, read } = t
  if (!room) return ok('skipped just after midnight', true)
  const alert = page.locator('.task-alert[open]')
  await alert.waitFor({ timeout: 20000 }).catch(() => {})
  await wait(600)
  const rows = alert.locator('.alert-task')
  ok('many reminders come as one list, a line for each', (await alert.getAttribute('class')).includes('many') && (await rows.count()) === 6 && (await alert.locator('h1').innerText()).includes('6'))
  const heights = await rows.evaluateAll((list) => list.map((el) => Math.round(el.getBoundingClientRect().height)))
  ok('the lines are short, all of them on the screen', Math.max(...heights) < 60 && (await rows.last().isVisible()), JSON.stringify(heights))
  ok('the days stand apart, with how many each has', (await alert.locator('.alert-list h2').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim()).join('|') === 'ВЧЕРА 1|СЕГОДНЯ 5' || (await alert.locator('.alert-list h2').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim().toLowerCase()).join('|') === 'вчера 1|сегодня 5', (await alert.locator('.alert-list h2').allInnerTexts()).join('|'))
  await page.screenshot({ path: process.env.FLINT_SHOT ?? '/dev/null' }).catch(() => {})
  await rows.filter({ hasText: 'Alpha' }).locator('button[title="Выполнено"]').click()
  await wait(1300)
  ok('one is done from its line', /- \[x\] Alpha/.test(read('Work.md')) && (await rows.count()) === 5, read('Work.md'))
  await rows.filter({ hasText: 'Beta' }).locator('button[title="Напомнить позже"]').click()
  const choices = alert.locator('.alert-list .alert-choices button')
  ok('"later" opens its choices under the line', (await choices.count()) > 1)
  await choices.first().click()
  await wait(1300)
  ok('and puts that one off', (await rows.count()) === 4 && !(await t.flat(alert)).includes('Beta'), await t.flat(alert))
  await alert.locator('.alert-bar button', { hasText: 'Выполнить все' }).click()
  await wait(2500)
  const text = read('Work.md')
  ok('all the rest are done at once, each on its own line', (await page.locator('.task-alert').count()) === 0 && /- \[x\] Gamma/.test(text) && /- \[x\] Delta/.test(text) && /- \[x\] Old one/.test(text) && /- \[ \] Beta/.test(text) && text.includes('A plain line'), text)
}
