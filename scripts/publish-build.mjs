// `npm run installer`: builds what is published (scripts/installer.mjs) from the last commit only, never from
// the working folder: other work in progress there (not committed yet) must not go out to everyone.
// The commit is checked out into a temporary folder beside the project's node_modules; the result lands in publish/.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const commit = git('rev-parse', '--short', 'HEAD')
const changed = git('status', '--porcelain', '--untracked-files=no')
if (changed) console.log(`Собираю из коммита ${commit}; несохранённые в git изменения в сборку не попадут:\n${changed}`)

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-publish-'))
const tree = path.join(work, 'FlintNotes')
git('worktree', 'add', '--detach', tree, 'HEAD')
try {
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tree, 'node_modules'), 'dir')
  const env = { ...process.env, FLINT_PROJECT: ROOT, FLINT_RELEASE_OUT: path.join(tree, 'release'), FLINT_PUBLISH_OUT: process.env.FLINT_PUBLISH_OUT ?? path.join(ROOT, 'publish') }
  execFileSync(process.execPath, ['scripts/release.mjs'], { cwd: tree, env, stdio: 'inherit' })
  execFileSync(process.execPath, ['scripts/installer.mjs'], { cwd: tree, env, stdio: 'inherit' })
} finally {
  git('worktree', 'remove', '--force', tree)
  fs.rmSync(work, { recursive: true, force: true })
}
