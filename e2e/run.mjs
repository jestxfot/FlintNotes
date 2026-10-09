// Runs the browser suites: `npm test`, or `npm test -- tables` for the suites whose file name matches.
// Each suite gets its own vault in a temporary folder and its own server.
// The browser comes from `npx playwright install chromium`, or from FLINT_E2E_BROWSER (path to a Chromium binary).
// FLINT_E2E_RELEASE=<folder> tests a built release instead of the sources.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { buildVault, ROOT, tools } from './helpers.mjs'

const filters = process.argv.slice(2)
const LIMIT = 150_000
const suites = fs
  .readdirSync(path.join(ROOT, 'e2e/suites'))
  .filter((file) => file.endsWith('.mjs') && (!filters.length || filters.some((f) => file.includes(f))))
  .sort()

if (!process.env.FLINT_E2E_RELEASE && !fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('Нет сборки: сначала выполните `npm run build` (команда `npm test` делает это сама).')
  process.exit(1)
}

function startServer(vault, port) {
  // FLINT_E2E_RELEASE points at a built `release` folder to test that instead of the sources.
  const release = process.env.FLINT_E2E_RELEASE
  const server = spawn(process.execPath, release ? [path.join(release, 'server.mjs')] : ['--import', 'tsx', 'server/index.ts'], {
    cwd: release ? os.tmpdir() : ROOT,
    // The list of known vaults goes to a throwaway file, not to the user's own.
    env: { ...process.env, FLINT_VAULT: vault, FLINT_PORT: String(port), FLINT_CONFIG: `${vault}.config.json` },
  })
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`Сервер не запустился: ${output}`)), 30_000)
    const listen = (chunk) => {
      output += chunk
      if (!output.includes('FlintNotes:')) return
      clearTimeout(timer)
      resolve(server)
    }
    server.stdout.on('data', listen)
    server.stderr.on('data', listen)
  })
}

const browser = await chromium.launch({ executablePath: process.env.FLINT_E2E_BROWSER || undefined })
let failures = 0
let total = 0

for (const [index, file] of suites.entries()) {
  const suite = await import(pathToFileURL(path.join(ROOT, 'e2e/suites', file)).href)
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-e2e-'))
  // A suite may ask for no vault at all, to see the server create the welcome one.
  if (suite.vault) buildVault(vault, suite.vault)
  else fs.rmSync(vault, { recursive: true })
  const port = 4710 + index
  const server = await startServer(vault, port)
  const page = await browser.newPage({ viewport: suite.viewport ?? { width: 1300, height: 1000 } })
  const errors = []
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', (error) => errors.push(String(error)))
  // confirm() and prompt() are accepted, as a user agreeing would.
  page.on('dialog', (dialog) => dialog.accept())

  const results = []
  const t = tools(page, vault, results)
  t.url = `http://localhost:${port}/`
  try {
    await suite.afterStart?.(t)
    await page.goto(t.url)
    // A suite that hangs (a wait that never ends) is cut off and reports how far it got.
    const limit = new Promise((_, reject) => setTimeout(() => reject(new Error(`Suite did not finish in ${LIMIT / 1000} s`)), LIMIT))
    await Promise.race([suite.run(t), limit])
    t.ok('no console errors', errors.length === 0, errors.join(' | '))
  } catch (error) {
    // What the page was saying helps more than the timeout itself.
    const notices = await page.locator('.notice').allInnerTexts().catch(() => [])
    const screen = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    const context = [...errors.map((e) => `console: ${e}`), ...notices.map((n) => `notice: ${n}`), `screen: ${screen}`].join('\n')
    t.ok('suite ran to the end', false, `${String(error).split('\n')[0]}\n${context}`)
  }
  await page.close()
  server.kill()
  fs.rmSync(vault, { recursive: true, force: true })
  fs.rmSync(`${vault}.config.json`, { force: true })

  const failed = results.filter((result) => !result.pass)
  total += results.length
  failures += failed.length
  console.log(`${failed.length ? '✗' : '✓'} ${file}: ${results.length - failed.length}/${results.length}`)
  if (failed.some((result) => result.name === 'suite ran to the end')) console.log(`    last check reached: ${results.filter((r) => r.pass).at(-1)?.name ?? 'none'}`)
  for (const { name, extra } of failed) console.log(`    FAIL ${name}${extra ? `\n         ${extra.replace(/\n/g, '\n         ')}` : ''}`)
}

await browser.close()
console.log(failures ? `\n${failures} из ${total} проверок не прошли` : `\nВсе ${total} проверок прошли`)
process.exit(failures ? 1 : 0)
