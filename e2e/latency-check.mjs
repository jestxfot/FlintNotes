// The window now talks to its server over a network, so every save and every note opened is a round trip. This puts a
// proxy that delays each chunk both ways (a round trip of 150 ms, a poor wifi) between a page and the server and checks
// what the person feels: typing is not held up by the network, what is typed reaches the file, a note opens in a few
// round trips, and a network that goes away in the middle of typing loses nothing once it is back. About a minute:
//   node e2e/latency-check.mjs        (FLINT_E2E_BROWSER as for the suites)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { ROOT } from './helpers.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-latency-'))
const vault = path.join(dir, 'v')
fs.mkdirSync(vault)
fs.writeFileSync(path.join(vault, 'Writing.md'), '# Writing\n\nFirst line.\n')
fs.writeFileSync(path.join(vault, 'Other.md'), '# Other\n\nSecond note.\n')

const results = []
const ok = (name, passed, detail = '') => {
  results.push(passed)
  console.log(`${passed ? '✓' : '✗'} ${name}${passed ? '' : `\n    ${detail}`}`)
}
const sleep = (ms) => new Promise((resume) => setTimeout(resume, ms))
const until = async (check, ms = 15000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await Promise.resolve().then(check).catch(() => false)) return true
    await sleep(50)
  }
  return false
}

const port = 4696
const server = spawn(process.execPath, [path.join(ROOT, 'release', 'server.mjs')], {
  env: { ...process.env, FLINT_VAULT: vault, FLINT_PORT: String(port), FLINT_CONFIG: path.join(dir, 'config.json'), FLINT_AUTOSTART_DIR: path.join(dir, 'autostart'), FLINT_NO_OPEN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start')), 60_000)
  const listen = (data) => /localhost:\d+/.test(String(data)) && (clearTimeout(timer), resolve())
  server.stdout.on('data', listen)
  server.stderr.on('data', listen)
})

/** A TCP proxy that holds every chunk back by `delay` ms each way, and can cut the line. */
function delayProxy(listenPort, delay) {
  const sockets = new Set()
  let cut = false
  const server = net.createServer((client) => {
    if (cut) return client.destroy()
    const upstream = net.connect(port, '127.0.0.1')
    sockets.add(client).add(upstream)
    const pipe = (from, to) => {
      from.on('data', (chunk) => setTimeout(() => to.writable && to.write(chunk), delay))
      from.on('close', () => setTimeout(() => to.destroy(), delay))
      from.on('error', () => to.destroy())
    }
    pipe(client, upstream)
    pipe(upstream, client)
  })
  return {
    listen: () => new Promise((resume) => server.listen(listenPort, '127.0.0.1', resume)),
    cut() {
      cut = true
      for (const socket of sockets) socket.destroy()
      sockets.clear()
    },
    restore: () => (cut = false),
    close: () => server.close(),
  }
}

const proxy = delayProxy(port + 1, 75)
await proxy.listen()
const browser = await chromium.launch({ executablePath: process.env.FLINT_E2E_BROWSER || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const started = Date.now()
  await page.goto(`http://localhost:${port + 1}/`)
  await page.waitForFunction(() => window.app?.metadata, null, { timeout: 60_000 })
  const shown = Date.now() - started
  ok('the page is up through a 150 ms round trip within 15 s', shown < 15000, `${shown} ms`)
  await page.evaluate(() => app.commands.run('tasks:mute-hour').catch?.(() => {}))

  const row = (name) => page.locator('.tree .row .name', { hasText: new RegExp(`^${name}$`) })
  const leaf = '.leaf:not([hidden]) > .leaf-view:not([hidden]) .cm-content'
  await row('Writing').click()
  await page.waitForSelector(leaf)
  await page.waitForTimeout(800)
  await page.evaluate(() => app.workspace.activeEditor?.focus?.())
  await page.locator(leaf).first().click()
  await page.keyboard.press('Control+End')

  // ---- typing is the page's own business
  const text = ' typed over a slow line'
  const t0 = Date.now()
  await page.keyboard.type(text, { delay: 0 })
  const onScreen = (await page.locator(leaf).first().innerText()).includes(text.trim())
  const typingMs = Date.now() - t0
  ok('typing 23 letters is on the screen at once, not held up by the 150 ms line', onScreen && typingMs < 1500, `${typingMs} ms, on screen: ${onScreen}`)

  // ---- and then it is in the file
  const saved = await until(() => fs.readFileSync(path.join(vault, 'Writing.md'), 'utf8').includes(text.trim()), 8000)
  ok('what was typed reaches the file within 8 s of the last key', saved, fs.readFileSync(path.join(vault, 'Writing.md'), 'utf8'))

  // ---- opening another note
  const t1 = Date.now()
  await row('Other').click()
  await page.waitForFunction(() => document.querySelector('.leaf:not([hidden]) > .leaf-view:not([hidden]) .cm-content')?.innerText.includes('Second note'), null, { timeout: 10000 })
  const openMs = Date.now() - t1
  ok('another note opens within 2 s over the slow line', openMs < 2000, `${openMs} ms`)

  // ---- the line goes away while typing, and comes back
  await page.locator(leaf).first().click()
  await page.keyboard.press('Control+End')
  proxy.cut()
  const lost = ' written with the line cut'
  await page.keyboard.type(lost, { delay: 5 })
  await page.waitForTimeout(3500)
  const during = fs.readFileSync(path.join(vault, 'Other.md'), 'utf8')
  const still = (await page.locator(leaf).first().innerText()).includes(lost.trim())
  ok('with the line cut, the page keeps what was typed on screen and does not crash', still && !during.includes(lost.trim()), `screen: ${still}, file: ${JSON.stringify(during)}`)
  proxy.restore()
  const back = await until(() => fs.readFileSync(path.join(vault, 'Other.md'), 'utf8').includes(lost.trim()), 60_000)
  ok('once the line is back, the text typed meanwhile is saved without the person doing anything', back, fs.readFileSync(path.join(vault, 'Other.md'), 'utf8'))
  const whole = fs.readFileSync(path.join(vault, 'Other.md'), 'utf8')
  ok('and nothing else in the note is lost or doubled', whole.startsWith('# Other\n\nSecond note.') && whole.split(lost.trim()).length === 2, JSON.stringify(whole))
} finally {
  await browser.close()
  proxy.close()
  server.kill('SIGTERM')
  fs.rmSync(dir, { recursive: true, force: true })
}
const failed = results.filter((passed) => !passed).length
console.log(failed ? `\n${failed} из ${results.length} проверок не прошли` : `\nВсе ${results.length} проверок прошли`)
process.exit(failed ? 1 : 0)
