// Checks the real tray callbacks and About dialog against an isolated update feed.
// FLINT_E2E_RELEASE=<release> uses a packaged build; otherwise this script builds a temporary one.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { _electron } from 'playwright'
import { buildVault, ROOT } from './helpers.mjs'
import { shellFlags, startShellServer } from './shell-server.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-updates-menu-'))
const out = process.env.FLINT_E2E_RELEASE || path.join(dir, 'release')
const vault = path.join(dir, 'vault')
const profile = path.join(dir, 'profile')
const electronVersion = createRequire(import.meta.url)('electron/package.json').version
buildVault(vault, { files: { 'Note.md': 'Update menu test\n' } })
fs.mkdirSync(profile)
fs.writeFileSync(path.join(profile, 'window.json'), JSON.stringify({ autoUpdate: false }))
fs.writeFileSync(path.join(dir, 'shell.json'), JSON.stringify({ version: '1.0.0', electron: electronVersion }))

// Capture the native menu before startup, without adding test hooks to the app.
const wrapper = path.join(dir, 'main.mjs')
fs.writeFileSync(wrapper, `import { Menu, dialog } from 'electron';
const build = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = (items) => { const menu = build(items); if (items.some(item => item.label === 'Открыть FlintNotes')) globalThis.testTray = menu; return menu; };
dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
await import(${JSON.stringify(pathToFileURL(path.join(out, 'desktop.mjs')).href)});
`)
const files = [{ path: 'release/desktop.mjs', bytes: Buffer.from('// fixture build\n') }, { path: 'shell.json', bytes: Buffer.from(JSON.stringify({ version: '1.0.1', electron: electronVersion })) }]
const packed = gzipSync(Buffer.concat([Buffer.from(`${JSON.stringify(files.map((f) => ({ path: f.path, size: f.bytes.length })))}\n`), ...files.map((f) => f.bytes)]))
const update = { file: 'FlintNotes-1.0.1-app.pack', size: packed.length, sha256: createHash('sha256').update(packed).digest('hex') }
let mode = 'current'
let requests = 0
const feed = http.createServer((request, response) => {
  if (request.url.endsWith('/latest.json')) {
    requests++
    if (mode === 'error') { response.writeHead(503); response.end('Unavailable'); return }
    const latest = mode === 'newer' ? { version: '1.0.1', electron: electronVersion, app: update } : { version: '1.0.0' }
    setTimeout(() => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(latest)) }, 700)
    return
  }
  if (request.url.endsWith(update.file)) {
    response.setHeader('content-length', packed.length)
    const middle = Math.floor(packed.length / 2)
    response.write(packed.subarray(0, middle))
    setTimeout(() => response.end(packed.subarray(middle)), 1200)
    return
  }
  response.writeHead(404); response.end()
})
let application
let server
let passed = 0
const check = (name, value) => { assert.ok(value, name); passed++; console.log(`✓ ${name}`) }
const until = async (read, timeout = 15000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) if (await read()) return true
  return false
}
try {
  if (!process.env.FLINT_E2E_RELEASE) execFileSync(process.execPath, ['scripts/release.mjs'], { cwd: ROOT, env: { ...process.env, FLINT_RELEASE_OUT: out }, stdio: 'pipe' })
  await new Promise((resolve) => feed.listen(0, '127.0.0.1', resolve))
  server = await startShellServer({ release: out, vault, dir })
  const libs = process.env.FLINT_E2E_LIBS || path.join(os.homedir(), '.cache/flintnotes/gtk-libs')
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'), args: [...shellFlags(), wrapper],
    env: { ...process.env, WAYLAND_DISPLAY: '', FLINT_WINDOW_DELAY: '1500', FLINT_SERVER_URL: server.link(),
      ...(fs.existsSync(libs) ? { LD_LIBRARY_PATH: [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}),
      FLINT_USER_DATA: profile, FLINT_AUTOSTART_DIR: path.join(dir, 'autostart'),
      FLINT_SHELL: path.join(dir, 'shell.json'), FLINT_BUILDS: path.join(dir, 'builds'),
      FLINT_UPDATE_FEED: `http://127.0.0.1:${feed.address().port}/latest.json`, FLINT_UPDATE_DELAY: '3600000' },
  })
  const page = await application.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.waitForFunction(() => window.app?.commands.get('core:about'))
  const trayLabels = await application.evaluate(() => globalThis.testTray.items.map((item) => item.label))
  check('tray offers About and Check for updates', trayLabels.includes('О программе') && trayLabels.includes('Проверить обновления'))

  await page.locator('.main-menu .vault').click()
  await page.getByRole('menuitem', { name: 'О программе', exact: true }).click()
  const about = page.getByRole('dialog', { name: 'О программе', exact: true })
  await about.waitFor()
  await page.waitForFunction(() => document.querySelector('.about-dialog .version')?.textContent.includes('1.0.0'))
  check('about shows the installed version without checking automatically', requests === 0 && await about.getByRole('button', { name: 'Проверить обновления', exact: true }).isEnabled())
  await about.getByRole('button', { name: 'Проверить обновления', exact: true }).click()
  check('check button is disabled during a manual check', await about.getByRole('button', { name: 'Проверяю…', exact: true }).isDisabled())
  await about.getByRole('status').filter({ hasText: 'Установлена последняя версия' }).waitFor()
  check('manual check works with automatic updates switched off', requests === 1 && !(await page.evaluate(() => window.flintDesktop.updates())).enabled)
  const checkedBeforeTray = (await page.evaluate(() => window.flintDesktop.updates())).checkedAt
  await about.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].hide()
    globalThis.testTray.items.find((item) => item.label === 'Проверить обновления').click()
  })
  await about.waitFor()
  assert.ok(await until(async () => { const info = await page.evaluate(() => window.flintDesktop.updates()); return !info.checking && info.checkedAt > checkedBeforeTray }), 'tray check finished')
  await about.getByRole('status').filter({ hasText: 'Установлена последняя версия' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.about-dialog .actions button')?.disabled)
  check('tray check brings the window forward, opens About, and checks the feed', requests === 2 && await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))

  mode = 'error'
  await about.getByRole('button', { name: 'Проверить обновления', exact: true }).click()
  await about.getByRole('status').filter({ hasText: 'Не удалось' }).waitFor()
  check('failed checks show an error and allow retry', await about.getByRole('button', { name: 'Проверить обновления', exact: true }).isEnabled())
  mode = 'newer'
  await about.getByRole('button', { name: 'Проверить обновления', exact: true }).click()
  await about.getByRole('status').filter({ hasText: 'Загружаю версию 1.0.1' }).waitFor()
  check('about shows download progress', await about.getByRole('progressbar').count() === 1)
  await about.getByRole('button', { name: 'Перезапустить и обновить', exact: true }).waitFor()
  check('downloaded update is available from About and the tray', await application.evaluate(() => globalThis.testTray.items.some((item) => item.label === 'Обновить до версии 1.0.1')))
  if (process.env.FLINT_E2E_SCREENSHOT) await page.screenshot({ path: process.env.FLINT_E2E_SCREENSHOT })
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('install-update')
    ipcMain.handle('install-update', () => { globalThis.testInstallRequested = true; return false })
  })
  await about.getByRole('button', { name: 'Перезапустить и обновить', exact: true }).click()
  await about.getByRole('status').filter({ hasText: 'недоступно' }).waitFor()
  check('install button uses the existing updater and handles a missing package', await application.evaluate(() => globalThis.testInstallRequested === true))
  check('no renderer errors', errors.length === 0)
  console.log(`All ${passed} desktop update menu checks passed.`)
} catch (error) {
  if (application) {
    const page = await application.firstWindow()
    console.error('Update test state:', { mode, requests, info: await page.evaluate(() => window.flintDesktop.updates()).catch(() => null), shown: await page.locator('.about-dialog').innerText().catch(() => '') })
  }
  throw error
} finally {
  await application?.close()
  server?.stop()
  await new Promise((resolve) => feed.close(resolve))
  fs.rmSync(dir, { recursive: true, force: true })
}
