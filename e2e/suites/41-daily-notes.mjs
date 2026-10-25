// The daily note has a plugin of its own. A vault set up when its settings were the calendar's
// keeps working: they move over, the plugin is switched on, buttons for the old commands follow.
import { day } from '../helpers.mjs'

const today = day()
const where = (date) => `Days/${date.slice(0, 7)}/${date}.md`

export const viewport = { width: 1400, height: 900 }
export const vault = {
  plugins: ['calendar', 'commander'],
  settings: {
    calendar: { imported: true, confirm: true, dailyFormat: 'YYYY-MM/YYYY-MM-DD', dailyFolder: 'Days', dailyTemplate: 'T', openOnStart: true },
  },
  files: {
    '.flint/commander.json': JSON.stringify({ leftRibbon: [{ id: 'calendar:today', icon: 'lucide-calendar-days', name: 'Day', mode: 'any' }], macros: [{ name: 'M', icon: 'x', macro: [{ action: 0, commandId: 'calendar:next-day' }] }] }),
    'T.md': '# {{title}}\n\nfrom the template\n',
    'Note.md': '# Note\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read, exists } = t
  const settings = () => JSON.parse(read('.flint/settings.json'))
  await page.waitForSelector('.calendar')
  await wait(1200)

  const saved = settings()
  ok('the daily note settings moved from the calendar to the new plugin', saved['daily-notes']?.format === 'YYYY-MM/YYYY-MM-DD' && saved['daily-notes'].folder === 'Days' && saved['daily-notes'].template === 'T' && saved['daily-notes'].openOnStart === true, JSON.stringify(saved['daily-notes']))
  ok('the calendar keeps none of them', !['dailyFormat', 'dailyFolder', 'dailyTemplate', 'openOnStart'].some((key) => key in saved.calendar) && saved.calendar.confirm === true, JSON.stringify(saved.calendar))
  ok('the daily notes plugin is switched on and stays on', saved.core.enabledPlugins.includes('daily-notes') && saved.core.enabledPlugins.includes('calendar'), saved.core.enabledPlugins.join())
  ok('it is a plugin of its own in the settings', await page.evaluate(() => app.settings.listSections().some((s) => s.id === 'daily-notes' && s.defs.some((d) => d.key === 'openOnStart')) && !app.settings.listSections().find((s) => s.id === 'calendar').defs.some((d) => d.key.startsWith('daily') || d.key === 'openOnStart')))
  ok("today's note is made at start, where it was before, from its template", exists(where(today)) && read(where(today)).includes('from the template') && (await t.activeTab()) === today, await t.activeTab().catch(() => 'no tab'))

  const commander = JSON.parse(read('.flint/commander.json'))
  ok('buttons and macros made for the old commands follow them', commander.leftRibbon[0].id === 'daily-notes:today' && commander.macros[0].macro[0].commandId === 'daily-notes:next-day', JSON.stringify(commander))
  ok('the old command ids are gone, the new ones are there', await page.evaluate(() => !app.commands.get('calendar:today') && ['today', 'tomorrow', 'yesterday', 'next-day', 'previous-day'].every((id) => app.commands.get(`daily-notes:${id}`))))

  await t.open('Note')
  await page.keyboard.press('Alt+d')
  await wait(500)
  ok('Alt+D opens the note of today', (await t.activeTab()) === today)
  await page.evaluate(() => app.commands.run('daily-notes:next-day'))
  await wait(800)
  ok('the next day from a daily note is made without a question', exists(where(day(1))) && (await t.activeTab()) === day(1))
  await page.evaluate(() => app.settings.set('daily-notes', 'confirm', true))
  // The runner accepts every dialog; the question is answered here instead.
  await page.evaluate(() => ((window.asked = []), (window.confirm = (message) => (window.asked.push(message), false))))
  await page.evaluate(() => app.commands.run('daily-notes:next-day'))
  await wait(500)
  const asked = await page.evaluate(() => window.asked.join('|'))
  ok('with the setting on, a missing day is asked about, and a no makes nothing', asked.includes(day(2)) && !exists(where(day(2))) && (await t.activeTab()) === day(1), asked)
  await page.evaluate(() => app.commands.run('daily-notes:previous-day'))
  await wait(500)
  ok('a day that exists opens without a question', (await page.evaluate(() => window.asked.length)) === 1 && (await t.activeTab()) === today)
  await page.evaluate(() => app.settings.set('daily-notes', 'confirm', false))
  const cell = page.locator(`.calendar .day[data-date="${today}"]`)
  ok('the calendar knows the open note for its day by the new settings', (await cell.getAttribute('class')).includes('active'), await cell.getAttribute('class'))

  // Off, the calendar still has days: Obsidian's defaults, at the root.
  await page.evaluate(() => app.plugins.disable('daily-notes'))
  await wait(300)
  const fallback = await page.evaluate(() => {
    const days = app.services.get('periodic-notes')
    return [days.dateOf('daily', '2026-03-04.md')?.format('YYYY-MM-DD'), days.dateOf('daily', 'Days/2026-03/2026-03-04.md')?.format('YYYY-MM-DD') ?? null].join()
  })
  ok('with the plugin off, the calendar falls back to plain days at the root', fallback === '2026-03-04,', fallback)
  await wait(500)
  ok('switched off by hand, it stays off', !settings().core.enabledPlugins.includes('daily-notes'), settings().core.enabledPlugins.join())
}
