// The note index comes from the server, which read the notes once: the page holds each note's index entry and outline, not its text.
// A note's text is asked for when something needs it whole, and saving does not echo.
const files = { 'Hub.md': '# Hub\n' }
for (let i = 0; i < 170; i++) files[`Note ${i}.md`] = `Note ${i} links to [[Hub]] #topic${i % 3}\n\nA paragraph that only the text has, number ${i}.\n\n- [ ] task ${i}\n`
export const vault = { files }

export async function run(t) {
  const { page, ok, wait } = t
  const api = []
  const listen = (request) => request.url().includes('/api/') && api.push(`${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`)
  page.on('request', listen)
  await page.evaluate(() => app.metadata.ready)
  const first = await page.evaluate(() => ({
    backlinks: [...app.metadata.backlinks('Hub.md').keys()].length,
    tags: app.metadata.get('Note 100.md')?.tags ?? [],
    text: app.metadata.text('Note 100.md'),
    outline: app.metadata.outline('Note 100.md'),
    words: app.metadata.words('Note 100.md'),
  }))
  ok('a start with many notes has all of them indexed: links, tags, from what the server read', first.backlinks === 170 && first.tags.includes('topic1'), JSON.stringify(first))
  ok('the page holds a note\'s outline (list items, fields) and word count, not its text', first.text === undefined && /- \[ \] task 100/.test(first.outline ?? '') && !/paragraph/.test(first.outline ?? '') && first.words > 10, JSON.stringify(first))
  // What the page asked for since it started (the browser keeps the list of its requests).
  const asked0 = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname))
  ok('the index came in one request, the notes\' texts were not sent', asked0.filter((p) => p === '/api/index').length === 1 && !asked0.includes('/api/notes'), JSON.stringify(asked0.filter((p) => p.startsWith('/api/')).slice(0, 12)))

  // ---- a text is asked for when something needs it whole
  const asked = await page.evaluate(async () => {
    const one = await app.metadata.read('Note 7.md')
    const many = await app.metadata.readMany(['Note 8.md', 'Note 9.md', 'missing.md'])
    return { one, many: [...many.keys()], held: app.metadata.text('Note 7.md') }
  })
  ok('a note\'s text is read from the server when asked for, and kept for a while', asked.one?.includes('A paragraph that only the text has, number 7') && asked.many.join() === 'Note 8.md,Note 9.md' && asked.held === asked.one, JSON.stringify(asked))

  // ---- a note changed outside is in the index of the next start
  t.write('Note 5.md', 'Note 5 now links to [[Note 6]] #changed\n')
  await wait(1200)
  await page.reload()
  await page.waitForFunction(() => window.app?.metadata, null, { timeout: 30000 })
  await page.evaluate(() => app.metadata.ready)
  const state = await page.evaluate(() => ({
    backlinks: [...app.metadata.backlinks('Hub.md').keys()].length,
    tags: app.metadata.get('Note 5.md')?.tags ?? [],
    other: app.metadata.get('Note 7.md')?.tags ?? [],
  }))
  ok('a note changed while the page was closed is in the index of the next start', state.backlinks === 169 && state.tags.includes('changed') && state.other.includes('topic1'), JSON.stringify(state))
  ok('nothing is kept in the browser: the old index database is gone', await page.evaluate(async () => !(await indexedDB.databases()).some((db) => db.name?.startsWith('flint-index:'))))

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
