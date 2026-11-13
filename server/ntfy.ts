// The phone's messages go through ntfy (https://ntfy.sh), a small server that runs on this computer; its Android app keeps one
// connection to it over the home network and shows what arrives, with FlintNotes closed, the screen off, no Google in between.
// FlintNotes runs the program (the one binary in the state folder, `service/flintnotes notify` puts it there), keeps it alive,
// and hands it the messages: one JSON post to its own address.

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface NtfyOptions {
  /** The program. */
  binary: string
  /** Where it keeps its messages for a phone that was away (the file is made there). */
  dir: string
  /** The address to listen on, and the port. */
  host: string
  port: number
  /** The address the phone is told (the app builds links from it). */
  url: string
  /** The secret name of the channel: whoever knows it reads what is sent. */
  topic: string
}

export interface Ntfy {
  /** Sends a message to the phone; false if it did not go. */
  send(message: { title: string; body: string }): Promise<boolean>
  stop(): void
}

export function startNtfy(options: NtfyOptions): Ntfy {
  const { binary, dir, host, port, url, topic } = options
  let child: ChildProcess | null = null
  let stopped = false
  let failures = 0
  fs.mkdirSync(dir, { recursive: true })

  const run = () => {
    const began = Date.now()
    child = spawn(binary, ['serve'], {
      cwd: dir,
      env: {
        ...process.env,
        NTFY_LISTEN_HTTP: `${host === '0.0.0.0' ? '' : host}:${port}`,
        NTFY_BASE_URL: url,
        NTFY_CACHE_FILE: path.join(dir, 'cache.db'),
        NTFY_CACHE_DURATION: '24h',
        NTFY_LOG_LEVEL: 'warn',
        NTFY_WEB_ROOT: 'disable',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.on('error', (err) => console.error(`ntfy: ${err.message}`))
    child.on('exit', (code) => {
      child = null
      if (stopped) return
      // One that falls over at once (the port taken, a bad file) is tried less and less often, not in a loop.
      failures = Date.now() - began < 10_000 ? failures + 1 : 0
      const wait = Math.min(60_000, 2000 * 2 ** failures)
      console.error(`ntfy вышла (код ${code}); снова через ${Math.round(wait / 1000)} с`)
      setTimeout(run, wait).unref()
    })
  }
  run()

  return {
    async send({ title, body }) {
      // The program is on this computer: its own address (a listener on every card is reached at 127.0.0.1).
      const where = host === '0.0.0.0' ? '127.0.0.1' : host
      try {
        const res = await fetch(`http://${where}:${port}/`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic, title, message: body, priority: 4, tags: ['bell'] }),
          signal: AbortSignal.timeout(5000),
        })
        return res.ok
      } catch {
        return false
      }
    },
    stop() {
      stopped = true
      child?.kill('SIGTERM')
    },
  }
}
