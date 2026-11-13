// Checks the Debian service as it runs on the server, without systemd: the package is built and unpacked the way
// dpkg lays it out, and its launcher is run in service mode (FLINT_SERVICE=1) with a state folder of its own.
//   - the first start makes the key and turns the network listener on; the key is told without a page (`flintnotes pair`)
//     and a new key shuts out the old
//   - a newer server in the feed is downloaded, checked, put in, and started by the launcher
//   - a download with a wrong checksum is refused; a build that does not start is given up for the one before it,
//     and is not fetched again
//   - SIGTERM stops the launcher and the server in order
// Builds into temporary folders; the project's release/ and publish/ are not touched. About two minutes:
//   node e2e/service-check.mjs
import { execFile, execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { ROOT } from './helpers.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-service-'))
const results = []
const ok = (name, passed, detail = '') => {
  results.push(passed)
  console.log(`${passed ? '✓' : '✗'} ${name}${passed ? '' : `\n    ${detail}`}`)
}
const sleep = (ms) => new Promise((resume) => setTimeout(resume, ms))
const until = async (check, seconds = 40) => {
  for (let i = 0; i < seconds * 4; i++) {
    const value = await Promise.resolve().then(check).catch(() => false)
    if (value) return value
    await sleep(250)
  }
  return false
}

// ---- build the package from the project, as `npm run installer` does
const release = path.join(dir, 'release')
const published = path.join(dir, 'published')
const env = { ...process.env, FLINT_RELEASE_OUT: release, FLINT_SERVER_OUT: published }
execFileSync(process.execPath, ['scripts/release.mjs'], { cwd: ROOT, env, stdio: 'ignore' })
execFileSync(process.execPath, ['scripts/server-package.mjs'], { cwd: ROOT, env, stdio: 'ignore' })
const version = JSON.parse(fs.readFileSync(path.join(release, 'build.json'), 'utf8')).version
const deb = path.join(published, `flintnotes_${version}_all.deb`)
ok('the package and the feed are made', fs.existsSync(deb) && fs.existsSync(path.join(published, 'server-latest.json')) && fs.existsSync(path.join(published, `flintnotes-server-${version}.tar.gz`)))
const control = execFileSync('dpkg-deb', ['--field', deb], { encoding: 'utf8' })
ok('it says what it needs', /Depends: nodejs \(>= 20\)/.test(control) && /Architecture: all/.test(control), control)

const root = path.join(dir, 'root')
execFileSync('dpkg-deb', ['-x', deb, root])
const lib = path.join(root, 'usr', 'lib', 'flintnotes')
ok('it lays the launcher, the command and the program out', ['launcher.mjs', 'cli.mjs', 'server.mjs', 'build.json', 'public/index.html'].every((file) => fs.existsSync(path.join(lib, file))) && fs.existsSync(path.join(root, 'usr/lib/systemd/system/flintnotes.service')))
let lint = ''
try {
  lint = execFileSync('systemd-analyze', ['verify', path.join(root, 'usr/lib/systemd/system/flintnotes.service')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (err) {
  lint = String(err.stderr ?? err)
}
// The user and the program do not exist on this computer: only a unit that cannot be read at all is a failure.
ok('the unit file is one systemd reads', !/Failed to parse|Unknown (section|key)|Invalid|Unknown lvalue/i.test(lint), lint)

// ---- a feed with servers of our own making, served locally
const state = path.join(dir, 'state')
const vaults = path.join(state, 'vaults')
fs.mkdirSync(vaults, { recursive: true })
const config = path.join(state, 'config.json')
const LAN = 4842
const ADMIN = 4841
const FEED = 4843
fs.writeFileSync(config, JSON.stringify({ phone: { port: LAN, host: '127.0.0.1' } }))

const unpacked = path.join(dir, 'unpacked')
fs.mkdirSync(unpacked)
execFileSync('tar', ['-xzf', path.join(published, `flintnotes-server-${version}.tar.gz`), '-C', unpacked])
/** A tarball of the same program with another version (and what `change` does to the folder first). */
const makeServer = (next, change = () => {}) => {
  const folder = path.join(dir, `server-${next}`)
  fs.cpSync(unpacked, folder, { recursive: true })
  const build = JSON.parse(fs.readFileSync(path.join(folder, 'build.json'), 'utf8'))
  fs.writeFileSync(path.join(folder, 'build.json'), JSON.stringify({ ...build, version: next, id: `${build.id}-${next}` }))
  change(folder)
  const file = `flintnotes-server-${next}.tar.gz`
  execFileSync('tar', ['-czf', path.join(dir, file), '-C', folder, '.'])
  return { version: next, file, sha256: createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex') }
}
let feed = {}
const feedServer = http.createServer((req, res) => {
  const name = req.url.slice(1)
  if (name === 'server-latest.json') return res.end(JSON.stringify(feed))
  const file = path.join(dir, name)
  if (/^flintnotes-server-[\d.]+\.tar\.gz$/.test(name) && fs.existsSync(file)) return res.end(fs.readFileSync(file))
  res.statusCode = 404
  res.end()
}).listen(FEED, '127.0.0.1')

// ---- the launcher, run as the unit file runs it
const serviceEnv = { ...process.env, FLINT_SERVICE: '1', FLINT_STATE_DIR: state, FLINT_CONFIG: config, FLINT_CACHE: path.join(dir, 'cache'), FLINT_FIRST_VAULT: path.join(vaults, 'FlintNotes'), FLINT_PORT: String(ADMIN), FLINT_SERVER_FEED: `http://127.0.0.1:${FEED}/server-latest.json`, FLINT_SERVER_UPDATE_FIRST: '600000' }
const log = fs.openSync(path.join(dir, 'service.log'), 'a')
const launcher = spawn(process.execPath, [path.join(lib, 'launcher.mjs')], { env: serviceEnv, stdio: ['ignore', log, log] })
let launcherExit
launcher.on('exit', (code) => (launcherExit = code))
// A new key restarts the listener and closes its connections: a socket kept from before is gone, so a refused or cut request is asked again.
const lan = async (p = '/api/build', init = {}) => {
  for (let tries = 0; ; tries++) {
    try {
      return await fetch(`http://127.0.0.1:${LAN}${p}`, { redirect: 'manual', ...init })
    } catch (err) {
      if (tries >= 3) throw err
      await sleep(300)
    }
  }
}
const built = async () => (await (await lan()).json())
// Asked without blocking this process: the feed below is served from it, and the command waits for the feed.
const flintnotes = async (...args) => {
  try {
    return { code: 0, text: (await promisify(execFile)(process.execPath, [path.join(lib, 'cli.mjs'), ...args], { env: serviceEnv, encoding: 'utf8' })).stdout }
  } catch (err) {
    return { code: err.code, text: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

try {
  const first = await until(built)
  ok('the service starts and says what it is, with no key', first && first.version === version && first.protocol >= 1, JSON.stringify(first))
  const saved = JSON.parse(fs.readFileSync(config, 'utf8'))
  ok("the first start made the shell's key and turned the listener on; phones have none yet", typeof saved.shell?.key === 'string' && saved.shell.key.length >= 20 && !saved.phone?.key, JSON.stringify(saved))
  ok('without the key the notes are locked', (await lan('/api/tree')).status === 401)

  const pair = await flintnotes('pair')
  ok('`flintnotes pair` prints the address with the key, and a QR code', pair.code === 0 && pair.text.includes(`http://127.0.0.1:${LAN}/?key=${saved.shell.key}`) && /[▀▄█]/.test(pair.text), pair.text)
  const link = await lan(`/?key=${saved.shell.key}`)
  ok('the link puts the key in a cookie of its own and leaves no key in the address', link.status === 302 && link.headers.get('location') === '/' && (link.headers.get('set-cookie') ?? '').startsWith(`flint-shell=${saved.shell.key}`), `${link.status} ${link.headers.get('set-cookie')}`)
  const cookie = `flint-shell=${saved.shell.key}`
  ok('that key opens the notes', (await lan('/api/tree', { headers: { cookie } })).status === 200)
  const rotated = await flintnotes('pair', '--rotate')
  const key2 = JSON.parse(fs.readFileSync(config, 'utf8')).shell.key
  ok('`pair --rotate` makes a new key and shuts out the old', rotated.code === 0 && key2 !== saved.shell.key && rotated.text.includes(key2) && (await lan('/api/tree', { headers: { cookie } })).status === 401 && (await lan('/api/tree', { headers: { cookie: `flint-shell=${key2}` } })).status === 200, rotated.text)
  const origin = `http://127.0.0.1:${LAN}`
  const shell = { cookie: `flint-shell=${key2}`, origin, 'content-type': 'application/json' }
  const post = (p, body, headers = shell) => lan(p, { method: 'POST', headers, body: JSON.stringify(body) })
  const refused = [await post('/api/server/update', {}), await post('/api/phone', { newKey: true }), await post('/api/shell', { newKey: true }), await post('/api/proxy', { proxy: 'off' })]
  ok("the shell's key does not reach what is the server's own: updating, keys, the proxy", refused.every((res) => res.status === 403), refused.map((res) => res.status).join())
  const info = await (await lan('/api/vault', { headers: shell })).json()
  ok('the page is told it is the shell, so that it shows no settings of the server', info.tier === 'shell', JSON.stringify(info))

  // ---- the programs the owner allowed (Templater's system commands) run for the window, and only the ones written into the config by hand
  const written = JSON.parse(fs.readFileSync(config, 'utf8'))
  written.systemCommands = { [info.path]: { commands: { hello: 'echo "Hello, $who"' }, timeout: 5 } }
  fs.writeFileSync(config, JSON.stringify(written))
  const ran = await post('/api/exec', { name: 'hello', env: { who: 'window' } })
  ok('the window runs a command the owner allowed, its arguments arrive as variables', ran.status === 200 && (await ran.json()).output === 'Hello, window', String(ran.status))
  const unwritten = await post('/api/exec', { name: 'rm-everything' })
  ok('a command nobody wrote into the config is refused, even for the window', unwritten.status === 403, String(unwritten.status))
  ok('and it comes only from a page of the app, not from anywhere else', (await post('/api/exec', { name: 'hello' }, { cookie: shell.cookie, origin: 'http://evil.example', 'content-type': 'application/json' })).status === 403)

  // ---- what the shell may do with the server's disk: only inside the roots
  const outside = path.join(dir, 'outside')
  fs.mkdirSync(path.join(outside, 'secret'), { recursive: true })
  fs.symlinkSync(outside, path.join(vaults, 'escape'))
  const roots = await (await lan('/api/dirs', { headers: shell })).json()
  ok('without a path the shell is shown the roots', roots.path === null && roots.roots[0] === vaults && roots.dirs.length === 1 && roots.dirs[0].path === vaults, JSON.stringify(roots))
  const inside = await (await lan(`/api/dirs?path=${encodeURIComponent(vaults)}`, { headers: shell })).json()
  ok('a root lists its folders, a link that leads out of it left out', inside.dirs.some((d) => d.name === 'FlintNotes') && !inside.dirs.some((d) => d.name === 'escape') && inside.parent === null, JSON.stringify(inside))
  const looks = [`/`, `${vaults}/..`, `${vaults}/escape`, `${vaults}/escape/secret`, '..'].map((p) => lan(`/api/dirs?path=${encodeURIComponent(p)}`, { headers: shell }))
  ok('nothing outside the roots is listed: not /, not .., not through a link', (await Promise.all(looks)).every((res) => res.status === 403 || res.status === 400), (await Promise.all(looks)).map((r) => r.status).join())
  const secondVault = path.join(vaults, 'Second')
  const made = await post('/api/vaults/open', { path: secondVault, create: true })
  ok('a new vault opens inside a root', made.status === 200 && fs.existsSync(secondVault), `${made.status} ${await made.text()}`)
  const opens = [await post('/api/vaults/open', { path: path.join(dir, 'elsewhere'), create: true }), await post('/api/vaults/open', { path: `${vaults}/escape/secret` }), await post('/api/vaults/open', { path: `${vaults}/../elsewhere`, create: true })]
  ok('not outside it: not elsewhere, not through a link, not through ..', opens.every((res) => res.status === 403) && !fs.existsSync(path.join(dir, 'elsewhere')), opens.map((r) => r.status).join())

  // ---- a phone has a key of its own, and may do less
  const phonePair = await flintnotes('pair', '--phone')
  const phoneKey = JSON.parse(fs.readFileSync(config, 'utf8')).phone?.key
  ok('`pair --phone` makes the phones\' key, a different one', phonePair.code === 0 && phoneKey && phoneKey !== key2 && phonePair.text.includes(phoneKey), phonePair.text)
  const phone = { cookie: `flint-key=${phoneKey}`, origin, 'content-type': 'application/json' }
  const asPhone = [await lan('/api/tree', { headers: phone }), await lan('/api/dirs', { headers: phone }), await post('/api/vaults/open', { path: path.join(vaults, 'Third'), create: true }, phone), await post('/api/vaults/forget', { path: secondVault }, phone), await post('/api/exec', { name: 'hello', env: { who: 'phone' } }, phone)]
  ok('a phone reads the notes but opens no new vault, browses no folders, forgets none, runs no program', asPhone.map((r) => r.status).join() === '200,403,403,403,403', asPhone.map((r) => r.status).join())
  ok("and one tier's cookie is not the other's key", (await lan('/api/tree', { headers: { cookie: `flint-shell=${phoneKey}` } })).status === 401)

  // ---- files: ranges, and a large one that is not held whole in memory
  const note = (name) => `/api/file?path=${encodeURIComponent(name)}`
  await lan(note('range.txt'), { method: 'PUT', headers: shell, body: 'hello world' })
  const part = await lan(note('range.txt'), { headers: { ...shell, range: 'bytes=0-4' } })
  const tail = await lan(note('range.txt'), { headers: { ...shell, range: 'bytes=-5' } })
  const open = await lan(note('range.txt'), { headers: { ...shell, range: 'bytes=6-' } })
  const past = await lan(note('range.txt'), { headers: { ...shell, range: 'bytes=50-' } })
  const whole = await lan(note('range.txt'), { headers: shell })
  ok('a range of a file is answered as such', part.status === 206 && (await part.text()) === 'hello' && part.headers.get('content-range') === 'bytes 0-4/11' && (await tail.text()) === 'world' && (await open.text()) === 'world', `${part.status} ${part.headers.get('content-range')}`)
  ok('one beyond the end is refused, and a whole file says it can be asked by range', past.status === 416 && whole.status === 200 && whole.headers.get('accept-ranges') === 'bytes' && (await whole.text()) === 'hello world')
  const big = Buffer.alloc(12 * 1024 * 1024, 'abcdefghij')
  const sent = await lan(note('big.bin'), { method: 'PUT', headers: { ...shell, 'content-type': 'application/octet-stream' }, body: big })
  const received = Buffer.from(await (await lan(note('big.bin'), { headers: shell })).arrayBuffer())
  // The vault opened last is the one a request that names none is about: Second.
  const bigPath = path.join(secondVault, 'big.bin')
  ok('a large file arrives whole, by a file of its own that is gone after', sent.status === 200 && received.equals(big) && fs.statSync(bigPath).size === big.length && !fs.readdirSync(secondVault).some((n) => n.endsWith('.flint-part')), `${sent.status}`)

  // ---- a key is not to be guessed at
  // A browser that keeps showing the same old cookie (the key was changed) is not guessing: it must not shut itself out.
  const stale = []
  for (let i = 0; i < 30; i++) stale.push((await lan('/api/tree', { headers: { cookie: 'flint-shell=a-key-that-was-changed' } })).status)
  ok('the same stale cookie shown thirty times is refused each time but locks nobody out', stale.every((code) => code === 401) && (await lan('/api/tree', { headers: shell })).status === 200, stale.join())
  const guesses = []
  for (let i = 0; i < 14; i++) guesses.push((await lan('/?key=wrong-key-number-' + i)).status)
  ok('after ten different wrong keys the sender is told to wait, even with the right one', guesses[0] === 401 && guesses.at(-1) === 429 && (await lan(`/?key=${key2}`)).status === 429, guesses.join())

  // ---- updating
  const status = await flintnotes('status')
  ok('`flintnotes status` says the version and that updates are on', status.code === 0 && status.text.includes(version) && /включены/.test(status.text), status.text)

  const newer = makeServer('9.9.9')
  feed = { ...newer, sha256: '0'.repeat(64) }
  const wrongSum = await flintnotes('update')
  ok('a download whose checksum is wrong is refused', /контрольная сумма/.test(wrongSum.text) && (await built()).version === version && !fs.existsSync(path.join(state, 'current')), wrongSum.text)
  ok('and leaves nothing half-unpacked behind', !fs.existsSync(path.join(state, 'releases')) || fs.readdirSync(path.join(state, 'releases')).every((name) => !name.endsWith('.part')))

  feed = newer
  const put = await flintnotes('update')
  ok('a newer server is put in', put.code === 0 && /9\.9\.9/.test(put.text) && fs.readlinkSync(path.join(state, 'current')) === 'releases/9.9.9', put.text)
  const second = await until(async () => (await built()).version === '9.9.9' && (await built()))
  ok('the launcher starts it in place of the old one, on the same port', second && second.build.endsWith('-9.9.9'), JSON.stringify(second))

  const broken = makeServer('9.9.10', (folder) => fs.writeFileSync(path.join(folder, 'server.mjs'), 'process.exit(1)\n'))
  feed = broken
  await until(async () => (await built()).version === '9.9.9')
  const bad = await flintnotes('update')
  ok('a build that does not start is put in too (nothing can tell before)', bad.code === 0 && /9\.9\.10/.test(bad.text), bad.text)
  const back = await until(async () => fs.existsSync(path.join(state, 'failed.json')) && (await built()).version === '9.9.9' && (await built()), 60)
  ok('and given up for the one before it', back && back.version === '9.9.9' && JSON.parse(fs.readFileSync(path.join(state, 'failed.json'), 'utf8')).includes('9.9.10'), JSON.stringify(back))
  const again = await flintnotes('update')
  ok('it is not fetched again', /не запустилась/.test(again.text) && (await built()).version === '9.9.9', again.text)

  // ---- stopping
  launcher.kill('SIGTERM')
  const stopped = await until(() => launcherExit !== undefined, 20)
  ok('SIGTERM stops the launcher and the server, in order', stopped && launcherExit === 0 && (await lan().then(() => false, () => true)), `exit ${launcherExit}`)
} finally {
  launcher.kill('SIGKILL')
  feedServer.close()
  const text = fs.readFileSync(path.join(dir, 'service.log'), 'utf8')
  if (results.includes(false)) console.log(`\n--- service.log\n${text.split('\n').slice(-40).join('\n')}`)
  try {
    execFileSync('pkill', ['-f', `${lib}/server.mjs`])
  } catch {}
  try {
    execFileSync('pkill', ['-f', path.join(state, 'releases')])
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true })
}
const failed = results.filter((one) => !one).length
console.log(failed ? `\nНе прошло: ${failed} из ${results.length}` : `\nВсе ${results.length} проверок прошли`)
process.exit(failed ? 1 : 0)
