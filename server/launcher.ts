/**
 * What keeps the server going in the background, with no window: the service on Debian (`flintnotes.service`), and
 * `node release/launcher.mjs` for a try on any machine.
 * - A new build (`npm run release` writes `build.json` last; the service's updater changes the `current` link of
 *   server/releases.ts) replaces the server: the old one finishes the saves it has begun and steps aside, the new
 *   one starts on the same port, and the open pages reload themselves.
 * - A server that falls over is started again. A downloaded build that will not start is given up, and the one
 *   before it (or the package's own) runs.
 * - SIGTERM, the service manager's word to stop, stops the server in order and then the launcher.
 * The messages go to the service manager's journal (FLINT_SERVICE=1), or else to `flintnotes.log` next to this file.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickApp, readBuild, rollBack } from './releases'

const self = fileURLToPath(import.meta.url)
const here = path.dirname(self)
const LOG = path.join(here, 'flintnotes.log')
const selfText = fs.readFileSync(self, 'utf8')
/** The service's folder for downloaded programs; without it the program next to this file is the only one. */
const STATE = process.env.FLINT_STATE_DIR

const SERVICE = process.env.FLINT_SERVICE === '1'
// The log keeps about the last runs: one grown long is begun anew.
if (!SERVICE && (fs.statSync(LOG, { throwIfNoEntry: false })?.size ?? 0) > 1_000_000) fs.rmSync(LOG, { force: true })
const log = SERVICE ? 2 : fs.openSync(LOG, 'a')
// The journal stamps its lines itself.
const note = (text: string) => fs.writeSync(log, SERVICE ? `${text}\n` : `${new Date().toLocaleString('ru', { timeZone: 'Europe/Moscow' })}  ${text}\n`)

/** The folder whose server.mjs runs: re-chosen whenever a build changes, since a download may have come. */
let app = pickApp(here, STATE)
const buildId = () => readBuild(app)?.id ?? ''

let server: ChildProcess | undefined
let build = buildId()
let replacing = false
let startedAt = 0
let quickFailures = 0

function start(): void {
  startedAt = Date.now()
  // The server is told where it runs from; a build of the service shows its own version through it.
  const child = spawn(process.execPath, [path.join(app, 'server.mjs'), ...process.argv.slice(2)], {
    stdio: ['ignore', log, log, 'ipc'],
    env: { ...process.env, FLINT_LAUNCHER: self },
  })
  server = child
  child.on('exit', (code, signal) => {
    server = undefined
    if (replacing) {
      replacing = false
      // The launcher itself came with the build: the new one takes over from here.
      if (fs.readFileSync(self, 'utf8') !== selfText) {
        note('Новая сборка: запускаю новую программу запуска')
        spawn(process.execPath, [self, ...process.argv.slice(2)], { detached: true, stdio: 'ignore' }).unref()
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
    // A program that was downloaded and does not start: give it up for the one before it.
    if (STATE && app !== here && quickFailures >= 2) {
      const given = rollBack(STATE)
      note(`Версия ${given ?? '?'} не запускается, возвращаю прежнюю`)
      app = pickApp(here, STATE)
      build = buildId()
      quickFailures = 0
      setTimeout(start, 1000)
      return
    }
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

// Polling, not file events: a link that is switched is no change of the file watched, and the build may be written
// over a network share. Both places a program can come from are watched.
const watched = [path.join(here, 'build.json'), ...(STATE ? [path.join(STATE, 'current', 'build.json')] : [])]
const look = () => {
  const next = pickApp(here, STATE)
  const id = readBuild(next)?.id ?? ''
  if (!id || (next === app && id === build)) return
  app = next
  build = id
  replace()
}
for (const file of watched) fs.watchFile(file, { interval: 2000 }, look)

// Stopped from outside (systemd's SIGTERM, a terminal's Ctrl+C): the server finishes the saves it has begun, then both go.
// Without this the launcher would die at once and leave the server to be cut off, or restart a server that was told to stop.
let stopping = false
function shutDown(): void {
  if (stopping) return
  stopping = true
  for (const file of watched) fs.unwatchFile(file)
  const child = server
  if (!child) process.exit(0)
  child.once('exit', () => process.exit(0))
  child.send('stop')
  setTimeout(() => (child.kill(), process.exit(0)), 10_000).unref()
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, shutDown)

start()
