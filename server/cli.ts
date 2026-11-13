/**
 * `flintnotes`: what is done at the Debian computer itself, not from the Windows shell or a phone.
 *
 *   flintnotes pair [--phone] [--rotate]
 *                                the address with the key, as text and as a QR code: for the Windows app, or with --phone
 *                                for phones (a key of their own, which may do less); --rotate makes a new key, which shuts
 *                                out everything paired with the old
 *   flintnotes status            the version running, and what the last look for updates found
 *   flintnotes update            looks for a newer version now
 *   flintnotes vault <folder>    the service takes over a folder of notes that belongs to a person (a Samba share, an Obsidian vault):
 *                                it runs as the folder's owner and sees nothing else of the home; needs root. --print only shows
 *                                the change, --remove takes it away
 *   flintnotes version
 *
 * It talks to the running service on its own computer (127.0.0.1, the port of FLINT_PORT), which answers the
 * computer's own requests without a key; the network listener never does. With the service stopped, `pair` reads the
 * key from the config file (a new key needs the service).
 */
import { renderUnicodeCompact } from 'uqr'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DROP_IN, DROP_IN_DIR, dropIn, folderProblem } from './adopt'

const CONFIG = process.env.FLINT_CONFIG ?? '/var/lib/flintnotes/config.json'
const ADMIN = `127.0.0.1:${Number(process.env.FLINT_PORT) || 4600}`

interface PhoneInfo {
  on: boolean
  port: number
  key: string | null
  addresses: string[]
  error?: string | null
}

/** A request to the service on this computer; it wants an Origin of its own address, as a page of the app would send. */
async function admin<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`http://${ADMIN}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: `http://${ADMIN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `ответ ${res.status}`)
  return (await res.json()) as T
}

/** The key and port as the config file has them: for when the service is not running. */
function fromConfig(who: 'shell' | 'phone'): PhoneInfo {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as { phone?: { port?: number; key?: string; host?: string }; shell?: { key?: string } }
  const key = config[who]?.key
  if (!key) throw new Error(`в ${CONFIG} ещё нет ключа: запустите службу (systemctl start flintnotes)${who === 'phone' ? ' и выполните flintnotes pair --phone' : ', она сделает его сама'}`)
  const port = config.phone?.port ?? 4620
  const hosts = config.phone?.host && config.phone.host !== '0.0.0.0' ? [config.phone.host] : lanAddresses()
  return { on: true, port, key, addresses: hosts.map((host) => `http://${host}:${port}`) }
}

const lanAddresses = () =>
  Object.values(os.networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((one) => one.family === 'IPv4' && !one.internal && !one.address.startsWith('169.254.'))
    .map((one) => one.address)

async function pair(phone: boolean, rotate: boolean): Promise<void> {
  const route = phone ? '/api/phone' : '/api/shell'
  let info: PhoneInfo
  try {
    // The phones' key does not exist until it is asked for; the shell's is made by the first start.
    info = await admin<PhoneInfo>(route, rotate ? { on: true, newKey: true } : undefined)
    if (!info.key) info = await admin<PhoneInfo>(route, { on: true })
  } catch (err) {
    if (rotate) throw new Error(`Новый ключ делает только работающая служба: ${(err as Error).message}`)
    if ((err as Error).cause === undefined) throw err
    info = fromConfig(phone ? 'phone' : 'shell')
  }
  if (!info.key) throw new Error('ключа нет: служба ещё не запускалась')
  if (info.error) console.error(`Внимание: ${info.error}`)
  if (!info.addresses.length) info.addresses = [`http://<адрес этого компьютера>:${info.port}`]
  console.log(rotate ? 'Новый ключ. Всё, что было подключено раньше, больше не откроется.\n' : phone ? 'Подключение телефона к FlintNotes.\n' : 'Подключение приложения FlintNotes для Windows.\n')
  for (const address of info.addresses) {
    const link = `${address}/?key=${info.key}`
    console.log(`  ${link}\n`)
    if (address === info.addresses[0]) console.log(`${renderUnicodeCompact(link, { border: 2 })}\n`)
  }
  console.log(phone ? 'Наведите камеру телефона на QR-код или откройте ссылку в его браузере.' : 'В приложении FlintNotes для Windows: «Адрес сервера» — эта ссылка целиком. Для телефона: flintnotes pair --phone')
  console.log('Ссылка с ключом открывает все заметки: не пересылайте её. Сеть без шифрования — только домашняя.')
}

async function status(): Promise<void> {
  const info = await admin<{ version: string; protocol: number; build: string; updates: boolean; status: { result: string; checkedAt?: number } }>('/api/server')
  console.log(`FlintNotes ${info.version} (протокол ${info.protocol}, сборка ${info.build})`)
  console.log(`Обновления: ${info.updates ? 'включены' : 'выключены'}; ${info.status.result}${info.status.checkedAt ? ` (${new Date(info.status.checkedAt).toLocaleString('ru')})` : ''}`)
}

async function update(): Promise<void> {
  console.log((await admin<{ result: string }>('/api/server/update', {})).result)
}

/** The name of a user or group by its number, as the system's own database has it. */
function nameOf(database: 'passwd' | 'group', id: number): string {
  const line = execFileSync('getent', [database, String(id)], { encoding: 'utf8' }).trim()
  const name = line.split(':')[0]
  if (!name) throw new Error(`в системе нет ${database === 'passwd' ? 'пользователя' : 'группы'} с номером ${id}`)
  return name
}

/** Restarts the service and waits until it answers again. */
async function restarted(): Promise<void> {
  execFileSync('systemctl', ['daemon-reload'])
  execFileSync('systemctl', ['restart', 'flintnotes'])
  for (let tries = 0; tries < 180; tries++) {
    if (await fetch(`http://${ADMIN}/api/build`).then((res) => res.ok, () => false)) return
    await new Promise((resume) => setTimeout(resume, 500))
  }
  throw new Error('служба не поднялась за 90 секунд (journalctl -u flintnotes)')
}

async function vault(args: string[]): Promise<void> {
  const root = process.getuid?.() === 0
  if (args.includes('--remove')) {
    if (!root) throw new Error('нужны права root: sudo flintnotes vault --remove')
    rmSync(DROP_IN, { force: true })
    await restarted()
    console.log('Готово: служба снова работает от своего пользователя, в своих папках. Хранилище, которое она уже знала, остаётся в списке.')
    return
  }
  const given = args.find((arg) => !arg.startsWith('--'))
  if (!given) throw new Error('flintnotes vault <папка с заметками> [--print] | --remove')
  const folder = path.resolve(given)
  const problem = folderProblem(folder)
  if (problem) throw new Error(problem)
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`${folder}: такой папки нет`)
  const { uid, gid } = statSync(folder)
  if (uid === 0) throw new Error(`${folder} принадлежит root: служба не работает от root. Отдайте папку человеку (chown) или укажите другую`)
  const text = dropIn(folder, nameOf('passwd', uid), nameOf('group', gid))
  if (args.includes('--print')) return void console.log(text)
  if (!root) throw new Error(`нужны права root: sudo flintnotes vault ${folder}\n\nЭто допишет в ${DROP_IN}:\n${text}`)
  mkdirSync(DROP_IN_DIR, { recursive: true })
  writeFileSync(DROP_IN, text, { mode: 0o644 })
  await restarted()
  // The service is the owner of the folder now; the computer's own answer opens it as the vault the next start leads to.
  const opened = await admin<{ name: string; path: string }>('/api/vaults/open', { path: folder })
  console.log(`Готово: служба работает от ${nameOf('passwd', uid)} и открыла «${opened.name}» (${opened.path}).`)
}

const [command, ...rest] = process.argv.slice(2)
try {
  if (command === 'pair') await pair(rest.includes('--phone'), rest.includes('--rotate'))
  else if (command === 'status') await status()
  else if (command === 'update') await update()
  else if (command === 'vault') await vault(rest)
  else if (command === 'version') console.log((await admin<{ version: string }>('/api/build')).version)
  else {
    console.log('flintnotes pair [--phone] [--rotate] | status | update | vault <папка> | version')
    process.exit(command ? 2 : 0)
  }
} catch (err) {
  const reason = (err as Error).cause ? 'служба не отвечает (systemctl status flintnotes)' : (err as Error).message
  console.error(`flintnotes: ${reason}`)
  process.exit(1)
}
