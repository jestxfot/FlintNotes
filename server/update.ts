/**
 * The service updates itself, apart from the Windows shell: the server's program (server.mjs, the page in public/,
 * build.json) is published as `flintnotes-server-<version>.tar.gz` with a small feed, `server-latest.json`, under a
 * release of its own, so a new server never has to wait for a new shell. The updater looks soon after the start and
 * every few hours; a newer program is downloaded, checked against its checksum, unpacked beside the others in
 * `<state>/releases/`, and made `current`. The launcher (server/launcher.ts) sees the new build.json, has this server
 * finish its saves and step aside, and starts the new one; if that one does not start, it goes back
 * (server/releases.ts). The layout is described there.
 *
 * What the checksum does and does not give: it shows the download is whole and is what the feed names. Both come from
 * the same place, so it is no proof of who made them.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { isNewer, isVersion } from '../shared/version'
import { flipTo, prune, readBuild, readFailed } from './releases'
import { describe, webFetch } from './web'

const run = promisify(execFile)

/** The rolling release `server` of the project holds the newest server; the shell's own releases are another tag's. */
export const DEFAULT_FEED = 'https://github.com/jestxfot/FlintNotes/releases/download/server/server-latest.json'

/** What the feed says of the newest server. */
export interface ServerFeed {
  version: string
  /** The tarball's name, beside the feed. */
  file: string
  sha256: string
  size?: number
}

export interface UpdateOptions {
  /** The service's folder for what it keeps (`/var/lib/flintnotes`). */
  state: string
  /** The version running now. */
  version: string
  feed: string
}

export interface UpdateStatus {
  /** What the last look found, in words. */
  result: string
  /** The version put in by that look, waiting for the launcher to start it. */
  installed?: string
  checkedAt?: number
}

/** Reads the feed and refuses anything that is not what a feed looks like: its names become file names. */
export function parseFeed(text: string): ServerFeed {
  const data = JSON.parse(text) as Partial<ServerFeed>
  if (!isVersion(data.version)) throw new Error('в ленте нет версии')
  if (typeof data.file !== 'string' || !/^[\w.-]+\.tar\.gz$/.test(data.file)) throw new Error('в ленте странное имя файла')
  if (typeof data.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(data.sha256)) throw new Error('в ленте нет контрольной суммы')
  return { version: data.version, file: data.file, sha256: data.sha256, size: typeof data.size === 'number' ? data.size : undefined }
}

let status: UpdateStatus = { result: 'ещё не проверяли' }
let busy = false

export const lastUpdateStatus = () => status

/** Looks for a newer server and puts it in; never throws, what happened is in the answer. */
export async function checkServerUpdate(options: UpdateOptions): Promise<UpdateStatus> {
  if (busy) return { ...status, result: 'проверка уже идёт' }
  busy = true
  try {
    status = { ...(await look(options)), checkedAt: Date.now() }
  } catch (err) {
    status = { result: `Не удалось проверить обновления: ${describe(err)}`, checkedAt: Date.now() }
    console.error(status.result)
  } finally {
    busy = false
  }
  return status
}

async function look({ state, version, feed }: UpdateOptions): Promise<UpdateStatus> {
  const listed = await webFetch(feed, { timeout: 20_000, limit: 100_000 })
  if (listed.status !== 200) throw new Error(`лента ответила ${listed.status}`)
  const latest = parseFeed(listed.bytes.toString('utf8'))
  if (!isNewer(latest.version, version)) return { result: `Установлена последняя версия (${version})` }
  if (readFailed(state).includes(latest.version)) return { result: `Версия ${latest.version} уже не запустилась здесь, пропускаю` }

  const releases = path.join(state, 'releases')
  const target = path.join(releases, latest.version)
  if (!readBuild(target)) {
    await fs.mkdir(releases, { recursive: true })
    const part = path.join(releases, `.${latest.version}.part`)
    await fs.rm(part, { recursive: true, force: true })
    await fs.mkdir(part)
    try {
      const got = await webFetch(new URL(latest.file, feed).href, { timeout: 600_000, limit: 300_000_000 })
      if (got.status !== 200) throw new Error(`файл ответил ${got.status}`)
      if (createHash('sha256').update(got.bytes).digest('hex') !== latest.sha256) throw new Error('контрольная сумма не сошлась')
      const tarball = path.join(part, 'payload.tar.gz')
      await fs.writeFile(tarball, got.bytes)
      await run('tar', ['-xzf', tarball, '-C', part, '--no-same-owner', '--no-same-permissions'])
      await fs.rm(tarball)
      const built = readBuild(part)
      if (built?.version !== latest.version || !(await fs.stat(path.join(part, 'public', 'index.html')).catch(() => null))) throw new Error('в архиве не та сборка')
      await fs.rm(target, { recursive: true, force: true })
      await fs.rename(part, target)
    } catch (err) {
      await fs.rm(part, { recursive: true, force: true })
      throw err
    }
  }
  flipTo(state, latest.version)
  prune(state)
  console.log(`Обновление: ${version} → ${latest.version}; сервер перезапустится сам`)
  return { result: `Версия ${latest.version} установлена, сервер перезапускается`, installed: latest.version }
}

/** Looks soon after the start, then every few hours. */
export function startServerUpdates(options: UpdateOptions, { first = 60_000, every = 3 * 3_600_000 } = {}): void {
  setTimeout(() => void checkServerUpdate(options), first).unref()
  setInterval(() => void checkServerUpdate(options), every).unref()
}
