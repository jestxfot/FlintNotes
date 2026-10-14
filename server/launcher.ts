/**
 * What FlintNotes.vbs and the start with the computer run: it keeps the server going in the
 * background, with no window.
 * - A new build (`npm run release` writes `build.json` last) replaces the server: the old one
 *   finishes the saves it has begun and steps aside, the new one starts on the same port, and
 *   the open pages reload themselves.
 * - A server that falls over is started again.
 * The server's messages go to `flintnotes.log` next to this file, there being no window to show them.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)
const here = path.dirname(self)
const SERVER = path.join(here, 'server.mjs')
const BUILD = path.join(here, 'build.json')
const LOG = path.join(here, 'flintnotes.log')
const selfText = fs.readFileSync(self, 'utf8')

// The log keeps about the last runs: one grown long is begun anew.
if ((fs.statSync(LOG, { throwIfNoEntry: false })?.size ?? 0) > 1_000_000) fs.rmSync(LOG, { force: true })
const log = fs.openSync(LOG, 'a')
const note = (text: string) => fs.writeSync(log, `${new Date().toLocaleString('ru')}  ${text}\n`)

const buildId = (): string => {
  try {
    return JSON.parse(fs.readFileSync(BUILD, 'utf8')).id ?? ''
  } catch {
    return ''
  }
}

let server: ChildProcess | undefined
let build = buildId()
let replacing = false
let startedAt = 0
let quickFailures = 0

function start(): void {
  startedAt = Date.now()
  // windowsHide: a program with no window of its own that starts a console one would make Windows show a console.
  const child = spawn(process.execPath, [SERVER, ...process.argv.slice(2)], {
    stdio: ['ignore', log, log, 'ipc'],
    env: { ...process.env, FLINT_LAUNCHER: self },
    windowsHide: true,
  })
  server = child
  child.on('exit', (code, signal) => {
    server = undefined
    if (replacing) {
      replacing = false
      // The launcher itself came with the build: the new one takes over from here.
      if (fs.readFileSync(self, 'utf8') !== selfText) {
        note('Новая сборка: запускаю новую программу запуска')
        spawn(process.execPath, [self, ...process.argv.slice(2)], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
        process.exit(0)
      }
      note('Новая сборка: сервер запущен заново')
      start()
      return
    }
    // Stopped on purpose, or another FlintNotes already serves the notes.
    if (code === 0) process.exit(0)
    // A server that falls over right at start (a broken build, the port taken by another program) is not tried forever.
    quickFailures = Date.now() - startedAt < 10_000 ? quickFailures + 1 : 0
    if (quickFailures >= 3) {
      note('Сервер не запускается, причина — в сообщениях выше')
      process.exit(1)
    }
    note(`Сервер остановился (${signal ?? `код ${code}`}), запускаю снова`)
    setTimeout(start, 1000)
  })
}

function replace(): void {
  if (!server) return start()
  replacing = true
  server.send('stop')
  // A server that does not finish in time is stopped anyway.
  const child = server
  const late = setTimeout(() => child.kill(), 10_000)
  child.once('exit', () => clearTimeout(late))
}

// Polling, not file events: the build is written from WSL onto a Windows drive, and events
// do not always cross that border.
fs.watchFile(BUILD, { interval: 2000 }, () => {
  const next = buildId()
  if (!next || next === build) return
  build = next
  replace()
})

start()
