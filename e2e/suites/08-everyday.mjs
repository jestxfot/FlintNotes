// Everyday editing: properties form, highlight, callouts, list wrapping, code colors,
// task fields, outline, pasted and dropped attachments, moving files by dragging.
const LONG = 'a long item '.repeat(30).trim()
const NOTE = `---
status: draft
count: 3
done: false
due: 2026-10-20
tags: [a, b]
---
# Title

==marked== text

> [!warning] Careful
> body line

> [!tip]
> no title

- ${LONG}
- [ ] old task 📅 2020-01-01 ⏫

\`\`\`js
const x = "s" // c
\`\`\`

## Second

### Third

end
`

export const viewport = { width: 1300, height: 1100 }
export const vault = {
  plugins: ['properties', 'attachments', 'outline', 'tasks'],
  files: { 'Notes.md': NOTE, 'Move.md': 'move me\n', 'Folder/Inner.md': 'inner\n' },
}

export async function run(t) {
  const { page, ok, wait, read, exists, leaf } = t
  const count = (selector) => t.count(`${leaf} ${selector}`)
  const props = page.locator(`${leaf} .props`)
  const row = (name) => props.locator(`.props-row[data-key="${name}"]`)
  const names = () => props.locator('.props-name').evaluateAll((inputs) => inputs.map((input) => input.value))
  const cursorLine = () =>
    page.evaluate(() => {
      const { state } = app.workspace.activeEditor
      return state.doc.lineAt(state.selection.main.head).text
    })

  await t.row('Notes').click()
  await page.waitForSelector(`${leaf} .cm-content`)
  await wait(1200)
  ok('the cursor starts below the properties', (await cursorLine()) === '# Title', await cursorLine())
  ok('properties are a form, not YAML', JSON.stringify(await names()) === JSON.stringify(['status', 'count', 'done', 'due', 'tags']) && !(await t.text()).includes('status: draft'), JSON.stringify(await names()))

  await row('status').locator('.props-value').fill('final')
  await page.keyboard.press('Tab')
  await wait(700)
  ok('a text property is saved', read('Notes.md').startsWith('---\nstatus: final\ncount: 3\n'), read('Notes.md').slice(0, 80))
  await row('count').locator('.props-value').fill('7')
  await page.keyboard.press('Tab')
  await wait(700)
  ok('a number stays a number', read('Notes.md').includes('count: 7\n'))
  await row('done').locator('.props-value').click()
  await wait(700)
  ok('a checkbox toggles', read('Notes.md').includes('done: true\n'))
  await row('due').locator('.props-value').fill('2026-11-05')
  await page.keyboard.press('Tab')
  await wait(700)
  ok('a date is edited with a date field', read('Notes.md').includes('due: 2026-11-05\n') && (await row('due').locator('.props-value').getAttribute('type')) === 'date')
  await row('tags').locator('.props-list input').fill('c')
  await page.keyboard.press('Enter')
  await wait(700)
  ok('an item is added to a list', read('Notes.md').includes('tags: [a, b, c]\n'), read('Notes.md').slice(0, 120))
  await row('tags').locator('.props-chip', { hasText: /^a/ }).locator('button').click()
  await wait(700)
  ok('and removed', read('Notes.md').includes('tags: [b, c]\n'))
  await row('count').locator('.props-name').fill('amount')
  await page.keyboard.press('Tab')
  await wait(700)
  ok('renaming keeps the order', read('Notes.md').startsWith('---\nstatus: final\namount: 7\ndone: true\n'), read('Notes.md').slice(0, 80))
  await row('amount').locator('.props-name').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Тип свойства' }).hover()
  await page.locator('.menu button', { hasText: /^\s*Текст\s*$/ }).click()
  await wait(700)
  ok('the type can be changed', read('Notes.md').includes('amount: "7"\n'), read('Notes.md').slice(0, 80))
  ok('the row carries no controls of its own', (await row('done').locator('select, .props-remove').count()) === 0)
  await row('done').locator('.props-name').click({ button: 'right' })
  await page.locator('.menu button', { hasText: 'Удалить' }).click()
  await wait(700)
  ok('a property is deleted', !read('Notes.md').includes('done:') && (await names()).length === 4)
  await props.locator('.props-add').click()
  await wait(700)
  ok('a property is added', read('Notes.md').includes('свойство: ""\n---\n# Title') && (await names()).length === 5, read('Notes.md').slice(0, 140))
  ok('the note below is untouched', read('Notes.md').endsWith(NOTE.slice(NOTE.indexOf('# Title'))))

  await t.cursorToEnd()
  await wait(1500)
  const text = await t.text()
  ok('==highlight== is marked', (await page.locator(`${leaf} .lp-highlight`).innerText()) === 'marked' && !text.includes('=='))
  const titles = await page.locator(`${leaf} .lp-callout-title`).allInnerTexts()
  ok('callouts get a title', JSON.stringify(titles.map((title) => title.trim())) === JSON.stringify(['Careful', 'Совет']) && !text.includes('[!'), JSON.stringify(titles))
  ok('callouts are colored by type', (await count('.lp-callout-warn')) === 2 && (await count('.lp-callout-good')) === 2)
  const indent = await page.locator(`${leaf} .lp-list-line`).first().evaluate((line) => ({ pad: parseFloat(line.style.paddingLeft), indent: parseFloat(line.style.textIndent), rows: Math.round(line.getBoundingClientRect().height / parseFloat(getComputedStyle(line).lineHeight)) }))
  ok('a wrapped list item lines up with its text', indent.pad > 5 && indent.indent === -indent.pad && indent.rows > 1, JSON.stringify(indent))
  const colors = await page.locator(`${leaf} .lp-code`, { hasText: 'const' }).evaluate((line) => [...new Set([...line.querySelectorAll('span')].map((span) => getComputedStyle(span).color))])
  ok('code is syntax-highlighted', colors.length >= 3, JSON.stringify(colors))
  ok('task fields are set apart, overdue marked', (await count('.lp-task-field')) === 2 && (await count('.lp-task-field.overdue')) === 1)

  const outline = page.locator('aside.right')
  ok('outline lists the headings', (await t.flat(outline)).includes('Title Second Third'), await outline.innerText())
  await outline.locator('button', { hasText: 'Third' }).click()
  await wait(500)
  ok('outline jumps to a heading', (await cursorLine()) === '### Third', await cursorLine())

  await t.cursorToEnd()
  // A screenshot pasted from the clipboard, and a file dropped from the desktop.
  await page.evaluate(() => {
    const send = (type, key, file) => {
      const data = new DataTransfer()
      data.items.add(file)
      const Event = type === 'paste' ? ClipboardEvent : DragEvent
      const box = document.querySelector('.leaf:not([hidden]) .cm-content').getBoundingClientRect()
      const event = new Event(type, { [key]: data, bubbles: true, cancelable: true, clientX: box.left + 40, clientY: box.bottom - 20 })
      document.querySelector('.leaf:not([hidden]) .cm-content').dispatchEvent(event)
    }
    send('paste', 'clipboardData', new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' }))
    setTimeout(() => send('drop', 'dataTransfer', new File(['hello'], 'report.txt', { type: 'text/plain' })), 600)
  })
  await wait(2200)
  const note = read('Notes.md')
  const pasted = /!\[(Вставка \d{14}\.png)\]\(([^)]+)\)/.exec(note)
  ok('a pasted image is saved and linked', !!pasted && exists(`Вложения/${pasted[1]}`) && decodeURI(pasted[2]) === `Вложения/${pasted[1]}`, note.slice(-160))
  ok('a dropped file is saved and linked', note.includes('[report.txt](%D0%92%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D1%8F/report.txt)') && read('Вложения/report.txt') === 'hello', note.slice(-160))

  await t.row('Move').dragTo(t.row('Folder'))
  await wait(900)
  ok('dragging a note onto a folder moves it', exists('Folder/Move.md') && !exists('Move.md'))
  await t.row('Inner').dragTo(page.locator('.tree'), { targetPosition: { x: 100, y: 500 } })
  await wait(900)
  ok('dragging to the empty area moves it to the top', exists('Inner.md') && !exists('Folder/Inner.md'))

  // Tabs used to come back before the plugins had loaded, showing raw Markdown for a moment.
  await page.addInitScript(() => {
    window.__rawSeen = false
    const watch = () => {
      const content = document.querySelector('.leaf:not([hidden]) .cm-content')
      if (content && /^status:/m.test(content.innerText)) window.__rawSeen = true
      requestAnimationFrame(watch)
    }
    watch()
  })
  await page.reload()
  await page.waitForSelector(`${leaf} .props`)
  await wait(1500)
  ok('a restored note is never shown as raw Markdown first', !(await page.evaluate(() => window.__rawSeen)) && (await t.activeTab()) === 'Notes')
}
