// The app keeps Moscow time whatever zone the computer or browser is in (the runner puts the browser in New York).
import { day } from '../helpers.mjs'

export const vault = {
  plugins: ['tasks'],
  settings: { tasks: { remindDue: false, alertStyle: 'banner', sound: false } },
  files: { 'Plan.md': `- [ ] Today thing 📅 ${day(0)}\n- [ ] Tomorrow thing 📅 ${day(1)}\n\nend\n` },
}

export async function run(t) {
  const { page, ok, wait } = t
  const moscow = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
  const before = moscow()
  const seen = await page.evaluate(() => {
    const d = new Date()
    return {
      offset: d.getTimezoneOffset(),
      moment: moment().format('YYYY-MM-DD HH:mm'),
      clock: d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
      intl: new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(d),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      fields: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      parsed: new Date('2026-10-31T14:00').toISOString(),
      built: new Date(2026, 9, 31, 14).toISOString(),
      utc: new Date('2026-10-31T14:00:00Z').toISOString(),
    }
  })
  const after = moscow()
  const near = (value) => value === before || value === after
  // A fresh frame has the browser's own Date, which the app's patch has not touched.
  const own = await page.evaluate(() => {
    const frame = document.body.appendChild(document.createElement('iframe'))
    const offset = new frame.contentWindow.Date().getTimezoneOffset()
    frame.remove()
    return offset
  })
  ok('the browser itself is not in Moscow time', own !== -180, String(own))
  ok('getTimezoneOffset says Moscow', seen.offset === -180, String(seen.offset))
  ok('getHours() and friends are Moscow wall-clock time', near(seen.fields), `${seen.fields} vs ${before}`)
  ok('moment() is Moscow time', near(seen.moment), `${seen.moment} vs ${before}`)
  ok('toLocaleTimeString and Intl show Moscow time', seen.clock === before.slice(11) || seen.clock === after.slice(11), `${seen.clock} ${seen.intl} vs ${before}`)
  ok('Intl reports a +03:00 zone', seen.zone === 'Etc/GMT-3', seen.zone)
  ok('a time without a zone is read in Moscow', seen.parsed === '2026-10-31T11:00:00.000Z' && seen.built === '2026-10-31T11:00:00.000Z', `${seen.parsed} ${seen.built}`)
  ok('a time with Z stays what it says', seen.utc === '2026-10-31T14:00:00.000Z', seen.utc)

  // A task due "today" is not late and one due tomorrow is "tomorrow", by Moscow's calendar.
  await t.open('Plan')
  await wait(500)
  const chips = await page.locator(`${t.leaf} .cm-content .lp-days-left`).allInnerTexts()
  ok('tasks count days from Moscow today', chips.length === 2 && chips[1] === 'завтра' && !/просрочено/.test(chips[0]), chips.join('|'))
}
