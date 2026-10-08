/** Helpers for vault-relative paths (always forward slashes, no leading slash). */

export const dirname = (path: string) => {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** File name without its extension; dotfiles like `.gitignore` are kept whole. */
export const stripExt = (name: string) => {
  const i = name.lastIndexOf('.')
  return i <= 0 ? name : name.slice(0, i)
}

/** Lower-cased extension without the dot, or `''`. */
export const extname = (path: string) => {
  const name = basename(path)
  return name.slice(stripExt(name).length + 1).toLowerCase()
}

export const join = (...parts: string[]) => parts.filter(Boolean).join('/')

/** Resolves `.` and `..` segments; `..` never climbs above the vault root. */
export const normalize = (path: string) => {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

/** Path that leads to `to` from the folder `fromDir`, e.g. `../Other/Note.md`. */
export const relative = (fromDir: string, to: string) => {
  const from = fromDir ? fromDir.split('/') : []
  const target = to.split('/')
  let shared = 0
  while (shared < from.length && shared < target.length - 1 && from[shared] === target[shared]) shared++
  return [...from.slice(shared).map(() => '..'), ...target.slice(shared)].join('/')
}
