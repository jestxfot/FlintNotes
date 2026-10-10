// The note index and the plugins built on it: wikilinks, backlinks, tags, search, quick switcher.
import { fixture } from '../helpers.mjs'

export const viewport = { width: 1300, height: 800 }
export const vault = {
  plugins: ['links', 'tags', 'search', 'backlinks', 'quick-switcher'],
  files: {
    'pic.png': fixture('pic.png'),
    'A.md': '# A\n\nSee [[B]] and [[B|alias]] and [[Missing]].\n\n#project #area/sub\n\n![[pic.png|50]]\n\n`[[NotALink]]`\n\nend\n',
    'B.md': '---\ntags: [meta]\n---\n# B\n\nBack to [[A]]. Also [md](A.md). #project\n',
    'Sub/C.md': 'links [[A]] and [[B#B]] and [up](../B.md)\nneedle haystack\n',
    // As Obsidian's core daily notes leave them: the year filled in, the neighbouring days not.
    'Days/2026-10-08.md': '[[{{date-1d:YYYY-MM-DD}}|← yesterday]] | [[2026]] | [[{{date+1d:YYYY-MM-DD}}|tomorrow →]]\n\nend\n',
    'Days/2026-10-09.md': 'the next day\n',
  },
}

export async function run(t) {
  const { page, ok, wait, read, exists, leaf } = t
  const count = (selector) => t.count(`${leaf} ${selector}`)
  const backlinks = () => page.locator('aside.right').innerText()
  const leftPanel = () => page.locator('aside.left .panel:not([hidden])').innerText()

  await t.open('A')
  let text = await t.text()
  ok('wikilinks rendered without brackets', text.includes('See B and alias and Missing.'), text)
  ok('three wikilinks, one to a missing note', (await count('.lp-wikilink')) === 3 && (await count('.lp-wikilink-missing')) === 1)
  ok('wikilink in code is not a link', text.includes('[[NotALink]]'))
  const img = await page.evaluate(() => {
    const image = document.querySelector('.lp-image')
    return image && { width: image.width, natural: image.naturalWidth }
  })
  ok('image embed rendered', img?.width === 50 && img?.natural === 40, JSON.stringify(img))
  ok('tags rendered as pills', (await count('.lp-tag')) === 2)
  const tabTitles = await page.locator('aside.left .widget-tab').evaluateAll((tabs) => tabs.map((tab) => tab.title))
  ok('file list stays the first sidebar tab', tabTitles[0] === 'Файлы' && [...tabTitles].sort().join() === ['Поиск', 'Теги', 'Файлы'].join(), JSON.stringify(tabTitles))
  ok('backlinks of A', /Обратные ссылки\s*2/i.test(await backlinks()) && (await backlinks()).includes('Back to [[A]]') && (await backlinks()).includes('links [[A]] and [[B#B]]'), await backlinks())

  await page.locator(`${leaf} .lp-wikilink`, { hasText: /^B$/ }).click()
  await wait(600)
  ok('click on wikilink opens note', (await t.activeTab()) === 'B')
  ok('backlinks follow the active note', (await backlinks()).includes('See [[B]]'), await backlinks())
  await page.locator('aside.right .line', { hasText: 'links [[A]]' }).click()
  await wait(500)
  ok('backlink line opens its source', (await t.activeTab()) === 'C')

  await t.tab('A').click()
  await wait(200)
  await page.locator(`${leaf} .lp-wikilink-missing`).click()
  await wait(900)
  ok('click on a missing link creates the note', exists('Missing.md') && (await t.activeTab()) === 'Missing')
  await t.tab('A').click()
  await wait(400)
  ok('link no longer missing after creation', (await count('.lp-wikilink-missing')) === 0)

  await page.locator(`${leaf} .lp-tag`, { hasText: 'project' }).click()
  await wait(300)
  text = (await leftPanel()).replace(/\s+/g, ' ')
  ok('tag click reveals the panel with its notes', text.includes('#project 2') && text.includes('#area/sub 1') && text.includes('#meta 1') && /#project 2 (A B|B A)/.test(text), text)

  await page.evaluate(() => app.commands.run('search:open-panel'))
  await wait(300)
  ok('search hotkey focuses the field', await page.evaluate(() => document.activeElement?.type === 'search'))
  await page.keyboard.type('needle')
  await wait(500)
  text = await leftPanel()
  ok('search finds text', text.includes('Найдено заметок: 1') && text.includes('needle haystack') && (await t.count('aside.left mark')) === 1, text)
  await page.locator('aside.left .line').click()
  await wait(500)
  const line = await page.evaluate(() => {
    const { state } = app.workspace.activeEditor
    return state.doc.lineAt(state.selection.main.head).number
  })
  ok('search result jumps to its line', (await t.activeTab()) === 'C' && line === 2, line)
  await page.locator('aside.left input').fill('tag:project')
  await wait(500)
  ok('tag: operator', (await leftPanel()).includes('Найдено заметок: 2'), await leftPanel())
  await page.locator('aside.left input').fill('path:sub link')
  await wait(500)
  ok('path: operator with a word', (await leftPanel()).includes('Найдено заметок: 1'), await leftPanel())

  await page.keyboard.press('Control+o')
  await wait(200)
  ok('quick switcher opens with recent files', (await t.count('dialog [role=option]')) >= 4)
  await page.keyboard.type('pi')
  await wait(100)
  ok('quick switcher filters', (await page.locator('dialog [role=option]').first().innerText()).includes('pic.png'))
  await page.keyboard.press('Escape')
  await wait(300)
  await page.keyboard.press('Control+o')
  await page.keyboard.type('Brand New')
  await wait(100)
  await page.keyboard.press('Enter')
  await wait(900)
  ok('quick switcher creates a note', exists('Brand New.md') && (await t.activeTab()) === 'Brand New')

  await t.tab('A').click()
  await wait(200)
  await t.cursorToEnd()
  await page.keyboard.type('[[Mi')
  await wait(500)
  ok('wikilink completion offered', (await page.locator('.cm-tooltip-autocomplete').innerText().catch(() => '')).includes('Missing'))
  await page.keyboard.press('Enter')
  await wait(200)
  await page.keyboard.type(' #pro')
  await wait(500)
  ok('tag completion offered', (await page.locator('.cm-tooltip-autocomplete').innerText().catch(() => '')).includes('project'))
  await page.keyboard.press('Enter')
  await wait(900)
  ok('completions inserted', read('A.md').trimEnd().endsWith('[[Missing]] #project'), JSON.stringify(read('A.md').slice(-40)))

  await page.evaluate(() => app.vault.rename('B.md', 'Beta.md'))
  await wait(1500)
  ok('rename rewrites links in other notes', read('A.md').includes('See [[Beta]] and [[Beta|alias]]') && read('Sub/C.md').includes('[[Beta#B]] and [up](../Beta.md)'), `${read('A.md').slice(0, 60)} // ${read('Sub/C.md')}`)
  ok('rename notice shown', (await page.locator('.notice').last().innerText().catch(() => '')).includes('Обновлено ссылок: 4'))
  ok('open editor shows the rewritten link', (await t.text()).includes('See Beta and alias'))
  await page.evaluate(() => app.vault.rename('A.md', 'Sub/A.md'))
  await wait(1500)
  ok('move keeps links by name, fixes links by path', read('Beta.md').includes('Back to [[A]]. Also [md](Sub/A.md).'), read('Beta.md'))
  ok('moved note stays open', (await t.activeTab()) === 'A' && (await page.locator('.tab.active .tab-title').getAttribute('title')) === 'Sub/A.md')

  await page.keyboard.press('Control+Comma')
  await page.locator('nav button', { hasText: 'Плагины' }).click()
  await page.locator('label.item', { hasText: 'Wiki-ссылки' }).locator('input').uncheck()
  await wait(300)
  await page.locator('label.item', { hasText: 'Обратные ссылки' }).locator('input').uncheck()
  await wait(300)
  await page.keyboard.press('Escape')
  await wait(300)
  await t.cursorToEnd()
  await wait(200)
  ok('disabling the links plugin restores plain text', (await count('.lp-wikilink')) === 0 && (await t.text()).includes('[[Beta]]'))
  ok('disabling backlinks removes the right sidebar', (await t.count('aside.right')) === 0)

  // ---- typing a link: brackets close themselves, and the list says where each note is
  await page.evaluate(async () => {
    await app.plugins.enable('links')
    app.panels.reveal('files')
  })
  await t.row('Days').click()
  await t.open('2026-10-09')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[')
  ok('an opening bracket brings its closing one', (await t.text()).includes('[]'), await t.text())
  await page.keyboard.type('[2026-10-0')
  await wait(500)
  const list = page.locator('.cm-tooltip-autocomplete')
  const first = await t.flat(list.locator('li').first())
  ok('the list shows the note and its folder', (await list.count()) === 1 && first.includes('2026-10-08') && first.includes('Days/'), first)
  ok('and says what else can be typed', (await list.evaluate((el) => getComputedStyle(el, '::after').content)).includes('заголовок'))
  await page.keyboard.press('Enter')
  await wait(300)
  ok('choosing a note leaves one pair of closing brackets', (await page.evaluate(() => app.workspace.activeEditor.state.doc.toString())).endsWith('[[2026-10-08]]'), await page.evaluate(() => app.workspace.activeEditor.state.doc.toString()))
  await page.keyboard.press('Enter')
  await page.keyboard.type('[[A#')
  await wait(500)
  ok('after # the headings of the note are offered', (await t.flat(list)).includes('A') && (await list.locator('li').count()) >= 1, await t.flat(list).catch(() => 'no list'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('word')
  await page.keyboard.press('Shift+Control+ArrowLeft')
  await page.keyboard.type('*')
  await page.keyboard.type('*')
  ok('a Markdown mark typed over a selection wraps it', (await page.evaluate(() => app.workspace.activeEditor.state.doc.toString())).endsWith('**word**'), await page.evaluate(() => app.workspace.activeEditor.state.doc.toString()).then((d) => d.slice(-40)))
  await wait(1200)

  // ---- links written with a date variable, as Obsidian leaves them in daily notes
  await t.open('2026-10-08')
  const next = page.locator(`${leaf} .lp-wikilink`, { hasText: 'tomorrow →' })
  ok('a link with a date variable leads to the day counted from the note', (await next.count()) === 1 && !(await next.getAttribute('class')).includes('missing'), await next.getAttribute('class').catch(() => 'none'))
  ok('and the note it leads to knows it is linked', [...(await page.evaluate(() => [...app.metadata.backlinks('Days/2026-10-09.md').keys()]))].join() === 'Days/2026-10-08.md')
  ok('no stray note stands for the variable itself', !(await page.evaluate(() => [...(app.metadata.unresolvedLinks.get('Days/2026-10-08.md')?.keys() ?? [])].join())).includes('{{'), await page.evaluate(() => [...(app.metadata.unresolvedLinks.get('Days/2026-10-08.md')?.keys() ?? [])].join()))
  await next.click()
  await wait(600)
  ok('a click opens that day', (await t.activeTab()) === '2026-10-09', await t.activeTab())
  await t.open('2026-10-08')
  await page.locator(`${leaf} .lp-wikilink`, { hasText: '← yesterday' }).click()
  await wait(1200)
  ok('a day that has no note yet is created under its date, not under the variable', exists('Days/2026-10-07.md') && !exists('{{date-1d:YYYY-MM-DD}}.md') && (await t.activeTab()) === '2026-10-07', await t.activeTab())

  // ---- the search window: over the note, no sidebar needed, with the searches made before
  await page.keyboard.press('Control+Shift+f')
  const win = page.locator('dialog:has(input[aria-label="Поиск по всем заметкам"])')
  await win.waitFor()
  const last = await win.locator('input').inputValue()
  ok('the search window opens with what was searched last, selected', last.length > 0 && (await win.locator('input').evaluate((el) => el.selectionEnd - el.selectionStart)) === last.length, last)
  await page.keyboard.type('needle')
  await wait(500)
  ok('and shows the notes and the lines found', (await win.locator('.file').count()) === 1 && (await t.flat(win.locator('.line').first())).includes('needle haystack') && (await win.locator('mark').count()) >= 1, await t.flat(win))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await wait(700)
  const landed = await page.evaluate(() => {
    const { state } = app.workspace.activeEditor
    return state.doc.lineAt(state.selection.main.head).number
  })
  ok('Enter on a found line opens the note there', (await t.count('dialog[open]')) === 0 && (await t.activeTab()) === 'C' && landed === 2, landed)
  await page.keyboard.press('Control+Shift+f')
  await win.waitFor()
  await win.locator('input').fill('')
  await wait(300)
  ok('searches that led somewhere are kept as history', (await t.flat(win.locator('.history'))).includes('needle'), await t.flat(win))
  await win.locator('.history button', { hasText: 'needle' }).click()
  await wait(400)
  ok('a click on one repeats it', (await win.locator('input').inputValue()) === 'needle' && (await win.locator('.file').count()) === 1)
  await page.keyboard.press('Escape')
  await wait(300)

  // ---- finding in the note: a bar above the text, Ctrl+H adds replacing
  await page.locator(`${leaf} .cm-content`).click()
  await page.keyboard.press('Control+f')
  const bar = page.locator(`${leaf} .find-bar`)
  await bar.waitFor()
  const top = await page.evaluate(() => {
    const leafEl = document.querySelector('.leaf:not([hidden])')
    return leafEl.querySelector('.find-bar').getBoundingClientRect().top < leafEl.querySelector('.cm-content').getBoundingClientRect().top
  })
  ok('Ctrl+F opens a bar above the text, without the row to replace', top && (await bar.locator('.find-replace').isHidden()) && (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Найти в заметке')
  await page.keyboard.type('needle')
  await wait(300)
  const centred = await page.evaluate(() => {
    const leafEl = document.querySelector('.leaf:not([hidden])')
    const found = leafEl.querySelector('.cm-searchMatch-selected')
    if (!found) return 'no current match'
    const style = getComputedStyle(found)
    return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.boxShadow !== 'none' ? 'lit' : 'plain'
  })
  ok('the place found is selected and stands out', centred === 'lit', centred)
  ok('it counts what it found', (await t.flat(bar.locator('.find-count'))) === '1 из 1', await t.flat(bar.locator('.find-count')))
  await page.keyboard.press('Control+h')
  await wait(200)
  ok('Ctrl+H adds the row to replace with', await bar.locator('.find-replace').isVisible())
  await bar.locator('.find-replace input').fill('pin')
  await bar.locator('.find-replace input').press('Enter')
  await bar.locator('.find-replace input').press('Enter')
  await wait(900)
  ok('replacing changes the note', read('Sub/C.md').includes('pin haystack') && !read('Sub/C.md').includes('needle'), read('Sub/C.md'))
  await page.keyboard.press('Escape')
  await wait(200)
  ok('Esc closes the bar', (await t.count(`${leaf} .find-bar`)) === 0)
  await page.keyboard.press('Control+f')
  await bar.waitFor()
  await bar.locator('input').first().fill('')
  await page.keyboard.press('ArrowUp')
  ok('Up in the field brings back an earlier search', (await bar.locator('input').first().inputValue()) === 'needle', await bar.locator('input').first().inputValue())
  await page.keyboard.press('Escape')
}
