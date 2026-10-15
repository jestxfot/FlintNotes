// Checks the whole update path, as it runs on the user's computer: a launcher serving one build,
// a page open with text typed and not yet saved, then `npm run release` again. The server must be
// replaced, the page must reload by itself and keep the text, and the settings must say so.
// Builds into a temporary folder; the project's own release/ is not touched. About a minute:
//   node e2e/update-check.mjs        (FLINT_E2E_BROWSER as for the suites)
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { ROOT } from './helpers.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-update-'))
const out = path.join(dir, 'release')
const vault = path.join(dir, 'vault')
const port = 4697
fs.mkdirSync(vault)
fs.writeFileSync(path.join(vault, 'Note.md'), 'start\n')
const release = () => execSync('npm run release', { cwd: ROOT, env: { ...process.env, FLINT_RELEASE_OUT: out }, stdio: 'ignore' })
const buildId = () => JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8')).id
const results = []
const ok = (name, passed, detail = '') => {
  results.push(passed)
  console.log(`${passed ? '✓' : '✗'} ${name}${passed ? '' : `\n    ${detail}`}`)
}

release()
const launcher = spawn(process.execPath, [path.join(out, 'launcher.mjs')], {
  env: { ...process.env, FLINT_VAULT: vault, FLINT_PORT: String(port), FLINT_CONFIG: path.join(dir, 'config.json'), FLINT_AUTOSTART_DIR: path.join(dir, 'autostart') },
  stdio: 'ignore',
})
const browser = await chromium.launch({ executablePath: process.env.FLINT_E2E_BROWSER || undefined })
const buildRow = async (page) => {
  await page.evaluate(() => app.commands.run('core:settings'))
  await page.locator('nav button', { hasText: 'Программа' }).first().click().catch(() => {})
  const text = await page.locator('.build-info').innerText({ timeout: 10000 }).catch(() => '')
  await page.keyboard.press('Escape')
  return text
}
try {
  const page = await browser.newPage()
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(`http://localhost:${port}/vault/Note`)
      break
    } catch {
      await new Promise((resume) => setTimeout(resume, 500))
    }
  }
  await page.waitForSelector('.cm-content', { timeout: 30000 })
  await page.waitForTimeout(800)
  const before = await buildRow(page)
  ok('the settings say the page and the server are one build, and that new ones come by themselves', before.includes('та же сборка') && before.includes('подхватываются сами'), before)
  await page.evaluate(() => (window.__oldPage = true))
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' typed before the update')

  const first = buildId()
  release()
  const ended = Date.now()
  ok('a new build is written', buildId() !== first)
  const reloaded = await page.waitForFunction(() => !window.__oldPage && window.app?.workspace, null, { timeout: 60000 }).then(() => true, () => false)
  ok(`the open page reloads by itself (${Math.round((Date.now() - ended) / 1000)} s after the build)`, reloaded)
  await page.waitForSelector('.cm-content', { timeout: 30000 }).catch(() => {})
  ok('what was typed and not yet saved is kept', fs.readFileSync(path.join(vault, 'Note.md'), 'utf8').includes('typed before the update') && (await page.locator('.cm-content').innerText()).includes('typed before the update'))
  const after = await buildRow(page)
  ok('after it, page and server are the new build', after.includes('та же сборка'), after)
  const log = fs.readFileSync(path.join(out, 'flintnotes.log'), 'utf8')
  ok('the launcher notes the replacement in its log', log.includes('Новая сборка'), log.slice(-300))
} finally {
  await browser.close()
  launcher.kill()
  // The server the launcher started last goes with it; one left over would hold the port.
  await new Promise((resume) => setTimeout(resume, 1500))
  fs.rmSync(dir, { recursive: true, force: true })
}
const failed = results.filter((passed) => !passed).length
console.log(failed ? `\n${failed} из ${results.length} проверок не прошли` : `\nВсе ${results.length} проверок прошли`)
process.exit(failed ? 1 : 0)
