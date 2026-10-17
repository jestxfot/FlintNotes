// The map of a note: a strip beside the text that shows the whole note and scrolls it.
const long = Array.from({ length: 400 }, (_, i) => (i % 40 === 0 ? `## Part ${i / 40}` : `Line ${i} of some text that goes on for a while`)).join('\n')
const card = (n) => `\`\`\`embed\ntitle: "Card ${n}"\nimage: ""\ndescription: "About card ${n}"\nurl: "https://example.com/${n}"\n\`\`\``
const blocks = Array.from({ length: 30 }, (_, i) => `${card(i)}\n\n> [!note] Callout ${i}\n> text\n\n| a | b |\n| - | - |\n| ${i} | x |\n\n\`\`\`js\nconst x = ${i}\n\`\`\`\n\nLine ${i} [link](https://example.com)`).join('\n\n')
export const vault = { plugins: ['minimap', 'link-embed'], settings: { 'link-embed': { fillCards: false, findPictures: false } }, files: { 'Long.md': `${long}\n`, 'Short.md': 'short\n', 'Blocks.md': `${blocks}\n` } }

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
  const clear = await page.evaluate(() => {
    const leafEl = document.querySelector('.leaf:not([hidden])')
    return leafEl.querySelector('.cm-scroller').getBoundingClientRect().right <= leafEl.querySelector('.note-map').getBoundingClientRect().left + 1
  })
  ok('the text ends where the map begins', clear)
  const top = () => page.evaluate(() => app.workspace.activeEditor.scrollDOM.scrollTop)
  const box = await map.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6)
  await wait(400)
  const after = await top()
  ok('a click on the map scrolls the note there', after > 1000, after)
  const frame = await map.locator('.note-map-window').evaluate((el) => el.style.transform)
  ok('and the frame follows the scroll', /translateY\((?!0px)/.test(frame), frame)

  // Nothing of the note (a card, a callout, a table, a code block) reaches under the map, and the map does not cover the note.
  await t.open('Blocks')
  await page.waitForFunction(() => document.querySelector('.leaf:not([hidden]) .note-map:not([hidden]) canvas')?.height > 0, null, { timeout: 8000 }).catch(() => {})
  await wait(500)
  const under = await page.evaluate(() => {
    const leafEl = document.querySelector('.leaf:not([hidden])')
    const edge = leafEl.querySelector('.note-map').getBoundingClientRect().left
    const out = []
    for (const el of leafEl.querySelectorAll('.cm-content > *, .embed-card, .cm-content .callout, .cm-content table')) {
      const box = el.getBoundingClientRect()
      if (box.height && box.right > edge + 1) out.push(`${el.className || el.tagName} ${Math.round(box.right)} > ${Math.round(edge)}`)
    }
    return out
  })
  ok('no block of the note reaches under the map', under.length === 0, under.slice(0, 6).join('; '))
  // The editor rewrites its own classes when it gains or loses focus; the map's place must outlive that.
  await page.locator(`${t.leaf} .cm-content`).click({ position: { x: 40, y: 10 } })
  await page.evaluate(() => document.activeElement.blur())
  await page.locator(`${t.leaf} .cm-content`).click({ position: { x: 40, y: 10 } })
  await wait(300)
  const kept = await page.evaluate(() => {
    const leafEl = document.querySelector('.leaf:not([hidden])')
    const editor = leafEl.querySelector('.cm-editor')
    return { cls: editor.classList.contains('has-note-map'), right: Math.round(leafEl.querySelector('.cm-scroller').getBoundingClientRect().right), edge: Math.round(leafEl.querySelector('.note-map').getBoundingClientRect().left) }
  })
  ok('after the note is clicked into, the text still ends where the map begins', kept.cls && kept.right <= kept.edge + 1, JSON.stringify(kept))
}
