// The note index kept by the browser: a second start takes unchanged notes from it,
// reads from the server only what changed meanwhile, and saving does not echo.
const files = { 'Hub.md': '# Hub\n' }
for (let i = 0; i < 40; i++) files[`Note ${i}.md`] = `Note ${i} links to [[Hub]] #topic${i % 3}\n`
export const vault = { files }

export async function run(t) {
  const { page, ok, wait } = t
  await page.evaluate(() => app.metadata.ready)
  // The kept index is written a moment after the notes were read.
  await wait(3500)
  t.write('Note 5.md', 'Note 5 now links to [[Note 6]] #changed\n')
  await wait(800)
  const api = []
  const listen = (request) => request.url().includes('/api/') && api.push(`${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`)
  page.on('request', listen)
  await page.reload()
  await page.waitForFunction(() => window.app?.metadata, null, { timeout: 30000 })
  await page.evaluate(() => app.metadata.ready)
  const state = await page.evaluate(() => ({
    backlinks: [...app.metadata.backlinks('Hub.md').keys()].length,
    tags: app.metadata.get('Note 5.md')?.tags ?? [],
    other: app.metadata.get('Note 7.md')?.tags ?? [],
  }))
  const readOne = api.filter((url) => url.startsWith('GET /api/file') && url.includes('Note%205.md')).length
  ok('a second start takes the unchanged notes from the kept index: no stream of all notes', !api.some((url) => url.includes('/api/notes')) && state.backlinks === 39 && state.other.includes('topic1'), JSON.stringify({ api: api.slice(0, 12), state }))
  ok('a note changed while the page was closed is read again', readOne >= 1 && state.tags.includes('changed'), JSON.stringify({ readOne, state }))

  // ---- saving: one request, no reading back what was just written
  await t.open('Note 3')
  await wait(800)
  api.length = 0
  await t.cursorToEnd()
  await page.keyboard.type(' more')
  await wait(1500)
  const writes = api.filter((url) => url.startsWith('PUT /api/file') && url.includes('Note%203.md'))
  const readBack = api.filter((url) => url.startsWith('GET /api/file') && url.includes('Note%203.md'))
  ok('a save is one request: the note is not read back after it is written', writes.length >= 1 && readBack.length === 0, JSON.stringify(api))
  page.off('request', listen)
}
