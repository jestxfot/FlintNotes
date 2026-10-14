// Measures how fast the app is on a real vault: start, the note index, opening and scrolling
// the largest notes, bases, the calendar and reminders. Use it on a copy, never on the vault itself:
//   node e2e/measure.mjs /path/to/copy-of-vault [release-folder]
// Settings of the copy are used as they are; the server's own files go to a temporary folder.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const vault = path.resolve(process.argv[2] ?? '')
const release = path.resolve(process.argv[3] ?? 'release')
if (!process.argv[2] || !fs.existsSync(vault)) throw new Error('usage: node e2e/measure.mjs <copy-of-vault> [release]')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-measure-'))
const port = 4697
const server = spawn(process.execPath, [path.join(release, 'server.mjs')], {
  env: { ...process.env, FLINT_VAULT: vault, FLINT_PORT: String(port), FLINT_CONFIG: path.join(temp, 'config.json'), FLINT_AUTOSTART_DIR: path.join(temp, 'autostart'), FLINT_NO_OPEN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start')), 60_000)
  const listen = (data) => /localhost:\d+/.test(String(data)) && (clearTimeout(timer), resolve())
  server.stdout.on('data', listen)
  server.stderr.on('data', listen)
})
const results = {}
const browser = await chromium.launch({ executablePath: process.env.FLINT_E2E_BROWSER || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.addInitScript(() => {
    window.__long = []
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => window.__long.push(Math.round(entry.duration)))).observe({ type: 'longtask', buffered: true })
  })
  const started = Date.now()
  await page.goto(`http://localhost:${port}/`)
  await page.waitForFunction(() => window.app?.metadata, null, { timeout: 120_000 })
  results.appShown = Date.now() - started
  await page.evaluate(() => app.metadata.ready)
  results.indexReady = Date.now() - started
  await page.waitForTimeout(3000)
  // Reminders would cover the page.
  await page.evaluate(() => app.commands.run('tasks:mute-hour'))
  const long = () => page.evaluate(() => window.__long.splice(0))
  const startLong = await long()
  results.startLongTasks = { count: startLong.length, total: startLong.reduce((a, b) => a + b, 0), worst: Math.max(0, ...startLong) }
  results.notes = await page.evaluate(() => app.metadata.notes().length)
  results.files = await page.evaluate(() => app.vault.files().length)
  results.plugins = await page.evaluate(() => app.settings.get('core', 'enabledPlugins'))

  /** Frame times while something is scrolled from top to bottom. */
  const scroll = (selector) =>
    page.evaluate(async (selector) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const frames = []
      let last = performance.now()
      el.scrollTop = 0
      for (let step = 0; step < 60 && el.scrollTop + el.clientHeight < el.scrollHeight - 2; step++) {
        el.scrollTop += el.clientHeight * 0.6
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const now = performance.now()
        frames.push(now - last)
        last = now
      }
      frames.sort((a, b) => a - b)
      return { frames: frames.length, median: Math.round(frames[frames.length >> 1] ?? 0), worst: Math.round(frames[frames.length - 1] ?? 0) }
    }, selector)

  // ---- the largest notes
  const biggest = await page.evaluate(() =>
    app.metadata
      .notes()
      .map((path) => [path, (app.metadata.text(path) ?? '').length])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  )
  results.bigNotes = []
  for (const [file, size] of biggest) {
    await long()
    const t0 = Date.now()
    await page.evaluate((file) => app.workspace.openFile(file), file)
    await page.waitForFunction((file) => app.workspace.active?.path === file && document.querySelector('.leaf:not([hidden]) .cm-content'), file, { timeout: 60_000 })
    await page.waitForTimeout(300)
    const opened = Date.now() - t0
    const scrolled = await scroll('.leaf:not([hidden]) .cm-scroller')
    const tasks = await long()
    results.bigNotes.push({ size, opened, scrolled, longTasks: tasks.length, worstLongTask: Math.max(0, ...tasks) })
  }

  // ---- today's note, where plans and reminders live
  const daily = await page.evaluate(() => app.services.get('periodic-notes')?.find('daily', window.moment ? window.moment() : null) ?? null).catch(() => null)
  results.dailyNote = daily ? 'found' : 'none'

  // ---- bases
  const bases = await page.evaluate(() => app.vault.files().filter((file) => file.path.endsWith('.base')).map((file) => file.path))
  results.bases = []
  for (const file of bases) {
    await long()
    const t0 = Date.now()
    await page.evaluate((file) => app.workspace.openFile(file), file)
    const ok = await page
      .waitForFunction(() => document.querySelector('.leaf:not([hidden]) .base-file :is(tbody tr, .base-card, .base-empty, .base-calendar-grid, .base-list li)'), null, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    const shown = Date.now() - t0
    const rows = await page.evaluate(() => document.querySelectorAll('.leaf:not([hidden]) .base-file :is(tbody tr, .base-card, .base-list li)').length)
    const tasks = await long()
    results.bases.push({ shown: ok ? shown : 'timeout', rows, worstLongTask: Math.max(0, ...tasks) })
  }

  // ---- views of plugins as tabs
  results.views = {}
  for (const [name, command, selector] of [
    ['calendar', 'core:panel-tab:calendar', '.board'],
    ['day-planner', 'core:panel-tab:day-planner', '.day-plan'],
    ['reminders', 'core:panel-tab:reminders', '.reminders-panel'],
    ['graph', 'graph:open', 'canvas'],
  ]) {
    const exists = await page.evaluate((command) => !!app.commands.get?.(command) || app.commands.list?.().some((one) => one.id === command), command)
    if (!exists) {
      results.views[name] = 'plugin off'
      continue
    }
    await long()
    const t0 = Date.now()
    await page.evaluate((command) => app.commands.run(command), command)
    const ok = await page.waitForSelector(`.leaf:not([hidden]) ${selector}`, { timeout: 30_000 }).then(() => true).catch(() => false)
    await page.waitForTimeout(500)
    const tasks = await long()
    results.views[name] = { shown: ok ? Date.now() - t0 - 500 : 'timeout', longTasks: tasks.length, worstLongTask: Math.max(0, ...tasks) }
  }
  if (results.views.calendar?.shown) {
    for (const mode of ['Год', 'Неделя', 'Список', 'Месяц']) {
      await page.evaluate(() => app.commands.run('core:panel-tab:calendar'))
      await long()
      const t0 = Date.now()
      await page.locator('.leaf:not([hidden]) .board .modes [role=tab]', { hasText: mode }).click()
      await page.waitForTimeout(200)
      const tasks = await long()
      results.views[`calendar ${mode}`] = { switched: Date.now() - t0 - 200, worstLongTask: Math.max(0, ...tasks) }
    }
  }

  // ---- the file list
  results.fileListScroll = await scroll('.explorer .tree, .explorer, aside.left .scroll')
  // ---- typing in a large note
  if (biggest[0]) {
    await page.evaluate((file) => app.workspace.openFile(file), biggest[0][0])
    await page.waitForTimeout(800)
    await page.evaluate(() => {
      const view = app.workspace.activeEditor
      view.dispatch({ selection: { anchor: Math.floor(view.state.doc.length / 2) } })
      view.focus()
    })
    await long()
    const t0 = Date.now()
    for (let i = 0; i < 20; i++) await page.keyboard.type('x')
    const typing = Date.now() - t0
    for (let i = 0; i < 20; i++) await page.keyboard.press('Backspace')
    const tasks = await long()
    results.typing20chars = { ms: typing, longTasks: tasks.length, worstLongTask: Math.max(0, ...tasks) }
  }
  results.heapMB = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6))
} finally {
  await browser.close()
  server.kill()
  fs.rmSync(temp, { recursive: true, force: true })
}
console.log(JSON.stringify(results, null, 1))
