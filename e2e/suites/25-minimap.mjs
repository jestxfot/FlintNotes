// The map of a note: a strip beside the text that shows the whole note and scrolls it.
const long = Array.from({ length: 400 }, (_, i) => (i % 40 === 0 ? `## Part ${i / 40}` : `Line ${i} of some text that goes on for a while`)).join('\n')
export const vault = { plugins: ['minimap'], files: { 'Long.md': `${long}\n`, 'Short.md': 'short\n' } }

export async function run(t) {
  const { page, ok, wait } = t
  await t.open('Short')
  ok('a short note has no map', (await page.locator(`${t.leaf} .note-map:not([hidden])`).count()) === 0)
  await t.open('Long')
  await page.evaluate(() => (app.workspace.activeEditor.scrollDOM.scrollTop = 0))
  const map = page.locator(`${t.leaf} .note-map`)
  await page.waitForFunction(() => document.querySelector('.leaf:not([hidden]) .note-map canvas')?.height > 0, null, { timeout: 8000 }).catch(() => {})
  const painted = await map.locator('canvas').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let filled = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) filled++
    return filled
  })
  ok('a long note gets a map with its lines drawn', (await map.isVisible()) && painted > 500, painted)
  const top = () => page.evaluate(() => app.workspace.activeEditor.scrollDOM.scrollTop)
  const box = await map.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6)
  await wait(400)
  const after = await top()
  ok('a click on the map scrolls the note there', after > 1000, after)
  const frame = await map.locator('.note-map-window').evaluate((el) => el.style.transform)
  ok('and the frame follows the scroll', /translateY\((?!0px)/.test(frame), frame)
}
