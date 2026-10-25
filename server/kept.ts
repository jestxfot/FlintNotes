import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { VaultEntry } from '../shared/protocol'
import type { TreeStore } from './tree-cache'

/**
 * What the server keeps between its runs to start faster, in the system's temporary folder: nothing
 * there is needed, all of it can be made again from the vault (it is, when the folder is cleaned).
 */
export const KEPT_DIR = process.env.FLINT_CACHE ?? path.join(os.tmpdir(), 'FlintNotes')

/** Raised when the form of what is kept changes: an older file is then not read. */
const VERSION = 1

/** A vault's file in a few numbers: path, folder (1) or file (0), size, modification and creation time. */
type Packed = [string, 0 | 1, number, number, number]

const fileOf = (dir: string) => path.join(KEPT_DIR, 'trees', `${createHash('sha1').update(dir).digest('hex').slice(0, 20)}.json`)

/** The lists of the vaults' files, kept on disk by the vault's folder. */
export const keptTrees: TreeStore = {
  async read(dir) {
    const data = JSON.parse(await fs.readFile(fileOf(dir), 'utf8'))
    if (data?.version !== VERSION || data.dir !== dir || !Array.isArray(data.entries)) return null
    return (data.entries as Packed[]).map(([p, folder, size, mtime, ctime]) => ({ path: p, kind: folder ? 'folder' : 'file', size, mtime, ctime }))
  },
  async write(dir, entries) {
    const file = fileOf(dir)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const packed: Packed[] = entries.map((entry: VaultEntry) => [entry.path, entry.kind === 'folder' ? 1 : 0, entry.size, entry.mtime, entry.ctime])
    // Written beside and then put in place: a server stopped halfway leaves the last whole list, never a broken one.
    const temp = `${file}.${process.pid}.tmp`
    await fs.writeFile(temp, JSON.stringify({ version: VERSION, dir, entries: packed }))
    await fs.rename(temp, file)
  },
}

/**
 * Runs at most `limit` of the given jobs at once. A walk of a large vault asks the disk about tens of thousands
 * of files; all at once, they fill the few threads Node reads files with, and the page's own requests
 * (its settings, the note it opens) would wait behind every one of them.
 */
export function limiter(limit: number): <T>(job: () => Promise<T>) => Promise<T> {
  let running = 0
  const waiting: (() => void)[] = []
  return async (job) => {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    running++
    try {
      return await job()
    } finally {
      running--
      waiting.shift()?.()
    }
  }
}
