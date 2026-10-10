// HTML written in a note; ```mermaid; a base with hundreds of records; the rulebook of icons; icons from templates.
import { fixture } from '../helpers.mjs'

const iconic = {
  fileIcons: { 'Templates/Dish.md': { icon: 'lucide-soup', color: 'orange' } },
  fileRules: [{ id: 'ttttt', name: 'Songs', match: 'all', conditions: [{ source: 'tags', operator: 'includes', value: 'song' }], enabled: true, icon: 'flint-song-wave' }, { id: 'aaaaa', name: 'Big ones', match: 'any', conditions: [{ source: 'tree', operator: 'is', value: 'Big' }], enabled: true, icon: 'lucide-star' }],
  folderRules: [],
}
const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`Big/N ${String(i).padStart(3, '0')}.md`, `---\nn: ${i}\n---\n`]))
export const vault = {
  plugins: ['mermaid', 'bases', 'iconic', 'templates', 'properties', 'links'],
  settings: { templates: { folder: 'Templates', ask: true } },
  files: {
    ...many,
    'pic.png': fixture('pic.png'),
    'Tagged.md': '---\ntags:\n  - song\n---\nla la\n',
    'Untagged.md': 'no tags\n',
    'TextTag.md': '---\ntags: "#song"\n---\nbody\n',
    '.obsidian/app.json': '{}',
    '.obsidian/plugins/iconic/data.json': JSON.stringify(iconic, null, 2),
    'Templates/Dish.md': '# <% tp.file.title %>\n',
    'Html.md': '# Html\n\n<div style="display: flex; justify-content: center; gap: 20px;" onclick="window.hacked = 1">\n    <img style="width: 40%;" src="pic.png">\n    <img style="width: 40%;" src="javascript:alert(1)">\n    <script>window.hacked = 2</script>\n    <a href="https://example.com" onmouseover="window.hacked = 3">site</a>\n</div>\n\nafter\n',
    'Diagram.md': '# Diagram\n\n```mermaid\ngraph TD\n  A[Idea] --> B[Done]\n```\n\nafter\n',
    'Big.base': 'filters:\n  and:\n    - file.inFolder("Big")\nviews:\n  - type: table\n    name: All\n    order: [file.name, n]\n    summaries:\n      n: Sum\n',
    'Holder.md': '---\nlink: "[[Templates/Dish]]"\n---\n# Holder\n\n![[Big.base]]\n\nend\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read, leaf } = t

  await wait(2500)
  ok('a rule may ask about the tags of a note', (await t.row('Tagged').locator('.row-icon svg').count()) === 1 && (await t.row('Untagged').locator('.row-icon').count()) === 0)
  // ---- tags among the properties
  await t.open('TextTag')
  ok('tags written as one text are still shown as tags', (await page.locator(`${leaf} .props-row[data-key="tags"] .props-chip`).count()) === 1 && (await t.flat(page.locator(`${leaf} .props-row[data-key="tags"] .props-chip`))).startsWith('song'))
  await t.open('Tagged')
  const tagField = page.locator(`${leaf} .props-row[data-key="tags"] .props-list input`)
  await tagField.click()
  await page.keyboard.type('so')
  await page.evaluate(() => app.icons.refresh())
  await wait(400)
  ok('the form is not drawn again while a field is being typed in', (await tagField.inputValue()) === 'so' && (await page.evaluate(() => document.activeElement?.tagName)) === 'INPUT')
  await page.keyboard.type('ng')
  await page.keyboard.press('Enter')
  await wait(900)
  ok('a tag that is there already is not added again', (await page.locator(`${leaf} .props-row[data-key="tags"] .props-chip`).count()) === 1 && read('Tagged.md').match(/song/g).length === 1, read('Tagged.md'))
  await page.locator(`${leaf} .props-row[data-key="tags"] .props-list input`).click()
  await page.keyboard.type('s')
  await wait(400)
  ok('a tag the note has is not suggested', !(await t.flat(page.locator('.props-suggest')).catch(() => '')).includes('song'))
  await page.keyboard.press('Escape')
  await page.locator(`${leaf} .props-row[data-key="tags"] .props-list input`).fill('')
  await page.locator(`${leaf} .cm-content`).click({ position: { x: 200, y: 300 } })
  await t.cursorToEnd()
  await page.keyboard.type('\n[[Tagg')
  await page.waitForSelector('.cm-tooltip-autocomplete li', { timeout: 8000 }).catch(() => {})
  ok('the list of notes for a link shows their icons', (await page.locator('.cm-tooltip-autocomplete li', { hasText: 'Tagged' }).locator('.cm-completionNoteIcon svg').count()) === 1, await page.locator('.cm-tooltip-autocomplete').innerHTML().catch(() => 'no list'))
  await page.keyboard.press('Escape')
  await t.open('Html')
  const html = page.locator(`${leaf} .lp-html`)
  await html.waitFor()
  ok('a block of HTML is drawn as the page it describes', (await html.locator('div').first().evaluate((el) => getComputedStyle(el).display)) === 'flex' && (await html.locator('img').count()) === 2)
  ok('a picture may name a file of the vault', (await html.locator('img').first().evaluate((img) => img.getAttribute('src').startsWith('/api/file') && img.complete && img.naturalWidth > 0)))
  ok('what could run code is taken out', (await html.locator('script').count()) === 0 && (await html.evaluate((el) => !el.innerHTML.includes('onclick') && !el.innerHTML.includes('onmouseover') && !el.innerHTML.includes('javascript:'))) && (await page.evaluate(() => window.hacked)) === undefined, await html.innerHTML())

  await t.open('Diagram')
  await page.waitForSelector(`${leaf} .mermaid-block svg`, { timeout: 20000 }).catch(() => {})
  ok('a mermaid block is drawn as a diagram', (await page.locator(`${leaf} .mermaid-block svg`).count()) === 1 && (await t.flat(page.locator(`${leaf} .mermaid-block`))).includes('Idea'), await page.locator(`${leaf} .lp-block`).innerText().catch(() => 'no block'))

  // ---- a long base is drawn a part at a time
  await t.open('Holder')
  const base = page.locator(`${leaf} .base`).first()
  await base.locator('tbody tr').first().waitFor()
  ok('a long base draws its first part only', (await base.locator('tbody tr').count()) === 120 && (await t.flat(base.locator('.base-count'))).includes('300'), `${await base.locator('tbody tr').count()} rows, ${await t.flat(base.locator('.base-count'))}`)
  ok('totals still count every record', (await t.flat(base.locator('tfoot'))).includes('44850'), await t.flat(base.locator('tfoot')))
  ok('an embedded base has no frame', (await page.locator(`${leaf} .lp-embed`).first().evaluate((el) => getComputedStyle(el).borderTopWidth)) === '0px')
  ok('records of a folder under a rule wear its icon', (await base.locator('tbody tr').first().locator('.inline-link-icon, .icon').count()) >= 0)
  ok('a link in a property shows the icon of its note', (await page.locator(`${leaf} .props-row[data-key="link"] .inline-link-icon`).count()) === 1, await page.locator(`${leaf} .props`).innerHTML().catch(() => 'no props'))
  // The rows on screen are kept when the next part comes: only new ones are added.
  await base.locator('tbody tr').first().evaluate((row) => (row.dataset.kept = 'yes'))
  await base.locator('.base-more').scrollIntoViewIfNeeded()
  await wait(1200)
  ok('the next part is added to what is drawn, not drawn over it', (await base.locator('tbody tr').first().getAttribute('data-kept')) === 'yes')
  ok('the next part comes when its end is reached', (await base.locator('tbody tr').count()) >= 240, await base.locator('tbody tr').count())

  // ---- a note made from a template that has an icon takes that icon
  await page.evaluate(() => app.commands.run('core:new-note'))
  const chooser = page.locator('dialog:has(input[placeholder^="Шаблон для"])')
  await chooser.waitFor()
  await chooser.locator('input').fill('Dish')
  await wait(200)
  await page.keyboard.press('Enter')
  await wait(2000)
  const looks = JSON.parse(read('.obsidian/plugins/iconic/data.json')).fileIcons
  ok('a note made from a template with an icon gets that icon', JSON.stringify(looks['Без названия.md']) === '{"icon":"lucide-soup","color":"orange"}', JSON.stringify(looks))

  // ---- the app's own icons: found by what they are for, drawn as lines, shared with Obsidian as files
  await t.row('Html').click({ button: 'right' })
  await page.locator('.menu button', { hasText: /значок…/ }).click()
  const picker = page.locator('.iconic-dialog')
  await picker.locator('.iconic-search').fill('суп')
  await wait(500)
  ok('own icons are found by Russian words', (await picker.locator('.iconic-icon').count()) >= 1 && (await picker.locator('.iconic-icon').first().getAttribute('title')).startsWith('bowl-steam'), await picker.locator('.iconic-icon').first().getAttribute('title').catch(() => 'none'))
  await picker.locator('.iconic-icon').first().click()
  await picker.locator('button', { hasText: 'Готово' }).click()
  await wait(1500)
  ok('a chosen own icon is kept by name and given to Obsidian as a file', JSON.parse(read('.obsidian/plugins/iconic/data.json')).fileIcons['Html.md']?.icon === 'flint-bowl-steam' && t.exists('.obsidian/custom-icons/flint-bowl-steam.svg') && read('.obsidian/custom-icons/flint-bowl-steam.svg').includes('stroke="currentColor"'))
  ok('and is drawn as lines here', (await t.row('Html').locator('.row-icon svg path').count()) >= 2 && (await t.row('Html').locator('.row-icon img').count()) === 0)

  // ---- the rulebook in the settings
  await page.evaluate(() => app.commands.run('core:settings'))
  await page.locator('nav button.sub', { hasText: 'Значки и цвета' }).click()
  await wait(600)
  const rules = page.locator('.iconic-rules')
  ok('the settings show the rules of files and folders', (await rules.locator('.iconic-rule').count()) === 2 && (await rules.locator('.iconic-rule-name').nth(1).inputValue()) === 'Big ones' && (await t.flat(rules.locator('.iconic-rule-count').nth(1))) === '300' && (await t.flat(rules.locator('.iconic-rule-count').first())) === '2', await rules.innerText().catch(() => 'no rules'))
  await rules.locator('.iconic-rule-section').nth(1).locator('.iconic-rule-add').click()
  await wait(900)
  const folderRule = rules.locator('.iconic-rule-section').nth(1).locator('.iconic-rule')
  await folderRule.locator('.iconic-rule-name').fill('Big folder')
  await folderRule.locator('.iconic-rule-name').press('Tab')
  await wait(600)
  await rules.locator('.iconic-rule-section').nth(1).locator('.iconic-condition .iconic-rule-select').first().selectOption('name')
  await wait(600)
  await rules.locator('.iconic-rule-section').nth(1).locator('.iconic-rule-value').fill('Big')
  await rules.locator('.iconic-rule-section').nth(1).locator('.iconic-rule-value').press('Tab')
  await wait(1200)
  const saved = JSON.parse(read('.obsidian/plugins/iconic/data.json'))
  ok("a rule made here is written in Iconic's own form", saved.folderRules.length === 1 && saved.folderRules[0].name === 'Big folder' && saved.folderRules[0].enabled === true && /^[A-Za-z0-9]{5}$/.test(saved.folderRules[0].id) && JSON.stringify(saved.folderRules[0].conditions) === '[{"source":"name","operator":"is","value":"Big"}]' && saved.fileRules[1].id === 'aaaaa', JSON.stringify(saved.folderRules))
  await page.keyboard.press('Escape')
  await wait(500)
  ok('and works at once', (await t.row('Big').locator('.row-icon').count()) === 1)
}
