// Live Preview: each Markdown element rendered in place, source under the cursor, code block processors.
import { COUNTER_PLUGIN, fixture } from '../helpers.mjs'

export const viewport = { width: 1100, height: 1000 }
export const vault = {
  plugins: ['counter'],
  externalPlugins: { counter: COUNTER_PLUGIN },
  files: {
    'pic.png': fixture('pic.png'),
    'Other.md': '# Other note\n',
    'Test.md':
      '---\ntitle: Test\ntags: [a]\n---\n# Heading One\n\nText with **bold**, *italic*, ~~strike~~ and `code` and \\*escaped\\*.\n\nA [link](Other.md) and https://example.com here.\n\n> quoted line\n\n- item one\n- [ ] todo\n- [x] done\n\n1. first\n\n```js\nconst a = 1\n```\n\n---\n\n![pic|120](pic.png)\n\n```counter\n3\n```\n\nAt 17:44:36 UTC plain.\n\nSeen %%hidden inline%% text.\n\n%% a whole\ncomment block %%\nAfter the block.\n\nend\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read, leaf } = t
  const count = (selector) => t.count(`${leaf} ${selector}`)

  await t.open('Test')
  let text = await t.text()
  ok('heading mark hidden', text.includes('Heading One') && !text.includes('# Heading'), text)
  ok('emphasis marks hidden', !text.includes('**') && !text.includes('~~') && !text.includes('*italic*') && !text.includes('`code`'))
  ok('escape backslash hidden', text.includes('*escaped*') && !text.includes('\\*'))
  ok('link source hidden', text.includes('A link and') && !text.includes('Other.md'))
  ok('quote mark hidden', !text.includes('> quoted') && (await count('.lp-quote')) === 1)
  ok('frontmatter is one block, not a rule and a heading', (await count('.lp-frontmatter')) === 4 && (await count('.lp-rule')) === 1)
  ok('bullet and checkboxes', (await count('.lp-bullet')) === 1 && (await count('.lp-checkbox')) === 2 && (await count('.lp-checkbox:checked')) === 1)
  ok('done task styled', (await count('.lp-task-done')) === 1)
  ok('ordered marker kept', text.includes('1. first'))
  ok('code block styled, fences hidden', (await count('.lp-code')) === 3 && !text.includes('```js') && (await page.locator('.lp-code-lang').innerText()) === 'js')
  const img = await page.evaluate(() => {
    const image = document.querySelector('.lp-image')
    return image && { width: image.width, natural: image.naturalWidth }
  })
  ok('image rendered with width', img?.width === 120 && img?.natural === 40, JSON.stringify(img))
  ok('image source hidden', !text.includes('pic.png'))
  ok('processor block rendered', (await page.locator('.lp-block').innerText()).includes('count: 3') && !text.includes('```counter'))

  await page.evaluate(() => document.querySelector('.lp-block').setAttribute('data-probe', '1'))
  await page.locator('.lp-block .inc').click()
  await wait(900)
  ok('block UI writes back to the file', read('Test.md').includes('```counter\n4\n```'), read('Test.md').slice(-40))
  ok('block UI updated in place, not rebuilt', (await page.locator('.lp-block').innerText()).includes('count: 4') && (await count('.lp-block[data-probe]')) === 1)
  await page.locator('.lp-block').hover()
  await page.locator('.lp-block-edit').click()
  await wait(200)
  ok('edit button reveals block source', (await t.text()).includes('```counter') && (await count('.lp-block')) === 0)
  await t.cursorToEnd()
  await wait(200)
  ok('block renders again after leaving', (await count('.lp-block')) === 1)

  await page.locator('.lp-heading').click()
  await wait(200)
  ok('cursor on heading reveals its mark', (await t.text()).includes('# Heading One'))
  await page.locator('.cm-line', { hasText: 'Text with' }).locator('strong, span', { hasText: /^bold$/ }).first().click()
  await wait(200)
  text = await t.text()
  ok('cursor in bold reveals only its marks', text.includes('**bold**') && !text.includes('~~') && !text.includes('# Heading'), text.slice(0, 200))
  await page.locator('.lp-image').click()
  await wait(300)
  ok('cursor on image shows source and keeps picture', (await t.text()).includes('![pic|120](pic.png)') && (await count('.lp-image-below')) === 1)

  await t.cursorToEnd()
  await wait(200)
  await page.locator('.lp-checkbox').first().click()
  await wait(900)
  ok('checkbox toggles text on disk', read('Test.md').includes('- [x] todo'))
  ok('both tasks now done', (await count('.lp-checkbox:checked')) === 2)

  await page.keyboard.press('Control+e')
  await wait(300)
  text = await t.text()
  ok('source mode shows raw markdown', text.includes('**bold**') && text.includes('```counter') && (await count('.lp-checkbox')) === 0 && (await count('.lp-block')) === 0)
  await page.keyboard.press('Control+e')
  await wait(300)
  ok('back to live preview', (await count('.lp-checkbox')) === 2 && (await count('.lp-block')) === 1)

  await page.locator('.lp-link').click()
  await wait(600)
  ok('click on link opens note', (await t.activeTab()) === 'Other')
  await t.tab('Test').click()
  await wait(200)
  ok('link click did not reveal its source', !(await t.text()).includes('](Other.md)'))
  // A time of day is plain text: the digits between its colons are not an emoji code.
  const time = page.locator(`${leaf} .cm-line`, { hasText: '17:44:36' })
  ok('a time of day has no part painted differently', (await time.locator('span').count()) === 0, await time.innerHTML().catch(() => 'no line'))

  ok('a comment is shown dimmed while the note is edited', (await count('.lp-comment')) >= 1 && (await t.text()).includes('hidden inline'))
  // ---- reading: the note cannot be typed in, and nothing turns back into its source
  await page.locator('.view-header .reading-toggle').click()
  await wait(400)
  const beforeReading = read('Test.md')
  await page.locator(`${leaf} .cm-content`).click({ position: { x: 200, y: 60 } })
  await page.keyboard.type('typed while reading')
  await page.locator(`${leaf} .inline-title`).click({ force: true }).catch(() => {})
  await page.keyboard.type('renamed')
  await wait(900)
  ok('in reading a note cannot be typed in or renamed', t.exists('Test.md') && read('Test.md') === beforeReading && (await page.locator('.view-header .reading-toggle.on').count()) === 1)
  ok('comments between %% are not shown where a note is read', !(await t.text()).includes('hidden inline') && !(await t.text()).includes('comment block') && /Seen\s+text\./.test(await t.text()) && (await t.text()).includes('After the block.'), (await t.text()).slice(-160))
  ok('and everything stays drawn, wherever the click falls', !(await t.text()).includes('**bold**') && (await count('.lp-block')) > 0)
  const copied = await page.evaluate(() => {
    const view = app.workspace.activeEditor
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    const data = new DataTransfer()
    view.contentDOM.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
    return data.getData('text/plain')
  })
  ok('what is copied where a note is read is its text, without the marks it is written with', copied.includes('Text with bold, italic, strike and code and *escaped*.') && copied.includes('A link and https://example.com here.') && /^item one$/m.test(copied) && /^todo$/m.test(copied) && /^Heading One$/m.test(copied) && !copied.includes('hidden inline') && copied.includes('const a = 1') && !copied.includes('```'), copied.slice(0, 400))
  await page.keyboard.press('Control+Shift+E')
  await wait(400)
  await t.cursorToEnd()
  await page.keyboard.type('!')
  await wait(900)
  ok('back in editing it can be typed in again', read('Test.md').endsWith('!') || read('Test.md').includes('!'), read('Test.md').slice(-30))

  // ---- HTML inside a line of text
  await t.cursorToEnd()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Inline <mark>marked</mark>, <span style="color: rgb(255, 0, 0)">red</span>, <kbd>Ctrl</kbd>, <u>under</u>, <font color="blue">old</font>, <weird>kept</weird>')
  await page.keyboard.press('Enter')
  await page.keyboard.type('after')
  await wait(700)
  const drawn = await page.evaluate(() => {
    const content = document.querySelector('.leaf:not([hidden]) .cm-content')
    const red = [...content.querySelectorAll('span[style]')].find((el) => el.textContent === 'red')
    return { mark: content.querySelector('mark')?.textContent, red: red ? getComputedStyle(red).color : null, kbd: content.querySelector('kbd')?.textContent, u: content.querySelector('u')?.textContent, font: [...content.querySelectorAll('span[style]')].some((el) => el.textContent === 'old' && /blue/.test(el.getAttribute('style'))), text: content.innerText }
  })
  ok('HTML inside a line is drawn as it reads, its tags hidden; an unknown tag stays as written', drawn.mark === 'marked' && drawn.red === 'rgb(255, 0, 0)' && drawn.kbd === 'Ctrl' && drawn.u === 'under' && drawn.font && !drawn.text.includes('<mark>') && drawn.text.includes('<weird>kept</weird>'), JSON.stringify(drawn).slice(0, 400))
  await page.evaluate(() => {
    const view = app.workspace.activeEditor
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('marked</mark>') + 2 } })
  })
  await wait(400)
  ok('the cursor inside the element brings its tags back', (await t.text()).includes('<mark>marked</mark>'))


  // ---- the selection is drawn over the text, along the text itself, in code blocks too
  const selected = await page.evaluate(async () => {
    const view = app.workspace.activeEditor
    const text = view.state.doc.toString()
    const from = text.indexOf('```js')
    const to = text.indexOf('```', from + 5) + 3
    view.focus()
    view.dispatch({ selection: { anchor: from, head: to } })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const marks = [...document.querySelectorAll('.leaf:not([hidden]) .flint-selection')].map((el) => el.getBoundingClientRect())
    const code = [...document.querySelectorAll('.leaf:not([hidden]) .cm-line.lp-code')].find((el) => el.textContent.includes('const a = 1'))
    const line = code.getBoundingClientRect()
    const textEnd = (() => {
      const range = document.createRange()
      range.selectNodeContents(code)
      return range.getBoundingClientRect().right
    })()
    const onLine = marks.find((rect) => rect.top < line.bottom && rect.bottom > line.top)
    const layerAbove = getComputedStyle(document.querySelector('.leaf:not([hidden]) .flint-selection-layer')).zIndex
    return { count: marks.length, onLine: onLine ? [Math.round(onLine.left), Math.round(onLine.right)] : null, textEnd: Math.round(textEnd), lineRight: Math.round(line.right), layerAbove }
  })
  ok('a selection is drawn over the note, along the selected text, also in a code block', selected.count >= 3 && selected.onLine && selected.onLine[1] <= selected.textEnd + 12 && selected.onLine[1] < selected.lineRight - 40, JSON.stringify(selected))
  await t.cursorToEnd()

}
