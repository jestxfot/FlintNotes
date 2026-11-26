// Real Electron window + preload + task plugin, with only the external fullscreen query simulated.
// node e2e/desktop-reminder-check.mjs (as for desktop-check.mjs: a display, or headless where there is none)
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { _electron } from 'playwright'
import { buildVault, day, ROOT } from './helpers.mjs'
import { shellFlags, startShellServer } from './shell-server.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-desktop-reminders-'))
const out = path.join(dir, 'release')
const vault = path.join(dir, 'vault')
const fullscreen = path.join(dir, 'fullscreen')
const bin = path.join(dir, 'bin')
fs.mkdirSync(bin)
fs.mkdirSync(vault)
fs.writeFileSync(fullscreen, '1')
// Each query still goes through desktop/fullscreen.ts and a child process. The fixture affects
// this test app's PATH only; it never changes the window manager or the user's fullscreen state.
fs.writeFileSync(path.join(bin, 'xprop'), `#!${process.execPath}
const fs = require('node:fs');
console.log(process.argv.includes('-root') ? '_NET_ACTIVE_WINDOW(WINDOW): window id # 0x123' :
  '_NET_WM_STATE(ATOM) = ' + (fs.readFileSync(process.env.FLINT_TEST_FULLSCREEN, 'utf8').trim() === '1' ? '_NET_WM_STATE_FULLSCREEN' : ''));
`, { mode: 0o755 })
buildVault(vault, {
  plugins: ['tasks'],
  settings: { tasks: { sound: false, alertStyle: 'banner' } },
  files: { 'Reminder.md': `- [ ] Window delivery ⏰ ${day(-1)} 12:00\n` },
})

let app
let server
let passed = 0
const check = (name, condition) => {
  assert.ok(condition, name)
  passed++
  console.log(`✓ ${name}`)
}
const until = async (predicate, timeout = 15_000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) {
    if (await predicate()) return true
  }
  return false
}
try {
  execFileSync(process.execPath, ['scripts/release.mjs'], { cwd: ROOT, env: { ...process.env, FLINT_RELEASE_OUT: out }, stdio: 'pipe' })
  // The app is only a window: the vault, with its tasks, is served by the real server.
  server = await startShellServer({ release: out, vault, dir })
  const libs = process.env.FLINT_E2E_LIBS ?? path.join(os.homedir(), '.cache/flintnotes/gtk-libs')
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [...shellFlags(), path.join(out, 'desktop.mjs'), '--hidden'],
    env: {
      ...process.env, WAYLAND_DISPLAY: '', FLINT_WINDOW_DELAY: '1500', FLINT_SERVER_URL: server.link(),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, FLINT_TEST_FULLSCREEN: fullscreen,
      ...(fs.existsSync(libs) ? { LD_LIBRARY_PATH: [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}),
      FLINT_USER_DATA: path.join(dir, 'profile'), FLINT_AUTOSTART_DIR: path.join(dir, 'autostart'),
      FLINT_UPDATE_DELAY: '3600000',
    },
  })
  // Without a display (headless Chromium) a window never keeps always-on-top, so what the app asked for is recorded.
  await app.evaluate(({ BrowserWindow }) => {
    const set = BrowserWindow.prototype.setAlwaysOnTop
    BrowserWindow.prototype.setAlwaysOnTop = function (value, ...rest) { this.__asked = value; return set.call(this, value, ...rest) }
  })
  const page = await app.firstWindow()
  // The reminders live in a window of their own (desktop/pages/alert.html); the notes window stays where it is.
  const alertState = () => app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((one) => one.webContents.getURL().endsWith('/alert.html'))
    const main = BrowserWindow.getAllWindows().find((one) => !one.webContents.getURL().endsWith('/alert.html'))
    const area = screen.getPrimaryDisplay().workArea
    if (!window) return { exists: false, mainVisible: main.isVisible() }
    const bounds = window.getBounds()
    return { exists: true, visible: window.isVisible(), top: window.__asked === true, bounds, area, mainVisible: main.isVisible() }
  })
  const alertPage = () => app.windows().find((one) => one.url().endsWith('/alert.html'))
  await page.waitForTimeout(3000)
  let s = await alertState()
  check('fullscreen of another program keeps the reminders window away', !s.exists || !s.visible)

  fs.writeFileSync(fullscreen, '0')
  const delivered = await until(async () => (await alertState()).visible)
  if (!delivered) console.log({ state: await alertState(), log: fs.readFileSync(path.join(dir, 'profile', 'flintnotes.log'), 'utf8') })
  check('leaving fullscreen shows the reminders window', delivered)
  s = await alertState()
  check('it is above other windows', s.top === true)
  check('it is a window of its own: the notes window stays hidden', s.mainVisible === false)
  check('it sits in the bottom right corner of the main screen', s.bounds.x + s.bounds.width === s.area.x + s.area.width - 16 && s.bounds.y + s.bounds.height === s.area.y + s.area.height - 16, JSON.stringify(s))
  check('the card is drawn', await until(async () => !!alertPage() && (await alertPage().locator('.item').count()) === 1))
  check('it shows the task', (await alertPage().locator('.item').innerText()).includes('Window delivery'))
  if (process.env.FLINT_SHOT) {
    // The headless display is one pixel big, which squeezes the window; a real screen gives it room.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((one) => one.webContents.getURL().endsWith('/alert.html')).setBounds({ x: 0, y: 0, width: 420, height: 520 }))
    await page.waitForTimeout(500)
    await alertPage().screenshot({ path: process.env.FLINT_SHOT })
  }
  // Icons in a task's text come as bare SVG: without the page's own style they would fill the whole window.
  const icon = await alertPage().evaluate(() => {
    const host = document.querySelector('.item .text')
    host.insertAdjacentHTML('beforeend', '<span class="icon"><svg viewBox="0 0 24 24"><path d="M12 21C-4 8 6-2 12 6c6-8 16 2 0 15z"/></svg></span>')
    const box = host.querySelector('.icon svg').getBoundingClientRect()
    return { width: box.width, height: box.height, fill: getComputedStyle(host.querySelector('.icon svg')).fill }
  })
  check('an icon in the text stays a character wide and is drawn as lines', icon.width <= 24 && icon.height <= 24 && icon.fill === 'none', JSON.stringify(icon))
  check('it has no close button', (await alertPage().getByRole('button', { name: /Закрыть/ }).count()) === 0)

  fs.writeFileSync(fullscreen, '1')
  check('entering fullscreen puts the reminders window away', await until(async () => !(await alertState()).visible))
  fs.writeFileSync(fullscreen, '0')
  check('and it comes back when fullscreen ends', await until(async () => (await alertState()).visible))

  await alertPage().locator('.actions .slide').click()
  check('a click on the done slider does nothing', fs.readFileSync(path.join(vault, 'Reminder.md'), 'utf8').includes('- [ ] Window delivery'))
  await alertPage().waitForTimeout(500)
  const doneHandle = await alertPage().locator('.actions .slide .handle').boundingBox()
  const doneTrack = await alertPage().locator('.actions .slide').boundingBox()
  await alertPage().mouse.move(doneHandle.x + doneHandle.width / 2, doneHandle.y + doneHandle.height / 2)
  await alertPage().mouse.down()
  await alertPage().mouse.move(doneTrack.x + doneTrack.width - 4, doneHandle.y + doneHandle.height / 2, { steps: 10 })
  await alertPage().mouse.up()
  check('done in the reminders window completes the task in the note', await until(() => fs.readFileSync(path.join(vault, 'Reminder.md'), 'utf8').includes('- [x] Window delivery')))
  check('and the window goes when nothing is left', await until(async () => !(await alertState()).visible))

  fs.writeFileSync(path.join(vault, 'Another.md'), `- [ ] Priority one ⏫ ⏰ ${day(-1)} 13:00\n`)
  check('a new reminder brings the window back', await until(async () => (await alertState()).visible, 30_000))
  check('its card has the new task', await until(async () => (await alertPage().locator('.item').innerText()).includes('Priority one')))
  await alertPage().getByRole('button', { name: /Напомнить позже/ }).click()
  await alertPage().locator('.choices button').first().click()
  check('a priority task asks for a slide', (await alertPage().locator('.confirm .slide').count()) === 1)
  await alertPage().locator('.confirm .slide').click()
  check('a click on the slider changes nothing', (await alertState()).visible)
  const handle = await alertPage().locator('.confirm .slide .handle').boundingBox()
  const track = await alertPage().locator('.confirm .slide').boundingBox()
  await alertPage().mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await alertPage().mouse.down()
  await alertPage().mouse.move(track.x + track.width - 4, handle.y + handle.height / 2, { steps: 10 })
  await alertPage().mouse.up()
  check('sliding to the end puts it off and the window goes', await until(async () => !(await alertState()).visible))

  await page.evaluate(() => window.app.settings.set('tasks', 'muteUntil', Date.now() + 3_600_000))
  fs.writeFileSync(path.join(vault, 'More.md'), `- [ ] Quiet one ⏰ ${day(-1)} 14:00\n`)
  await page.waitForTimeout(3000)
  check('"do not disturb" keeps the window away', !(await alertState()).visible)

  console.log(`\nВсе ${passed} проверок прошли`)
} finally {
  await app?.close()
  server?.stop()
  fs.rmSync(dir, { recursive: true, force: true })
}
