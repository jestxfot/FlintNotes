// What the suites found last time, so that a run does not start from scratch: a suite that passed is passed
// over while nothing it depends on has changed. FLINT_E2E_FRESH=1 runs everything anyway.
//
// A suite depends on:
// - its own file, the runner, the helpers and the fixtures;
// - the server's code and the files the page gets as they are (`public`);
// - today's date: some suites count days;
// - the files of the build the page loaded while the suite ran: the core and the plugins it switched on, no others.
//
// The build's files are told apart by what they hold, not by their names. A name carries a hash of the file, and
// a file that names other files changes whenever they do: the core lists every plugin's file, so a change of one
// plugin would otherwise make every suite run again. Those names are read as if their hashes were blanked out.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './helpers.mjs'

const FILE = path.join(ROOT, 'node_modules/.cache/flint-e2e.json')
const HASHED = /([\w.-]+?)-[\w-]{8}\.(js|css|wasm|woff2?)\b/g

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 20)

/** Every file under `dir` (relative paths), sorted. */
function files(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name)))
    .sort()
}

const tree = (dir) => sha(files(dir).map((file) => `${file}\n${sha(fs.readFileSync(path.join(dir, file)))}`).join('\n'))

/** A file of the build by what it holds, with the hashes in the names of other files blanked out. */
const content = (file) => {
  const data = fs.readFileSync(file)
  return /\.(js|css|html|json|mjs)$/.test(file) ? sha(data.toString('utf8').replace(HASHED, '$1-#.$2')) : sha(data)
}

/** `built`: the folder the page's files are served from; `server`: files of the server beyond the sources (a release's). */
export function openCache(built, server = []) {
  const fresh = process.env.FLINT_E2E_FRESH === '1'
  let kept = {}
  try {
    kept = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    // Nothing kept yet.
  }
  // What every suite depends on alike.
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date())
  const common = sha(
    [
      today,
      built,
      ...['e2e/run.mjs', 'e2e/helpers.mjs', 'e2e/cache.mjs'].map((file) => sha(fs.readFileSync(path.join(ROOT, file)))),
      ...['e2e/fixtures', 'server', 'shared', 'public'].map((dir) => tree(path.join(ROOT, dir))),
      ...server.filter((file) => fs.existsSync(file)).map((file) => sha(fs.readFileSync(file))),
    ].join('\n'),
  )
  // The build as it is now: what each of its files holds.
  const now = new Set(files(built).map((file) => content(path.join(built, file))))
  const keyOf = (suite) => sha(`${common}\n${sha(fs.readFileSync(path.join(ROOT, 'e2e/suites', suite)))}`)

  return {
    /** The number of checks a suite passed with last time, if nothing it depends on has changed since. */
    passed(suite) {
      const entry = kept[suite]
      if (fresh || !entry || entry.key !== keyOf(suite)) return null
      return entry.loaded.every((hash) => now.has(hash)) ? entry.checks : null
    },
    /** A suite passed: what it loaded of the build (paths under it) is put down with it. */
    pass(suite, loaded, checks) {
      // The page's threads load their files themselves, out of the page's sight: they count for every suite.
      for (const file of files(built)) if (/worker/i.test(file)) loaded.add(file)
      const hashes = [...new Set([...loaded].filter((file) => fs.existsSync(path.join(built, file))).map((file) => content(path.join(built, file))))]
      kept[suite] = { key: keyOf(suite), loaded: hashes.sort(), checks }
      this.save()
    },
    fail(suite) {
      delete kept[suite]
      this.save()
    },
    save() {
      fs.mkdirSync(path.dirname(FILE), { recursive: true })
      fs.writeFileSync(FILE, JSON.stringify(kept))
    },
  }
}
