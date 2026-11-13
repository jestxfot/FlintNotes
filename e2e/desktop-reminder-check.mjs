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
  const page = await app.firstWindow()
  const state = () => app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return { visible: window.isVisible(), top: window.isAlwaysOnTop() }
  })
  await page.waitForSelector('.task-alert.banner[open]', { state: 'attached' })
  await page.waitForTimeout(1500)
  check('the plugin renders its reminder while fullscreen keeps the real window hidden', !(await state()).visible && !(await state()).top)

  fs.writeFileSync(fullscreen, '0')
  const delivered = await until(async () => { const s = await state(); return s.visible && s.top })
  if (!delivered) console.log({ state: await state(), log: fs.readFileSync(path.join(dir, 'profile', 'flintnotes.log'), 'utf8') })
  check('leaving fullscreen shows the real app above other windows', delivered)
  fs.writeFileSync(fullscreen, '1')
  check('entering fullscreen removes always-on-top from the real app', await until(async () => !(await state()).top))

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  fs.writeFileSync(path.join(vault, 'Another.md'), `- [ ] Another reminder ⏰ ${day(-1)} 13:00\n`)
  // Playwright's default rAF polling pauses along with a hidden window's rendering.
  check('the hidden renderer receives a new reminder', await until(() => page.evaluate(() => document.querySelector('.task-alert')?.dataset.count === '2'), 30_000))
  await page.waitForTimeout(1200)
  check('a fresh reminder in the tray waits during fullscreen', !(await state()).visible)
  fs.writeFileSync(fullscreen, '0')
  check('the deferred reminder opens the real app after fullscreen ends', await until(async () => { const s = await state(); return s.visible && s.top }))

  await page.evaluate(() => window.app.settings.set('tasks', 'muteUntil', Date.now() + 3_600_000))
  check('muting removes the dialog and releases always-on-top', await until(async () => !(await state()).top && await page.locator('.task-alert').count() === 0))
  await app.evaluate(({ BrowserWindow, Notification }) => {
    BrowserWindow.getAllWindows()[0].hide()
    Notification.isSupported = () => false
  })
  await page.evaluate(() => {
    window.app.settings.set('tasks', 'system', true)
    window.app.settings.set('tasks', 'muteUntil', 0)
  })
  check('unavailable native notifications fall back through IPC to the real app window', await until(async () => { const s = await state(); return s.visible && s.top }))

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  await page.waitForTimeout(2200)
  check('manually hiding the reminder does not reopen the app on each fullscreen check', !(await state()).visible)

  console.log(`\nВсе ${passed} проверок прошли`)
} finally {
  await app?.close()
  server?.stop()
  fs.rmSync(dir, { recursive: true, force: true })
}
