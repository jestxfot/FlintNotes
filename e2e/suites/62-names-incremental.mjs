// A file coming into the vault or leaving it (made in Obsidian, by a sync, a picture pasted) links again only the notes whose
// links point with its name, not every link of the vault: on the real vault a full rebuild cost ~200 ms of the window each
// time, and the file tree and the widgets added more. After each step the maps are what a full rebuild makes of them.
import fs from 'node:fs'
import path from 'node:path'

const A = 'A links [[B]], [[Folder/C]], ![[pic.png]] and [[Elsewhere]].\n\n#topic\n'
export const vault = {
  files: {
    'A.md': A,
    'Other.md': 'Links only [[Elsewhere]] and [[A]].\n',
    'Folder/Keep.md': 'In the folder.\n',
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  await page.waitForFunction(() => app.metadata.resolvedLinks.has('Other.md'), null, { timeout: 15000 })
  await page.evaluate(() => {
    window.__rebuilds = 0
    const own = app.metadata.rebuild.bind(app.metadata)
    app.metadata.rebuild = () => (window.__rebuilds++, own())
    window.__resolved = []
    app.metadata.on('resolved', (what) => window.__resolved.push(what.notes ? [...what.notes].sort() : null))
  })
  /** The maps as they stand, in a fixed order: links, links that lead nowhere, backlinks of each note, tags. */
  const maps = () =>
    page.evaluate(() => {
      const m = app.metadata
      const flat = (map) => [...map].map(([k, v]) => [k, [...v].sort()]).sort((a, b) => (a[0] < b[0] ? -1 : 1))
      const notes = app.vault.files().map((f) => f.path).sort()
      return JSON.stringify({
        resolved: flat(m.resolvedLinks),
        unresolved: flat(m.unresolvedLinks),
        back: notes.map((p) => [p, [...m.backlinks(p).keys()].sort()]),
        tags: m.tags().map((tag) => [tag.tag, [...tag.files].sort()]).sort(),
      })
    })
  /** What a full rebuild makes of the same files, the incremental maps put back after. */
  const full = async () => {
    const before = await page.evaluate(() => window.__rebuilds)
    await page.evaluate(() => app.metadata.rebuild())
    const made = await maps()
    await page.evaluate((n) => ((window.__rebuilds = n), window.__resolved.splice(0)), before)
    return made
  }
  const settle = async (check) => {
    await page.waitForFunction(check, null, { timeout: 10000 }).catch(() => {})
    await wait(300)
  }
  const step = async (name, check) => {
    await settle(check)
    const rebuilds = await page.evaluate(() => window.__rebuilds)
    const resolved = await page.evaluate(() => window.__resolved.splice(0))
    const now = await maps()
    const rebuilt = await full()
    ok(`${name}: the maps are what a full rebuild makes`, now === rebuilt, `${now}\n---\n${rebuilt}`)
    ok(`${name}: without a full rebuild, only the notes linking by that name looked at again`, rebuilds === 0 && resolved.every((notes) => notes && !notes.includes('Folder/Keep.md')), JSON.stringify({ rebuilds, resolved }))
  }

  t.write('B.md', 'B, linked from A.\n')
  await step('a note made outside', () => app.metadata.resolvedLinks.get('A.md')?.has('B.md'))
  ok('the link to it leads there, and it knows who links to it', await page.evaluate(() => app.metadata.backlinks('B.md').has('A.md') && !app.metadata.unresolvedLinks.get('A.md')?.has('B')))

  t.write('pic.png', 'x')
  await step('a picture', () => app.metadata.resolvedLinks.get('A.md')?.has('pic.png'))

  fs.mkdirSync(path.join(t.vault, 'Folder'), { recursive: true })
  t.write('Folder/C.md', 'C, by its path.\n')
  await step('a note in a folder, linked by its path', () => app.metadata.resolvedLinks.get('A.md')?.has('Folder/C.md'))

  // A second file of a name already there: links by the bare name now have a choice to make, as a full rebuild would make it.
  t.write('Folder/B.md', 'Another B.\n')
  await step('a second file of the same name', () => app.vault.get('Folder/B.md') && app.metadata.backlinks('B.md').size >= 0)

  fs.rmSync(path.join(t.vault, 'B.md'))
  await step('a note deleted', () => !app.vault.get('B.md'))
  ok('the link by its name leads to the other B now', await page.evaluate(() => app.metadata.resolvedLinks.get('A.md')?.has('Folder/B.md')))

  fs.rmSync(path.join(t.vault, 'Folder/B.md'))
  await step('the other one deleted too', () => !app.vault.get('Folder/B.md'))
  ok('the link leads nowhere again', await page.evaluate(() => app.metadata.unresolvedLinks.get('A.md')?.has('B')))

  fs.rmSync(path.join(t.vault, 'A.md'))
  await step('a note with links and a tag deleted', () => !app.vault.get('A.md'))
  ok('its links and its tag are gone with it', await page.evaluate(() => !app.metadata.resolvedLinks.has('A.md') && !app.metadata.tags().some((tag) => tag.tag.toLowerCase().replace('#', '') === 'topic') && app.metadata.unresolvedLinks.get('Other.md')?.has('A')))
}
