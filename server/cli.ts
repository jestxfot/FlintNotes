/**
 * `service/flintnotes pair|status` run this: what is done at the Debian computer itself, not from the Windows shell or a phone.
 *
 *   pair [--phone] [--rotate]    the address with the key, as text and as a QR code: for the Windows app, or with --phone
 *                                for phones (a key of their own, which may do less); --rotate makes a new key, which shuts
 *                                out everything paired with the old
 *   status                       the version running
 *   vault <folder> [--create]    makes a folder a vault of this server (the window and phones cannot add vaults): it opens at the
 *                                next start of the window; --create makes the folder if it is not there
 *
 * It talks to the running service on its own computer (127.0.0.1, the port of FLINT_PORT), which answers the
 * computer's own requests without a key; the network listener never does. With the service stopped, `pair` reads the
 * key from the config file (a new key needs the service).
 */
import { renderUnicodeCompact } from 'uqr'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CONFIG = process.env.FLINT_CONFIG ?? path.join(os.homedir(), '.flintnotes.json')
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
  const info = await admin<{ version: string; protocol: number; build: string }>('/api/build')
  console.log(`FlintNotes ${info.version} (протокол ${info.protocol}, сборка ${info.build})`)
}

async function vault(args: string[]): Promise<void> {
  const given = args.find((arg) => !arg.startsWith('--'))
  if (!given) throw new Error('service/flintnotes vault <папка с заметками> [--create]')
  const opened = await admin<{ name: string; path: string }>('/api/vaults/open', { path: path.resolve(given), create: args.includes('--create') })
  console.log(`Хранилище «${opened.name}» (${opened.path}) теперь у сервера. В окне оно в списке хранилищ (меню внизу слева).`)
}

const [command, ...rest] = process.argv.slice(2)
try {
  if (command === 'pair') await pair(rest.includes('--phone'), rest.includes('--rotate'))
  else if (command === 'status') await status()
  else if (command === 'vault') await vault(rest)
  else {
    console.log('service/flintnotes pair [--phone] [--rotate] | status | vault <папка> [--create]')
    process.exit(command ? 2 : 0)
  }
} catch (err) {
  const reason = (err as Error).cause ? 'служба не отвечает (systemctl status flintnotes)' : (err as Error).message
  console.error(`flintnotes: ${reason}`)
  process.exit(1)
}
