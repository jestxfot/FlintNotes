// Typing and switching stay quick: a note's own links and tags are worked into the index without going through the
// whole vault, what a save sets off waits for the typing to stop, widgets out of sight do no work, and a tab or a
// note left in a tab keeps its page laid out to come back to.
export const viewport = { width: 1400, height: 900 }
export const vault = {
  plugins: ['tasks', 'search', 'tags', 'backlinks', 'links'],
  settings: { core: { reuseTab: true } },
  files: {
    'Writing.md': '# Writing\n\nFirst line.\n\n```tasks\nnot done\n```\n\n- [ ] one task\n- [ ] another task\n',
    'Target.md': 'target\n',
    'Waiting.md': 'it links to [[Later]] before Later exists\n',
    'Zebra.md': 'nothing about stripes\n',
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  await page.waitForFunction(() => window.app?.commands?.list().some((c) => c.id === 'search:open-panel'), null, { timeout: 20000 })
  await t.open('Writing')

  // ---- the index follows one note at a time
  const facts = () =>
    page.evaluate(() => ({
      back: [...app.metadata.backlinks('Target.md').keys()],
      missing: [...(app.metadata.unresolvedLinks.get('Writing.md')?.keys() ?? [])],
      tag: app.metadata.tags().find((one) => one.tag === 'fresh')?.files ?? [],
    }))
  await page.evaluate(() => {
    window.__resolved = []
    app.metadata.on('resolved', (what) => window.__resolved.push({ notes: what.notes && [...what.notes], names: what.names }))
  })
  await page.keyboard.type(' [[Target]] [[Nowhere]] #fresh')
  await wait(1200)
  let now = await facts()
  ok('a link typed is a backlink of the note it leads to, a link to nothing is unresolved, a tag typed is a tag', now.back.includes('Writing.md') && now.missing.includes('Nowhere') && now.tag.includes('Writing.md'), JSON.stringify(now))
  const told = await page.evaluate(() => window.__resolved)
  ok('only that note is worked out again, not the vault', told.length > 0 && told.every((one) => !one.names && JSON.stringify(one.notes) === '["Writing.md"]'), JSON.stringify(told))
  for (let i = 0; i < ' [[Target]] [[Nowhere]] #fresh'.length; i++) await page.keyboard.press('Backspace')
  await wait(1200)
  now = await facts()
  ok('taken out again, the backlink, the unresolved link and the tag are gone', !now.back.includes('Writing.md') && !now.missing.includes('Nowhere') && !now.tag.length, JSON.stringify(now))
  await page.evaluate(() => app.vault.create('Later.md', 'later\n'))
  await page.waitForFunction(() => app.metadata.backlinks('Later.md').has('Waiting.md'), null, { timeout: 5000 }).catch(() => {})
  ok('a note made later is a backlink target of the links that waited for it', await page.evaluate(() => app.metadata.backlinks('Later.md').has('Waiting.md') && !app.metadata.unresolvedLinks.get('Waiting.md')?.has('Later')))

  // ---- what a save sets off waits for the typing to stop
  const list = page.locator(`${t.leaf} .tasks-block`)
  await list.locator('li').first().waitFor()
  const mark = () => list.evaluate((el) => (el.querySelector('li').dataset.mark = 'old'))
  const marked = () => list.evaluate((el) => el.querySelector('li')?.dataset.mark === 'old')
  // Typing above the tasks moves their lines: the list is drawn again, but not between two words.
  await page.evaluate(() => {
    const editor = app.workspace.activeEditor
    const at = editor.state.doc.line(3).to
    editor.dispatch({ selection: { anchor: at } })
    editor.focus()
  })
  await mark()
  await page.keyboard.press('Enter')
  await page.keyboard.type('a')
  await wait(450) // the note is saved: its tasks have moved a line down
  let kept = true
  for (const key of ' while the typing goes on') {
    await page.keyboard.type(key)
    await wait(70)
    kept &&= await marked()
  }
  ok('while the typing goes on, the list of tasks is not drawn again', kept)
  await wait(2000)
  ok('once it stops, the list follows the note', !(await marked()) && (await list.locator('li').count()) === 2)

  // ---- a widget out of sight does no work; it catches up when shown
  await page.evaluate(() => app.commands.run('search:open-panel'))
  const field = page.locator('aside input[type="search"]')
  await field.waitFor()
  await field.fill('stripes')
  await wait(600)
  const found = () => page.locator('aside .results .file .name').allInnerTexts()
  ok('the search panel finds the note', JSON.stringify(await found()) === '["Zebra"]', JSON.stringify(await found()))
  await page.evaluate(() => app.panels.reveal('tags'))
  await wait(300)
  await page.evaluate(() => app.workspace.openFile('Target.md'))
  await page.waitForSelector(`${t.leaf} .cm-content`)
  await t.cursorToEnd()
  await page.keyboard.type(' stripes here too')
  await wait(2000)
  const hidden = await page.evaluate(() => [...document.querySelectorAll('aside .results .file .name')].map((el) => el.textContent.trim()))
  ok('behind another widget, the search is not run again as notes change', JSON.stringify(hidden) === '["Zebra"]', JSON.stringify(hidden))
  await page.evaluate(() => app.panels.reveal('search'))
  await wait(800)
  ok('shown again, it has caught up', JSON.stringify((await found()).sort()) === '["Target","Zebra"]', JSON.stringify(await found()))
  ok('the line found is the one the words are on', (await page.locator('aside .results .line').allInnerTexts()).some((line) => line.includes('stripes here too')))

  // ---- a note left in a tab, and a tab out of sight, stay laid out
  await page.evaluate(() => {
    document.querySelector('.leaf:not([hidden]) > .leaf-view:not([hidden])').dataset.mark = 'target'
  })
  await page.evaluate(() => app.workspace.openFile('Zebra.md'))
  await page.waitForFunction(() => document.querySelector('.leaf:not([hidden]) > .leaf-view:not([hidden]) .cm-content')?.textContent.includes('stripes'))
  const left = await page.evaluate(() => {
    const kept = document.querySelector('[data-mark="target"]')
    return { inTab: kept?.parentElement === document.querySelector('.leaf:not([hidden])'), hidden: kept?.hidden, look: kept && getComputedStyle(kept).contentVisibility }
  })
  ok('a note left for another in the same tab stays in the tab, laid out but not drawn', left.inTab && left.hidden && left.look === 'hidden', JSON.stringify(left))
  await page.goBack()
  await page.waitForFunction(() => document.querySelector('.leaf:not([hidden]) > .leaf-view:not([hidden])')?.dataset.mark === 'target', null, { timeout: 5000 }).catch(() => {})
  ok('going back shows that same page again', await page.evaluate(() => document.querySelector('.leaf:not([hidden]) > .leaf-view:not([hidden])')?.dataset.mark === 'target'))
  ok('and the editor on screen is its editor', (await t.text()).includes('stripes here too'), await t.text())
  await page.evaluate(() => app.workspace.openFile('Writing.md', { newTab: true }))
  await page.waitForSelector(`${t.leaf} .tasks-block`)
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.leaf[hidden]')].map((el) => getComputedStyle(el).contentVisibility))
  ok('a tab out of sight is not drawn but stays laid out', tabs.length >= 1 && tabs.every((look) => look === 'hidden'), JSON.stringify(tabs))
  await page.keyboard.press('Control+End')
  await page.keyboard.type('typed here')
  await wait(1200)
  ok('the tab on screen takes the typing', t.read('Writing.md').trimEnd().endsWith('typed here'), t.read('Writing.md').slice(-60))
}
