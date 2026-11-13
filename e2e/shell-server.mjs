// For the scripts that run the Windows app (Electron) for real: the app is only a window, so each needs a server
// to show. This starts the real one (release/server.mjs, as the Debian service runs it) on this computer's loopback,
// with a vault, and gives the link `flintnotes pair` would print. Not a suite: the suites start their own server.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** Arguments for Electron: without a display (DISPLAY) Chromium is told to draw nowhere. */
export const shellFlags = () => (process.env.DISPLAY ? ['--no-sandbox'] : ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'])

/**
 * Starts the server of the build in `release` on the vault `vault`, with the network listener (the one the app talks to)
 * on `lan` and the computer's own on `admin`. Resolves once it answers; `link()` is what the app is given.
 */
export async function startShellServer({ release, vault, dir, admin = 4861, lan = 4862 }) {
  const config = path.join(dir, 'server-config.json')
  fs.writeFileSync(config, JSON.stringify({ phone: { port: lan, host: '127.0.0.1' } }))
  const child = spawn(process.execPath, [path.join(release, 'server.mjs'), vault], {
    env: { ...process.env, FLINT_SERVICE: '1', FLINT_CONFIG: config, FLINT_CACHE: path.join(dir, 'server-cache'), FLINT_PORT: String(admin) },
    stdio: 'ignore',
  })
  for (let tries = 0; tries < 150; tries++) {
    if (await fetch(`http://127.0.0.1:${lan}/api/build`).then((res) => res.ok, () => false)) break
    await new Promise((resume) => setTimeout(resume, 200))
  }
  const key = () => JSON.parse(fs.readFileSync(config, 'utf8')).shell.key
  return { link: () => `http://127.0.0.1:${lan}/?key=${key()}`, stop: () => child.kill('SIGKILL') }
}
