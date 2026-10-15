// The server's memory stays bounded while other programs write into the vault all the time and an
// open page has stopped reading its stream of changes (a tab in the background, a quiet connection).
// Unread changes once piled up until the server ran out of its 4 GB. About a minute; Linux (/proc):
//   node e2e/events-memory-check.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './helpers.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-memory-'))
const vault = path.join(dir, 'v')
fs.mkdirSync(vault)
const port = 4698
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, FLINT_VAULT: vault, FLINT_PORT: String(port), FLINT_CONFIG: path.join(dir, 'c.json'), FLINT_AUTOSTART_DIR: path.join(dir, 'a') }, stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise((resolve) => {
  const listen = (data) => /localhost:\d+/.test(String(data)) && resolve()
  server.stdout.on('data', listen)
  server.stderr.on('data', listen)
})
const memory = () => Math.round(Number(fs.readFileSync(`/proc/${server.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) / 1024)
// A page that opens the stream of changes and never reads it.
const stalled = net.connect(port, '127.0.0.1', () => stalled.write(`GET /api/events?vault=v HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n`))
stalled.pause()
let written = 0
const writer = setInterval(() => {
  for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(vault, `f${written++ % 2000}.md`), `x ${written} ${'y'.repeat(200)}\n`)
}, 50)
await new Promise((resolve) => setTimeout(resolve, 15_000))
const settled = memory()
await new Promise((resolve) => setTimeout(resolve, 40_000))
const after = memory()
clearInterval(writer)
stalled.destroy()
server.kill()
fs.rmSync(dir, { recursive: true, force: true })
const passed = after - settled < 200
console.log(`${passed ? '✓' : '✗'} the server's memory stays bounded with a page that does not read: ${settled} MB → ${after} MB over 40 s, ${written} files written`)
process.exit(passed ? 0 : 1)
