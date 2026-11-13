/**
 * What the Windows shell knows about the server it is the window of: the address and key it was given (the link that
 * `flintnotes pair` prints), how to see whether that server is there, is FlintNotes, speaks the shell's protocol and takes
 * the key, and how the key is kept. Nothing here needs Electron, so desktop/main.ts only decides what to show of it
 * and e2e/shell-connection-check.mjs can try every case against a made-up server.
 */
import http from 'node:http'
import https from 'node:https'
import type { BuildInfo } from '../shared/protocol'

export interface Saved {
  /** `http://debian:4620`: scheme, host and port, no path. */
  origin: string
  key: string
}

/** The cookie the server keeps the shell's key in (server/index.ts, COOKIES). */
export const SHELL_COOKIE = 'flint-shell'

/** What was typed or pasted: the link of `flintnotes pair`, or just an address (then the key must be asked for). */
export function parseLink(text: string): { origin: string; key: string | null } | { error: string } {
  const typed = text.trim()
  if (!typed) return { error: 'Вставьте ссылку, которую показывает команда flintnotes pair на сервере' }
  let url: URL
  try {
    url = new URL(/^[a-z][\w+.-]*:\/\//i.test(typed) ? typed : `http://${typed}`)
  } catch {
    return { error: 'Это не похоже на адрес: нужно что-то вроде http://192.168.1.50:4620/?key=…' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'Адрес должен начинаться с http:// или https://' }
  if (!url.hostname) return { error: 'В адресе нет имени или номера сервера' }
  return { origin: url.origin, key: url.searchParams.get('key')?.trim() || null }
}

export type Probe =
  /** The server is there, speaks this protocol and took the key. */
  | { state: 'ok'; info: BuildInfo }
  /** The server is there but the key did not open it (it was changed, or is wrong). */
  | { state: 'locked' }
  /** Nothing answered, or not as FlintNotes does; the words say what, for the person to read. */
  | { state: 'unreachable'; message: string }
  /** The server speaks a newer protocol than this app: the app needs an update. */
  | { state: 'newer-server'; info: BuildInfo; message: string }
  /** The server speaks an older one: the server needs an update (`flintnotes update`). */
  | { state: 'older-server'; info: BuildInfo; message: string }

const FAILURES: Record<string, string> = {
  ECONNREFUSED: 'на этом адресе ничего не слушает: служба FlintNotes не запущена или порт другой',
  ENOTFOUND: 'такого имени в сети нет',
  EHOSTUNREACH: 'до этого компьютера не дойти по сети',
  ENETUNREACH: 'нет сети',
  ETIMEDOUT: 'сервер не отвечает',
  ECONNRESET: 'соединение оборвалось',
}

interface Answer {
  status: number
  body: string
}

/** One request, with a time limit and a size limit; the failure's own code explains an error. */
function ask(url: URL, headers: Record<string, string>, timeout: number): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, { method: 'GET', headers, timeout }, (res) => {
      const parts: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1_000_000) return res.destroy(new Error('слишком большой ответ'))
        parts.push(chunk)
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8') }))
      res.on('error', reject)
    })
    request.on('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    request.on('error', reject)
    request.end()
  })
}

const words = (err: unknown) => {
  const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
  return (code && FAILURES[code]) || (err instanceof Error ? err.message : String(err))
}

/**
 * Whether the server at `origin` can be opened with `key` by an app that speaks `protocol`: the version it tells
 * without a key first (`/api/build`), then a request that needs the key (`/api/vaults`, which changes nothing).
 */
export async function probe(origin: string, key: string, protocol: number, timeout = 5000): Promise<Probe> {
  let build: Answer
  try {
    build = await ask(new URL('/api/build', origin), {}, timeout)
  } catch (err) {
    return { state: 'unreachable', message: words(err) }
  }
  if (build.status === 503) return { state: 'unreachable', message: 'сервер отвечает, но доступ по сети в нём выключен' }
  let info: BuildInfo | undefined
  try {
    const parsed = JSON.parse(build.body) as Partial<BuildInfo>
    if (build.status === 200 && typeof parsed.protocol === 'number' && typeof parsed.version === 'string') info = parsed as BuildInfo
  } catch {}
  if (!info) return { state: 'unreachable', message: 'по этому адресу отвечает не сервер FlintNotes' }
  if (info.protocol > protocol) return { state: 'newer-server', info, message: `сервер (${info.version}) новее приложения: обновите FlintNotes для Windows — значок в трее → «Проверить обновления»` }
  if (info.protocol < protocol) return { state: 'older-server', info, message: `сервер (${info.version}) старше приложения: на сервере выполните flintnotes update` }
  try {
    const checked = await ask(new URL('/api/vaults', origin), { cookie: `${SHELL_COOKIE}=${key}` }, timeout)
    if (checked.status === 200) return { state: 'ok', info }
    if (checked.status === 401) return { state: 'locked' }
    if (checked.status === 429) return { state: 'unreachable', message: 'слишком много неверных ключей: подождите минуту' }
    return { state: 'unreachable', message: `сервер ответил ${checked.status}` }
  } catch (err) {
    return { state: 'unreachable', message: words(err) }
  }
}

/** How long to wait before the next try after `attempt` failed ones: 2, 4, 8, 16 seconds, then every 30. */
export const nextDelay = (attempt: number): number => Math.min(30_000, 2000 * 2 ** Math.max(0, attempt))

/** What the system offers for keeping a secret (Electron's `safeStorage`). */
export interface Sealer {
  isEncryptionAvailable(): boolean
  encryptString(text: string): Buffer
  decryptString(data: Buffer): string
}

/** The key as it goes into the file: sealed by the system where it can, plain (the file is the user's own) where it cannot. */
export function sealKey(key: string, sealer: Sealer): { key: string; sealed: boolean } {
  if (!sealer.isEncryptionAvailable()) return { key, sealed: false }
  return { key: sealer.encryptString(key).toString('base64'), sealed: true }
}

/** The key back from the file; null if it cannot be read (the file came from another user's account or computer). */
export function openKey(stored: { key?: unknown; sealed?: unknown }, sealer: Sealer): string | null {
  if (typeof stored.key !== 'string' || !stored.key) return null
  if (stored.sealed !== true) return stored.key
  try {
    return sealer.decryptString(Buffer.from(stored.key, 'base64'))
  } catch {
    return null
  }
}
