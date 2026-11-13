// Checks the service as it runs on the Debian computer, without systemd: the build is made as `npm run release`
// makes it, the script service/flintnotes writes its service file, and the launcher is run in service mode
// (FLINT_SERVICE=1) with a state folder of its own, as the service file runs it.
//   - the script is valid sh, and the service file it writes is one systemd reads, runs as the folder's owner and
//     lets Node ask for the system's addresses (AF_NETLINK)
//   - the first start makes the key and turns the network listener on; the key is told without a page
//     (`flintnotes pair`) and a new key shuts out the old
//   - the shell's key, a phone's key and the computer's own each reach only what they may
//   - files: ranges and large uploads; wrong keys are counted; SIGTERM stops the launcher and the server in order
// Builds into a temporary folder; the project's release/ is not touched. About a minute:
//   node e2e/service-check.mjs
import { execFile, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
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

// ---- the build, as `npm run release` makes it
const release = path.join(dir, 'release')
execFileSync(process.execPath, ['scripts/release.mjs'], { cwd: ROOT, env: { ...process.env, FLINT_RELEASE_OUT: release }, stdio: 'ignore' })
const version = JSON.parse(fs.readFileSync(path.join(release, 'build.json'), 'utf8')).version
const lib = release
ok('the build holds the launcher, the command and the program', ['launcher.mjs', 'cli.mjs', 'server.mjs', 'build.json', 'public/index.html'].every((file) => fs.existsSync(path.join(lib, file))))

// ---- the script and the service file it writes
const script = path.join(ROOT, 'service', 'flintnotes')
const sh = (...args) => {
  try {
    return { code: 0, text: execFileSync('sh', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (err) {
    return { code: err.status, text: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}
ok('the script is valid sh, and runnable by dash', execFileSync('sh', ['-n', script]) !== null && (!fs.existsSync('/usr/bin/dash') || execFileSync('/usr/bin/dash', ['-n', script]) !== null))
ok('it is executable', (fs.statSync(script).mode & 0o111) !== 0)
const notes = fs.mkdtempSync(path.join(dir, 'notes-'))
const shown = sh('unit', notes)
const owner = os.userInfo().username
ok(
  '`unit` writes the service file: the owner of the folder, the launcher of this project, the first vault, what Node needs',
  shown.code === 0 && shown.text.includes(`User=${owner}`) && /ExecStart=\S+\/node \S+\/release\/launcher\.mjs/.test(shown.text) && shown.text.includes(`FLINT_FIRST_VAULT=${notes}`) && /RestrictAddressFamilies=.*AF_NETLINK/.test(shown.text),
  shown.text,
)
const lintDir = fs.mkdtempSync(path.join(dir, 'lint-'))
fs.writeFileSync(path.join(lintDir, 'flintnotes.service'), shown.text)
let lint = ''
try {
  lint = execFileSync('systemd-analyze', ['verify', path.join(lintDir, 'flintnotes.service')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (err) {
  lint = String(err.stderr ?? err)
}
ok('that file is one systemd reads', !/Failed to parse|Unknown (section|key)|Invalid|Unknown lvalue/i.test(lint), lint)
const odd = [sh('unit', '/tmp/a folder with spaces'), sh('unit', '/tmp/100%'), sh('install', path.join(dir, 'no-such-folder'))]
ok('a path a service file cannot hold, or a folder that is not there, is refused with words', odd.every((r) => r.code !== 0 && r.text.trim().length > 20), odd.map((r) => r.text.trim().slice(0, 60)).join(' | '))
ok('with no word it says what it does', sh().text.includes('install') && sh().text.includes('pair'))

// ---- the launcher, run as the service file runs it
const state = path.join(dir, 'state')
const vaults = path.join(state, 'vaults')
fs.mkdirSync(vaults, { recursive: true })
const config = path.join(state, 'config.json')
const LAN = 4842
const ADMIN = 4841
fs.writeFileSync(config, JSON.stringify({ phone: { port: LAN, host: '127.0.0.1' } }))
const serviceEnv = { ...process.env, FLINT_SERVICE: '1', FLINT_STATE_DIR: state, FLINT_CONFIG: config, FLINT_CACHE: path.join(dir, 'cache'), FLINT_FIRST_VAULT: path.join(vaults, 'FlintNotes'), FLINT_PORT: String(ADMIN) }
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
  const refused = [await post('/api/phone', { newKey: true }), await post('/api/shell', { newKey: true }), await post('/api/proxy', { proxy: 'off' })]
  ok("the shell's key does not reach what is the server's own: keys, the proxy", refused.every((res) => res.status === 403), refused.map((res) => res.status).join())
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

  // ---- which folders are vaults is the owner's, at the server itself: the window adds and forgets none, and looks through no folders
  const secondVault = path.join(vaults, 'Second')
  const own = (await (await lan('/api/vaults', { headers: shell })).json())[0].path
  const noNew = [
    await post('/api/vaults/open', { path: secondVault, create: true }),
    await post('/api/vaults/open', { path: path.join(dir, 'elsewhere'), create: true }),
    await lan('/api/dirs', { headers: shell }),
    await lan(`/api/dirs?path=${encodeURIComponent('/')}`, { headers: shell }),
    await post('/api/vaults/forget', { path: own }),
  ]
  ok('the window adds no vault, looks through no folders and forgets none', noNew.every((res) => res.status === 403) && !fs.existsSync(secondVault) && !fs.existsSync(path.join(dir, 'elsewhere')), noNew.map((r) => r.status).join())
  ok('it can switch to a vault that exists', (await post('/api/vaults/open', { path: own })).status === 200)
  const added = await flintnotes('vault', secondVault, '--create')
  ok('`flintnotes vault <folder> --create`, at the server itself, makes a vault', added.code === 0 && fs.existsSync(secondVault) && (await (await lan('/api/vaults', { headers: shell })).json()).some((v) => v.path === secondVault), added.text)
  ok('the window can then switch to it, and still cannot forget it', (await post('/api/vaults/open', { path: secondVault })).status === 200 && (await post('/api/vaults/forget', { path: secondVault })).status === 403)
  const missing = await flintnotes('vault', path.join(dir, 'no-such-vault'))
  ok('a folder that is not there does not become a vault without --create', missing.code !== 0 && !fs.existsSync(path.join(dir, 'no-such-vault')), missing.text)

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

  const status = await flintnotes('status')
  ok('`flintnotes status` says the version', status.code === 0 && status.text.includes(version), status.text)

  // ---- `install` and `remove` as root does them, with stand-ins for sudo, systemctl and the rest (nothing of the system is touched)
  if (process.getuid() !== 0) {
    const proj = path.join(dir, 'proj')
    fs.mkdirSync(path.join(proj, 'service'), { recursive: true })
    fs.copyFileSync(script, path.join(proj, 'service', 'flintnotes'))
    fs.chmodSync(path.join(proj, 'service', 'flintnotes'), 0o755)
    fs.cpSync(release, path.join(proj, 'release'), { recursive: true })
    const fake = path.join(dir, 'fake-bin')
    const unitDir = path.join(dir, 'units')
    const binDir = path.join(dir, 'bin')
    const calls = path.join(dir, 'calls.log')
    for (const folder of [fake, unitDir, binDir]) fs.mkdirSync(folder)
    const stub = (name, body) => fs.writeFileSync(path.join(fake, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    stub('sudo', 'exec "$@"')
    stub('id', 'if [ "$1" = -u ]; then echo 0; else exec /usr/bin/id "$@"; fi')
    for (const name of ['systemctl', 'apt-get']) stub(name, `echo "${name} $*" >> ${calls}`)
    stub('dpkg', `echo "dpkg $*" >> ${calls}; exit 1`)
    stub('getent', 'exit 2')
    stub('journalctl', 'true')
    const asRoot = { ...process.env, PATH: `${fake}:${process.env.PATH}`, FLINT_UNIT_DIR: unitDir, FLINT_BIN_DIR: binDir, FLINT_PORT: String(ADMIN) }
    const run = async (file, ...args) => {
      try {
        return { code: 0, text: (await promisify(execFile)(file, args, { env: asRoot, encoding: 'utf8' })).stdout }
      } catch (err) {
        return { code: err.code, text: `${err.stdout ?? ''}${err.stderr ?? ''}` }
      }
    }
    const installed = await run(path.join(proj, 'service', 'flintnotes'), 'install', notes)
    const written = fs.existsSync(path.join(unitDir, 'flintnotes.service')) ? fs.readFileSync(path.join(unitDir, 'flintnotes.service'), 'utf8') : ''
    const log = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''
    ok('`install` as root goes through: it writes the service file for this folder and the vault named', installed.code === 0 && written.includes(`WorkingDirectory=${proj}`) && written.includes(`FLINT_FIRST_VAULT=${notes}`) && fs.existsSync(path.join(proj, '.service')), installed.text)
    ok('it reloads systemd, enables and starts the service, and prints the link with the key', /systemctl daemon-reload/.test(log) && /systemctl enable --now flintnotes/.test(log) && /\?key=/.test(installed.text), `${log}\n${installed.text}`)
    ok('it makes the command `flintnotes`, which is the same script', fs.existsSync(path.join(binDir, 'flintnotes')) && fs.realpathSync(path.join(binDir, 'flintnotes')) === fs.realpathSync(path.join(proj, 'service', 'flintnotes')))
    const gone = await run(path.join(binDir, 'flintnotes'), 'remove')
    ok('`flintnotes remove` (through the link) takes the service file and the command away, and keeps the folder', gone.code === 0 && !fs.existsSync(path.join(unitDir, 'flintnotes.service')) && !fs.existsSync(path.join(binDir, 'flintnotes')) && fs.existsSync(path.join(proj, '.service')) && /systemctl disable --now flintnotes/.test(fs.readFileSync(calls, 'utf8')), gone.text)
  }

  // ---- stopping
  launcher.kill('SIGTERM')
  const stopped = await until(() => launcherExit !== undefined, 20)
  ok('SIGTERM stops the launcher and the server, in order', stopped && launcherExit === 0 && (await lan().then(() => false, () => true)), `exit ${launcherExit}`)
} finally {
  launcher.kill('SIGKILL')
  const text = fs.readFileSync(path.join(dir, 'service.log'), 'utf8')
  if (results.includes(false)) console.log(`\n--- service.log\n${text.split('\n').slice(-40).join('\n')}`)
  try {
    execFileSync('pkill', ['-f', `${lib}/server.mjs`])
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true })
}
const failed = results.filter((one) => !one).length
console.log(failed ? `\nНе прошло: ${failed} из ${results.length}` : `\nВсе ${results.length} проверок прошли`)
process.exit(failed ? 1 : 0)
