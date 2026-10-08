import type { App } from './app'
import { basename, dirname, join, normalize } from './path'

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export const isExternal = (href: string) => SCHEME.test(href)

/**
 * Finds the vault file a link target points to. Tries the path relative to the
 * linking note, then from the vault root, then any file with that name; `.md`
 * may be omitted.
 */
export function resolvePath(app: App, target: string, sourcePath: string): string | null {
  let path = target.split('#')[0].replace(/^<|>$/g, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    // Not percent-encoded; use it as written.
  }
  if (!path) return null
  const isFile = (p: string) => app.vault.get(p)?.kind === 'file'
  for (const base of [normalize(join(dirname(sourcePath), path)), normalize(path)]) {
    for (const candidate of [base, `${base}.md`]) if (isFile(candidate)) return candidate
  }
  const name = basename(path)
  return app.vault.files().find((f) => [name, `${name}.md`].includes(basename(f.path)))?.path ?? null
}

/** Opens a link found in the note at `sourcePath`: web links in a new tab, notes in the app. */
export function openLink(app: App, href: string, sourcePath: string): void {
  if (isExternal(href)) {
    if (/^(https?|mailto):/i.test(href)) window.open(href, '_blank', 'noopener')
    return
  }
  if (href.startsWith('#')) return
  const path = resolvePath(app, href, sourcePath)
  if (path) app.workspace.openFile(path)
  else app.notice(`Файл «${href}» не найден`)
}
