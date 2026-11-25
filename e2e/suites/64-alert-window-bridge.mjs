// The desktop app shows reminders in a window of its own: the notes page then sends the list and does what comes back.
import { day } from '../helpers.mjs'

export const vault = {
  plugins: ['tasks'],
  settings: { tasks: { sound: false, laterOptions: '10 минут\nЗавтра' } },
  files: {
    'Work.md': `- [ ] Plain one ⏰ ${day(-1)} 12:00\n- [ ] Urgent one ⏫ ⏰ ${day(-1)} 13:00\n`,
  },
}

export async function afterStart({ page }) {
  await page.addInitScript(() => {
    window.deliveries = []
    window.flintDesktop = {
      setTitleBarColors() {}, onFlush() {}, onCommand() {}, show() {},
      autostart: async () => ({ enabled: false }),
      setReminders: (value) => window.deliveries.push(value),
      onReminderTick: () => () => {},
      onReminderAction: (handler) => {
        window.sendAction = handler
        return () => { window.sendAction = undefined }
      },
    }
  })
}

export async function run(t) {
  const { page, ok, wait, read } = t
  await page.waitForFunction(() => window.deliveries.some((one) => one.model?.items.length === 2), null, { timeout: 15000 })
  const last = () => page.evaluate(() => window.deliveries.at(-1))
  const first = await last()
  ok('the page does not draw the card itself', (await t.count('.task-alert')) === 0)
  ok('it sends the list with text, colours and the choices of "later"', first.model.items.some((i) => i.html.includes('Plain one')) && first.model.later.length === 2 && !!first.model.theme['--accent'], JSON.stringify(first.model.later))
  ok('a priority task is marked, an ordinary one is not', first.model.items.find((i) => i.html.includes('Urgent one')).urgent === true && first.model.items.find((i) => i.html.includes('Plain one')).urgent === false)
  const key = (name) => first.model.items.find((i) => i.html.includes(name)).key
  await page.evaluate((k) => window.sendAction({ type: 'later', key: k, option: 0 }), key('Plain one'))
  await wait(1500)
  ok('"later" from the window puts that reminder off', (await last()).model.items.length === 1 || (await last()).items.length === 1)
  await page.evaluate((k) => window.sendAction({ type: 'done', key: k }), key('Urgent one'))
  await wait(1500)
  ok('"done" from the window completes the task in the note', /- \[x\] Urgent one/.test(read('Work.md')), read('Work.md'))
  ok('and nothing is left to show', (await last()).items.length === 0)
}
