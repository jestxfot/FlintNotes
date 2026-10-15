// Programs run by templates (allowed by hand only), link cards from an address, charts, the rarer button types.
import fs from 'node:fs'
import { fixture } from '../helpers.mjs'

const f = '```'
export const vault = {
  plugins: ['templates', 'link-embed', 'charts', 'dataview', 'buttons'],
  settings: { templates: { folder: 'Templates', onCreate: false } },
  files: {
    'Templates/Stamp.md': 'stamped <% tp.file.title %>',
    'pic.png': fixture('pic.png'),
    'Run.md': 'Out: <%+ await tp.user.hello({ who: "World" }) %>!\n\nBad: <%+ await tp.user.nothere() %>\n\nend\n',
    'Paste.md': 'first\n\n',
    'Cards.md': ['```embed', 'title: "A video"', 'image: ""', 'description: ""', 'url: "https://www.youtube.com/watch?v=xHrhYhfLrF8"', '```', '', '```embed', 'title: "A page"', 'image: ""', 'description: ""', 'url: "https://example.com/b"', '```', '', 'end', ''].join('\n'),
    'Charts.md': [
      `${f}chart`, 'type: bar', 'labels: [Mon, Tue, Wed]', 'series:', '  - title: Steps', '    data: [4, 7, 5]', 'width: 60%', 'beginAtZero: true', f, '',
      `${f}chart`, 'type: pyramid', f, '',
      `${f}dataviewjs`, 'const data = { type: "line", data: { labels: ["a", "b"], datasets: [{ label: "L", data: [1, 2] }] } }', 'window.renderChart(data, this.container)', f, '', 'end', '',
    ].join('\n'),
    'Buttons.md': ['5 apples', '7 pears', '', `${f}button`, 'name Sum', 'type calculate', 'action $1 + $2 * 2', f, '', `${f}button`, 'name Stamp', 'type append template', 'action Stamp', 'remove true', f, '', `${f}button`, 'name Make', 'type note(Made) text', 'action made by button', f, '', 'end', ''].join('\n'),
  },
}

export function afterStart(t) {
  // What a user writes by hand into the config file to allow a program.
  const file = `${t.vault}.config.json`
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  config.systemCommands = { [config.current]: { commands: { hello: process.platform === 'win32' ? 'echo Hello, %who%' : 'echo "Hello, $who"' }, timeout: 5 } }
  fs.writeFileSync(file, JSON.stringify(config))
}

export async function run(t) {
  const { page, ok, wait, read, leaf } = t

  // ---- programs
  await t.open('Run')
  await wait(1500)
  let s = (await t.text()).replace(/\s+/g, ' ')
  ok('an allowed program runs and its output lands in the note', s.includes('Out: Hello, World!'), s)
  ok('a name that was not allowed is not a function', /Bad: Шаблон: .*(nothere|not a function)/.test(s), s)
  const call = (body, headers = {}) => fetch(`${t.url}api/exec`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.text()])
  const own = { Origin: t.url.replace(/\/$/, '') }
  ok('only an allowed name can be run, whatever else is sent', (await call({ name: 'rm', command: 'echo pwned' }, own))[0] === 403 && (await call({ name: 'hello', command: 'echo pwned', env: { who: 'x' } }, own))[1].includes('Hello, x'))
  ok('other local pages may not run programs', (await call({ name: 'hello' }, { Origin: 'http://localhost:5173' }))[0] === 403 && (await call({ name: 'hello' }))[0] === 403)
  const put = await fetch(`${t.url}api/system-commands`, { method: 'PUT', headers: { ...own, 'content-type': 'application/json' }, body: '{"commands":{"x":"echo x"}}' })
  ok('the list of programs cannot be changed over the network', put.status === 404 && !fs.readFileSync(`${t.vault}.config.json`, 'utf8').includes('echo x'), put.status)

  // ---- link cards
  const refused = await fetch(`${t.url}api/unfurl?url=${encodeURIComponent(`${t.url}api/tree`)}`)
  ok('the server does not fetch pages of this machine', refused.status === 400, refused.status)
  await page.route('**/api/unfurl*', (route) => route.fulfill({ json: { url: 'https://example.com/a', title: 'Example "Domain"', description: 'About\nit', image: '', favicon: 'https://example.com/favicon.ico' } }))
  await t.open('Paste')
  await page.evaluate(() => {
    const view = app.workspace.activeEditor
    view.focus()
    const data = new DataTransfer()
    data.setData('text/plain', 'https://example.com/a')
    view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await wait(400)
  const choice = await t.flat(page.locator('.menu'))
  ok('a pasted address asks what to make of it', choice.includes('Оставить как есть') && choice.includes('Создать карточку') && choice.includes('Создать ссылку с названием страницы') && read('Paste.md').includes('https://example.com/a'), choice)
  await page.locator('.menu button', { hasText: 'Создать карточку' }).click()
  await wait(1500)
  ok('an address pasted on an empty line becomes a card in Link Embed\'s format', read('Paste.md').includes('```embed\ntitle: "Example \\"Domain\\""\nimage: ""\ndescription: "About it"\nurl: "https://example.com/a"\nfavicon: "https://example.com/favicon.ico"\n```'), read('Paste.md'))
  await t.cursorToEnd()
  await wait(400)
  ok('and is drawn as one', (await t.flat(page.locator(`${leaf} .embed-card`))).includes('Example "Domain"'))

  // ---- cards saved without a picture get one
  await page.unroute('**/api/unfurl*')
  await page.route('**/api/unfurl*', (route) => route.fulfill({ json: { url: 'https://example.com/b', title: 'B', description: '', image: `${t.url}api/file?path=pic.png`, favicon: '' } }))
  await page.route('https://i.ytimg.com/**', (route) => route.fulfill({ body: fixture('pic.png'), contentType: 'image/png' }))
  await t.open('Cards')
  await wait(1500)
  const pictures = await page.locator(`${leaf} .embed-card-image img`).evaluateAll((list) => list.map((img) => img.src))
  ok('a video card shows the video\'s frame; a page card, the picture the page names', pictures.length === 2 && pictures[0].startsWith('https://i.ytimg.com/vi/xHrhYhfLrF8/') && pictures[1].includes('pic.png'), JSON.stringify(pictures))
  await wait(2500)
  const cards = read('Cards.md')
  const pageCard = cards.split('```').find((part) => part.includes('https://example.com/b')) ?? ''
  ok('a card with empty fields fills them in, in the block itself; what was written stays', /image: "[^"]*pic\.png"/.test(pageCard) && pageCard.includes('title: "A page"'), cards)

  // ---- charts
  await t.open('Charts')
  await wait(1500)
  const charts = page.locator(`${leaf} .chart-box canvas`)
  ok('a chart block and a script chart are drawn', (await charts.count()) === 2, await charts.count())
  const painted = await charts.first().evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let filled = 0
    for (let i = 3; i < data.length; i += 4) if (data[i]) filled++
    return filled
  })
  const box = await page.locator(`${leaf} .chart-box`).first().boundingBox()
  const whole = await page.locator(`${leaf} .chart-block`).first().boundingBox()
  ok('the chart has something on it and takes the asked width', painted > 2000 && Math.abs(box.width / whole.width - 0.6) < 0.03, `${painted} ${box.width}/${whole.width}`)
  ok('a mistake in a chart is explained', (await t.flat(page.locator(`${leaf} .chart-error`))).includes('pyramid'))

  // ---- buttons
  await t.open('Buttons')
  await wait(500)
  const button = (name) => page.locator(`${leaf} .button-block button`, { hasText: name })
  await button('Sum').click()
  await wait(1000)
  ok('"calculate" works with numbers from lines of the note', read('Buttons.md').includes('action $1 + $2 * 2\n```\nРезультат: 19\n'), read('Buttons.md'))
  await button('Stamp').click()
  await wait(1500)
  s = read('Buttons.md')
  ok('"append template" fills in a template; "remove true" takes the button away', s.includes('stamped Buttons') && !s.includes('name Stamp'), s)
  await button('Make').click()
  await wait(1200)
  ok('"note(...) text" creates a note and opens it', t.exists('Made.md') && read('Made.md') === 'made by button' && (await t.activeTab()) === 'Made', `${t.exists('Made.md')} ${await t.activeTab()} ${await page.locator('.notice').allInnerTexts()}`)
}
