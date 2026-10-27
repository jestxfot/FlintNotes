// The phone's frame: bars on top and below, the sidebars as drawers pulled by a finger, sheets from the bottom,
// a bar of edits over the keyboard; and the server letting a phone of the home network in by a key.
import fs from 'node:fs'
import path from 'node:path'

export const phone = true
export const viewport = { width: 390, height: 780 }
export const vault = {
  plugins: ['outline', 'quick-switcher'],
  files: {
    'Inbox/Shopping.md': '# Shopping\n\nmilk\n',
    'Ideas.md': '# Ideas\n\n## One\n\nfirst idea\n',
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  const shots = process.env.FLINT_SHOTS
  const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }))
  if (shots) fs.mkdirSync(shots, { recursive: true })
  // A finger drawn across the screen, as the browser of a phone reports it.
  const swipe = (selector, from, to) =>
    page.evaluate(
      ([selector, from, to]) => {
        const target = document.querySelector(selector)
        const touch = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: 400 })
        target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(from)], changedTouches: [touch(from)] }))
        for (let i = 1; i <= 8; i++) target.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(from + ((to - from) * i) / 8)], changedTouches: [touch(from + ((to - from) * i) / 8)] }))
        target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(to)] }))
      },
      [selector, from, to],
    )
  const drawerOpen = (side) => page.evaluate((side) => !document.querySelector(`.drawer.${side}`)?.hasAttribute('inert'), side)
  // The frame is drawn once the app has its vault from the server, a moment after the page has loaded.
  await page.waitForSelector('.phone-top', { timeout: 20000 }).catch(() => {})

  ok('a phone gets the frame of its own', (await page.evaluate(() => document.documentElement.classList.contains('mobile'))) && (await t.count('.phone-top')) === 1 && (await t.count('.phone-nav')) === 1 && (await t.count('.tabbar')) === 0)
  ok('the drawers start closed', !(await drawerOpen('left')))
  await shot('empty')

  // The files: from the button on top; a note opened there closes the drawer.
  await page.locator('.phone-top button[aria-label="Файлы"]').tap()
  await wait(400)
  ok('the button on top pulls out the files', await drawerOpen('left'))
  await shot('drawer')
  await page.locator('.drawer.left .tree .row', { hasText: 'Inbox' }).tap()
  await wait(200)
  await page.locator('.drawer.left .tree .row', { hasText: 'Shopping' }).tap()
  await page.waitForSelector(`${t.leaf} .cm-content`)
  await wait(500)
  ok('a note opened from the drawer closes it', !(await drawerOpen('left')))
  ok('the bar on top shows the note and its folder', (await page.locator('.phone-name').innerText()) === 'Shopping' && (await page.locator('.phone-folder').innerText()) === 'Inbox', await page.locator('.phone-title').innerText())

  // A finger drawn across the note pulls a drawer out; drawn back, it goes.
  await page.evaluate(() => document.activeElement?.blur())
  await swipe('.content .cm-content', 40, 300)
  await wait(400)
  ok('a swipe to the right pulls out the files', await drawerOpen('left'))
  await swipe('.drawer.left', 300, 20)
  await wait(400)
  ok('a swipe back sends them away', !(await drawerOpen('left')))
  await swipe('.content .cm-content', 340, 60)
  await wait(400)
  ok('a swipe to the left pulls out the right sidebar', await drawerOpen('right'))
  await page.locator('.drawer-shade').tap({ position: { x: 20, y: 300 } })
  await wait(400)
  ok('a tap beside a drawer closes it', !(await drawerOpen('right')))

  // The open tabs, as a sheet.
  await page.evaluate(() => app.workspace.openFile('Ideas.md', { newTab: true }))
  await wait(600)
  ok('the button of the tabs counts them', (await page.locator('.phone-count').innerText()) === '2')
  await page.locator('.phone-nav button[aria-label="Вкладки"]').tap()
  await wait(400)
  ok('the sheet lists the open tabs', (await t.count('.sheet .tab-row')) === 2 && (await t.count('.sheet .tab-row.active')) === 1)
  await shot('tabs')
  await page.locator('.sheet .tab-open', { hasText: 'Shopping' }).tap()
  await wait(500)
  ok('a tab chosen there comes on screen, and the sheet goes', (await page.locator('.phone-name').innerText()) === 'Shopping' && (await t.count('.sheet')) === 0)

  // More actions; the settings take the whole screen, the list of pages and a page in turn.
  await page.locator('.phone-nav button[aria-label="Ещё"]').tap()
  await wait(400)
  ok('the sheet of more actions has the settings', (await t.count('.sheet .tile')) >= 5 && (await page.locator('.sheet .tile', { hasText: 'Настройки' }).count()) === 1)
  await shot('more')
  await page.locator('.sheet .tile', { hasText: 'Настройки' }).tap()
  await wait(500)
  const box = await page.locator('dialog[open]').boundingBox()
  ok('the settings fill the screen', box && box.width >= 389 && box.height >= 700, JSON.stringify(box))
  ok('first the list of pages', await page.locator('dialog[open] nav').isVisible())
  await page.locator('dialog[open] nav button', { hasText: 'Интерфейс' }).tap()
  await wait(300)
  ok('then the page chosen, with a way back', !(await page.locator('dialog[open] nav').isVisible()) && (await page.locator('dialog[open] .phone-back').isVisible()))
  await shot('settings')
  await page.locator('dialog[open] .phone-back').tap()
  await wait(200)
  ok('back to the list', await page.locator('dialog[open] nav').isVisible())
  await page.locator('dialog[open] nav .phone-done').tap()
  await wait(300)

  // Typing: the bar over the keyboard replaces the bar of buttons, and its buttons keep the focus in the note.
  await page.evaluate(() => {
    const editor = app.workspace.activeEditor
    const at = editor.state.doc.toString().indexOf('milk')
    editor.dispatch({ selection: { anchor: at, head: at + 4 } })
    editor.focus()
  })
  await wait(300)
  ok('typing shows the bar over the keyboard instead of the bar of buttons', (await t.count('.keyboard-bar')) === 1 && (await t.count('.phone-nav')) === 0)
  await shot('keyboard')
  await page.locator('.keyboard-bar [data-command="core:edit-bold"]').tap()
  await wait(100)
  await page.locator('.keyboard-bar [data-command="core:edit-checkbox"]').tap()
  await wait(900)
  ok('its buttons edit the note: bold, then a task', t.read('Inbox/Shopping.md').includes('- [ ] **milk**'), t.read('Inbox/Shopping.md'))
  ok('and the note keeps the focus', await page.evaluate(() => !!document.activeElement?.closest('.cm-content')))
  await page.locator('.keyboard-bar [data-command="core:edit-checkbox"]').tap()
  await wait(900)
  ok('the same button ticks the task', t.read('Inbox/Shopping.md').includes('- [x] **milk**'), t.read('Inbox/Shopping.md'))
  await page.locator('.keyboard-bar .hide').tap()
  await wait(300)
  ok('hiding the keyboard brings the bar of buttons back', (await t.count('.phone-nav')) === 1)

  // A long press opens the menu of what is under the finger, as a sheet.
  await page.locator('.phone-top button[aria-label="Файлы"]').tap()
  await wait(400)
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.drawer.left .tree .row')].find((one) => one.textContent.includes('Ideas'))
    const box = row.getBoundingClientRect()
    const touch = new Touch({ identifier: 2, target: row, clientX: box.left + 20, clientY: box.top + 10 })
    row.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch], changedTouches: [touch] }))
  })
  await wait(800)
  ok('a long press opens the menu as a sheet from the bottom', (await t.count('.sheet .sheet-menu button')) > 2, await page.locator('body').innerText().catch(() => ''))
  await shot('menu')
  await page.evaluate(() => document.dispatchEvent(new TouchEvent('touchend', { bubbles: true })))
  await page.keyboard.press('Escape')
  await wait(300)
  ok('Esc puts the sheet away', (await t.count('.sheet')) === 0)

  // The device may take the computer's frame, and back: its own choice, not the vault's.
  await page.evaluate(() => app.commands.run('core:toggle-mobile-layout'))
  await wait(400)
  ok("the computer's frame on request", (await t.count('.tabbar')) === 1 && (await t.count('.phone-top')) === 0 && (await page.locator(`${t.leaf} .cm-content`).count()) === 1)
  await page.evaluate(() => app.commands.run('core:toggle-mobile-layout'))
  await wait(400)
  ok("and the phone's again, with the note still there", (await t.count('.phone-top')) === 1 && (await page.locator(`${t.leaf} .cm-content`).count()) === 1)

  // ---- the server: a phone of the home network comes in with the key, and only with it
  const origin = new URL(page.url()).origin
  const PORT = 4797
  const access = await page.evaluate((port) => app.vault.setPhone({ on: true, port }), PORT)
  ok('turned on, the phones get a port of their own and a key', access.on && access.port === PORT && access.key?.length >= 20 && !access.error, JSON.stringify(access))
  const there = `http://127.0.0.1:${PORT}`
  const bare = await fetch(`${there}/`)
  ok('without the key a phone gets only the page saying where to find it', bare.status === 401 && (await bare.text()).includes('Нужен ключ'))
  const wrong = await fetch(`${there}/?key=nope`, { redirect: 'manual' })
  ok('a wrong key lets nobody in', wrong.status === 401)
  const right = await fetch(`${there}/?key=${access.key}`, { redirect: 'manual' })
  const cookie = (right.headers.get('set-cookie') ?? '').split(';')[0]
  ok('the right key is put in a cookie, and leaves the address', right.status === 302 && right.headers.get('location') === '/' && cookie === `flint-key=${access.key}`, `${right.status} ${right.headers.get('location')} ${cookie}`)
  const page2 = await fetch(`${there}/`, { headers: { cookie } })
  const notes = await fetch(`${there}/api/tree`, { headers: { cookie } })
  ok('with the cookie the phone gets the app and the notes', page2.status === 200 && (await page2.text()).includes('<div id="app">') && notes.status === 200 && (await notes.text()).includes('Shopping.md'))
  const write = await fetch(`${there}/api/file?path=${encodeURIComponent('From phone.md')}`, { method: 'PUT', headers: { cookie, origin: there, 'content-type': 'text/plain' }, body: 'hello from the phone' })
  ok('and may write notes', write.ok && t.read('From phone.md') === 'hello from the phone', `${write.status} ${await write.text()}`)
  const quit = await fetch(`${there}/api/quit`, { method: 'POST', headers: { cookie, origin: there } })
  const key = await fetch(`${there}/api/phone`, { headers: { cookie } })
  ok("but not what is the computer's: stopping the server, the key", quit.status === 403 && key.status === 403)
  const foreign = await fetch(`${there}/api/file?path=x.md`, { method: 'PUT', headers: { cookie, origin: 'http://evil.example' }, body: 'x' })
  ok('a page of another site gets nothing, cookie or not', foreign.status === 403)
  const renewed = await page.evaluate(() => app.vault.setPhone({ newKey: true }))
  const old = await fetch(`${there}/api/tree`, { headers: { cookie } })
  ok('a new key shuts out the phones let in before', renewed.key !== access.key && old.status === 401)
  ok('the computer itself is not asked for a key', (await fetch(`${origin}/api/tree`)).status === 200)
  await page.evaluate(() => app.vault.setPhone({ on: false }))
  const off = await fetch(`${there}/`).then(
    () => 'answered',
    () => 'closed',
  )
  ok('turned off, nothing listens there', off === 'closed')
}
