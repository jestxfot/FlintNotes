import type { App } from './app'

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export const isExternal = (href: string) => SCHEME.test(href)

/** Finds the vault file a Markdown link target (possibly percent-encoded) points to. */
export function resolvePath(app: App, target: string, sourcePath: string): string | null {
  let path = target.split('#')[0].replace(/^<|>$/g, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    // Not percent-encoded; use it as written.
  }
  return path ? app.metadata.resolve(path, sourcePath) : null
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
