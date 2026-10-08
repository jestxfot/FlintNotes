import { errorMessage, parseMarkdown, path as paths, type AffectedLinks, type Plugin } from '../../api'

/**
 * Keeps links working when files are renamed or moved. A wikilink is rewritten
 * only if it no longer finds the file: links by bare name survive a move, so
 * moving a folder usually rewrites nothing. A Markdown link is always rewritten
 * to the exact relative path, which is what other Markdown tools expect.
 */
export function updateLinksOnRename(plugin: Plugin): void {
  const { app } = plugin
  let pending: { path: string; oldPath: string; affected: AffectedLinks[] }[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  async function flush() {
    const renames = pending
    pending = []
    // Renaming a folder reports each file separately; a linking note may itself have moved.
    const moved = new Map(renames.map((r) => [r.oldPath, r.path]))
    const jobs = new Map<string, Map<string, string>>()
    for (const rename of renames) {
      for (const { source, targets } of rename.affected) {
        const current = moved.get(source) ?? source
        const wanted = jobs.get(current) ?? new Map<string, string>()
        jobs.set(current, wanted)
        for (const target of targets) wanted.set(target, rename.path)
      }
    }
    // Unsaved edits must be on disk before the files are rewritten there.
    await app.workspace.flushAll()
    let files = 0
    let links = 0
    for (const [source, wanted] of jobs) {
      try {
        const text = await app.vault.read(source)
        const broken = parseMarkdown(text).links.filter((link) => {
          const dest = wanted.get(link.target)
          if (dest === undefined) return false
          return link.kind === 'markdown' || app.metadata.resolve(link.target, source) !== dest
        })
        if (!broken.length) continue
        let updated = text
        // Back to front, so earlier offsets stay valid.
        for (const link of broken.reverse()) {
          const dest = wanted.get(link.target)!
          const fresh =
            link.kind === 'wiki'
              ? app.metadata.linkText(dest, source)
              : encodeURI(paths.relative(paths.dirname(source), dest))
          updated = updated.slice(0, link.targetFrom) + fresh + updated.slice(link.targetTo)
        }
        await app.vault.write(source, updated)
        files++
        links += broken.length
      } catch (err) {
        app.notice(`Не удалось обновить ссылки в «${source}»: ${errorMessage(err)}`)
      }
    }
    if (links) app.notice(`Обновлено ссылок: ${links}, файлов: ${files}`)
  }

  plugin.register(
    app.metadata.on('renamed', (path, oldPath, affected) => {
      if (!plugin.getSetting<boolean>('updateOnRename') || !affected.length) return
      pending.push({ path, oldPath, affected })
      clearTimeout(timer)
      timer = setTimeout(() => void flush(), 0)
    }),
  )
}
