// The task plugin must use the desktop bridge even when web notifications are denied.
import { day } from '../helpers.mjs'

export const vault = {
  plugins: ['tasks'],
  settings: { tasks: { sound: false, alertStyle: 'banner', system: true } },
  files: { 'Reminder.md': `- [ ] Desktop delivery ⏰ ${day(-1)} 12:00\n` },
}

export async function afterStart({ page }) {
  await page.addInitScript(() => {
    window.deliveries = []
    window.flintDesktop = {
      setTitleBarColors() {}, onFlush() {}, onCommand() {}, show() {},
      autostart: async () => ({ enabled: false }),
      setReminders: (value) => window.deliveries.push(value),
      onReminderTick: (check) => {
        window.reminderTick = check
        return () => { window.reminderTick = undefined }
      },
      onReminderClick: (open) => {
        window.reminderClick = open
        return () => { window.reminderClick = undefined }
      },
    }
    window.webNotificationCalls = 0
    window.Notification = class {
      static permission = 'denied'
      static requestPermission() { throw new Error('Desktop must not request web permission') }
      constructor() { window.webNotificationCalls++ }
    }
  })
}

export async function run(t) {
  const { page, ok } = t
  await page.waitForSelector('.task-alert.banner[open]')
  const first = await page.evaluate(() => window.deliveries.find((one) => one.items.length))
  ok('desktop delivery works without browser notification permission', first?.system && first.items.length === 1 && first.items[0].body.includes('Desktop delivery'))
  ok('native delivery does not also create a web notification', await page.evaluate(() => window.webNotificationCalls === 0))

  await page.evaluate(() => app.settings.set('tasks', 'system', false))
  ok('switching to the app window reaches the desktop bridge immediately', await page.evaluate(() => window.deliveries.at(-1).system === false && window.deliveries.at(-1).items.length === 1))
  await page.evaluate(() => app.settings.set('tasks', 'system', true))
  ok('switching native notifications on needs no browser permission prompt', await page.evaluate(() => window.deliveries.at(-1).system === true))

  await page.evaluate(() => {
    app.settings.set('tasks', 'muteUntil', Date.now() + 3_600_000)
  })
  ok('muting clears the native queue', await page.evaluate(() => window.deliveries.at(-1).items.length === 0) && (await t.count('.task-alert')) === 0)
  // Simulate the stored quiet period ending while the app is hidden, without a store change.
  await page.evaluate(() => {
    const get = app.settings.get.bind(app.settings)
    app.settings.get = (scope, key) => scope === 'tasks' && key === 'muteUntil' ? 0 : get(scope, key)
    window.reminderTick()
    app.settings.get = get
  })
  await page.waitForSelector('.task-alert.banner[open]')
  ok('the desktop clock checks reminders without renderer timers or vault changes', await page.evaluate(() => window.deliveries.at(-1).items.length === 1))

  await page.evaluate(() => window.reminderClick(window.deliveries.at(-1).items[0].key))
  await page.waitForSelector('.cm-content')
  ok('clicking the native notification opens the note and closes its reminder', (await t.activeTab()) === 'Reminder' && (await t.count('.task-alert')) === 0 && await page.evaluate(() => window.deliveries.at(-1).items.length === 0))
}
