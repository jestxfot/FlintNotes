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
      '---\ntitle: Test\ntags: [a]\n---\n# Heading One\n\nText with **bold**, *italic*, ~~strike~~ and `code` and \\*escaped\\*.\n\nA [link](Other.md) and https://example.com here.\n\n> quoted line\n\n- item one\n- [ ] todo\n- [x] done\n\n1. first\n\n```js\nconst a = 1\n```\n\n---\n\n![pic|120](pic.png)\n\n```counter\n3\n```\n\nAt 17:44:36 UTC plain.\n\nend\n',
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
}
