// Nothing of this computer may go out with a build: its folders, the name and address its git signs with.
// Used by the installer (scripts/installer.mjs).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

const gitConfig = (key) => {
  try {
    return execFileSync('git', ['config', key], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

// Built from a copy of the commit (scripts/publish-build.mjs), the project's own folder is looked for too.
export const personal = [ROOT, process.env.FLINT_PROJECT ?? '', os.homedir(), gitConfig('user.name'), gitConfig('user.email')].filter((mark) => mark.length > 3)

export const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))

/** Stops the build if any text file under `dir` carries something personal. */
export function assertNothingPersonal(dir) {
  for (const file of walk(dir).filter((one) => /\.(mjs|cjs|js|json|html|css|txt|map|md|service|default|conf)$|(^|\/)(control|postinst|prerm|postrm|flintnotes)$/.test(one))) {
    const text = fs.readFileSync(file, 'utf8')
    const found = personal.find((mark) => text.includes(mark))
    if (found) throw new Error(`В сборку попало бы личное («${found}») в ${path.relative(dir, file)}: сборка остановлена`)
  }
}
