/**
 * Where the service's program lives, and how it is swapped. Shared by the launcher (which runs it, and falls back
 * when a new one does not start) and the updater (server/update.ts, which puts a new one in).
 *
 *   /usr/lib/flintnotes/            what the package installed: the launcher, the CLI, and the program it came with
 *   <state>/releases/<version>/     a program downloaded since: server.mjs, public/, build.json
 *   <state>/current                 a link to the one of those that is wanted (the launcher watches its build.json)
 *   <state>/previous                a link to the one that ran before, to go back to
 *   <state>/failed.json             versions that did not start; the updater does not fetch them again
 *
 * The program that runs is `current` unless the package brought a newer one (an upgrade of the package must win).
 */
import fs from 'node:fs'
import path from 'node:path'
import { isNewer } from '../shared/version'

export interface BuildFile {
  id?: string
  version?: string
}

/** The `build.json` of a program folder; null if there is no program there (a link that leads nowhere, half a download). */
export function readBuild(dir: string): BuildFile | null {
  try {
    if (!fs.existsSync(path.join(dir, 'server.mjs'))) return null
    return JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')) as BuildFile
  } catch {
    return null
  }
}

/** The folder of the program to run: the downloaded one, unless the package's own is newer (or there is none downloaded). */
export function pickApp(bundled: string, state?: string): string {
  if (!state) return bundled
  const current = path.join(state, 'current')
  const downloaded = readBuild(current)
  if (!downloaded?.version) return bundled
  const own = readBuild(bundled)
  return own?.version && isNewer(own.version, downloaded.version) ? bundled : current
}

const failedFile = (state: string) => path.join(state, 'failed.json')

/** Versions that were put in and did not start. */
export function readFailed(state: string): string[] {
  try {
    const list: unknown = JSON.parse(fs.readFileSync(failedFile(state), 'utf8'))
    return Array.isArray(list) ? list.filter((one): one is string => typeof one === 'string') : []
  } catch {
    return []
  }
}

/** Points `link` at `target` (relative to the link's folder) in one step: a reader sees the old link or the new, never none. */
export function relink(link: string, target: string): void {
  const next = `${link}.new`
  fs.rmSync(next, { force: true })
  fs.symlinkSync(target, next)
  fs.renameSync(next, link)
}

/** Where a link points, or undefined when there is no such link. */
const linkTarget = (link: string): string | undefined => {
  try {
    return fs.readlinkSync(link, { encoding: 'utf8' })
  } catch {
    return undefined
  }
}

/** Makes `releases/<version>` the program to run; the one that ran is kept as `previous`. */
export function flipTo(state: string, version: string): void {
  const was = linkTarget(path.join(state, 'current'))
  if (was && was !== `releases/${version}`) relink(path.join(state, 'previous'), was)
  relink(path.join(state, 'current'), `releases/${version}`)
}

/**
 * The downloaded program does not start: it is noted as failed and put away; the one before it comes back, or, with
 * none, the package's own runs. Returns the version given up, if there was one.
 */
export function rollBack(state: string): string | undefined {
  const current = path.join(state, 'current')
  const version = readBuild(current)?.version
  if (version) fs.writeFileSync(failedFile(state), JSON.stringify([...new Set([...readFailed(state), version])]))
  fs.rmSync(current, { force: true })
  const previous = path.join(state, 'previous')
  if (readBuild(previous)) {
    fs.renameSync(previous, current)
  }
  return version
}

/** Keeps the program in use, the one before, and the newest few; the rest of `releases/` goes. */
export function prune(state: string, keep = 2): void {
  const releases = path.join(state, 'releases')
  const used = new Set(['current', 'previous'].flatMap((name) => linkTarget(path.join(state, name)) ?? []).map((target) => path.basename(target)))
  const others = fs
    .readdirSync(releases)
    .filter((name) => !name.startsWith('.') && !used.has(name))
    .sort((a, b) => (isNewer(a, b) ? -1 : 1))
  for (const name of others.slice(Math.max(0, keep - used.size))) fs.rmSync(path.join(releases, name), { recursive: true, force: true })
}
