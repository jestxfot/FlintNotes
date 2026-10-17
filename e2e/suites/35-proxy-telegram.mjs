// The way to the web chosen in the settings (a SOCKS5 proxy here), and Telegram cards that come through it.
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { fixture } from '../helpers.mjs'

// Pages that do not answer, and an address the proxy check turns down, are what this suite is about.
export const expectsNetworkErrors = /Failed to load resource: (net::ERR_NAME_NOT_RESOLVED|the server responded with a status of (400|502))/

const card = (url) => `\`\`\`embed\ntitle: "${url}"\nimage: ""\ndescription: ""\nurl: "${url}"\n\`\`\`\n\nend\n`
export const vault = {
  plugins: ['link-embed'],
  files: {
    'Start.md': 'start\n',
    'Channel.md': card('http://t.me/flinttestchan'),
    'Site.md': card('http://flint-test.invalid/page'),
    'Dead.md': card('http://flint-dead.invalid/page'),
  },
}

/** Pages as the sites would give them, by the name asked for. */
const pages = {
  't.me': `<html><head><meta property="og:title" content="Тестовый канал"><meta property="og:description" content="О чём канал.\t\tВторая строка"><meta property="og:image" content="https://cdn4.telesco.pe/file/signed-and-stale.jpg"><link rel="icon" href="//telegram.org/img/favicon-32x32.png"></head></html>`,
  'flint-test.invalid': `<html><head><title>Сайт за прокси</title><meta name="description" content="Пришло через SOCKS"></head></html>`,
}

export async function run(t) {
  const { page, ok, wait } = t
  // A site of its own, and a SOCKS5 proxy that leads every name to it (and says which names it was asked for).
  const site = http.createServer((req, res) => res.end(pages[req.headers.host?.split(':')[0]] ?? '<title>?</title>'))
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))
  const asked = []
  const proxy = net.createServer((client) => {
    client.on('error', () => {})
    let got = Buffer.alloc(0)
    let stage = 'hello'
    const read = (chunk) => {
      got = Buffer.concat([got, chunk])
      if (stage === 'hello' && got.length >= 2 + got[1]) {
        got = got.subarray(2 + got[1])
        client.write(Buffer.from([5, 0]))
        stage = 'request'
      }
      if (stage === 'request' && got.length >= 7 && got.length >= 7 + got[4]) {
        asked.push(got.subarray(5, 5 + got[4]).toString())
        const rest = got.subarray(7 + got[4])
        client.off('data', read)
        client.pause()
        const up = net.connect(site.address().port, '127.0.0.1', () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          if (rest.length) up.write(rest)
          client.pipe(up).pipe(client)
          client.resume()
        })
        up.on('error', () => client.destroy())
      }
    }
    client.on('data', read)
  })
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const address = `socks5://127.0.0.1:${proxy.address().port}`

  // Telegram's own pictures, as Telegram would give them.
  await page.route(/^https?:\/\/(t\.me\/i\/userpic|telegram\.org\/img)\//, (route) => route.fulfill({ contentType: 'image/png', body: fixture('pic.png') }))
  try {
    await t.open('Start')
    await page.evaluate(() => app.commands.run('core:settings'))
    await page.locator('nav button', { hasText: 'Программа' }).click()
    await wait(700)
    const setting = page.locator('.proxy-setting')
    ok('the program page has the proxy, as the computer has it at first', (await setting.locator('select').inputValue()) === 'system' && (await setting.locator('input').isHidden()), await t.flat(setting).catch(() => 'none'))
    await setting.locator('select').selectOption('manual')
    await setting.locator('input').fill('socks5://')
    await setting.locator('button', { hasText: 'Применить' }).click()
    await wait(500)
    ok('an address that is not a proxy is not taken', /Адрес прокси/.test(await t.flat(setting)), await t.flat(setting))
    await setting.locator('input').fill(address)
    await setting.locator('button', { hasText: 'Применить' }).click()
    await wait(600)
    const saved = JSON.parse(fs.readFileSync(`${t.vault}.config.json`, 'utf8'))
    ok('a SOCKS proxy is taken and kept with the program', saved.proxy === address && /Сохранено/.test(await t.flat(setting)), JSON.stringify(saved.proxy))
    await page.keyboard.press('Escape')
    await wait(300)

    // A Telegram channel's card fills in through the proxy, with the channel's picture by its lasting address.
    await t.open('Channel')
    await t.cursorToEnd()
    await page.waitForFunction(() => /Тестовый канал/.test(app.workspace.activeEditor.state.doc.toString()), null, { timeout: 10_000 }).catch(() => {})
    const channel = t.read('Channel.md')
    ok('a Telegram card is filled in through the SOCKS proxy', channel.includes('title: "Тестовый канал"') && channel.includes('description: "О чём канал. Вторая строка"') && asked.includes('t.me'), channel + asked.join(','))
    ok('its picture is the channel\'s own lasting one, not the signed link of its page', channel.includes('image: "https://t.me/i/userpic/320/flinttestchan.jpg"'), channel)
    await wait(400)
    ok('the card says whose channel it is', (await t.flat(page.locator(`${t.leaf} .embed-card-url`))).includes('t.me · @flinttestchan'), await t.flat(page.locator(`${t.leaf} .embed-card-url`)).catch(() => 'none'))
    ok('and shows its picture round, as a portrait', (await page.locator(`${t.leaf} .embed-card-image.is-avatar`).count()) === 1)

    // Through a proxy a name this computer cannot resolve is the proxy's to find.
    await t.open('Site')
    await t.cursorToEnd()
    await page.waitForFunction(() => /Сайт за прокси/.test(app.workspace.activeEditor.state.doc.toString()), null, { timeout: 10_000 }).catch(() => {})
    ok('any page comes through the proxy, its name resolved there', t.read('Site.md').includes('description: "Пришло через SOCKS"') && asked.includes('flint-test.invalid'), t.read('Site.md'))

    // Without a proxy, a page that does not answer is said to, once, with the reason.
    await page.evaluate(() => app.vault.setProxy('off'))
    ok('the proxy can be switched off', JSON.parse(fs.readFileSync(`${t.vault}.config.json`, 'utf8')).proxy === 'off')
    await t.open('Dead')
    await t.cursorToEnd()
    await page.waitForFunction(() => [...document.querySelectorAll('.notice')].some((el) => /не дописана/.test(el.textContent)), null, { timeout: 10_000 }).catch(() => {})
    const notices = await page.locator('.notice').allInnerTexts()
    ok('a card that cannot be filled says why, and how to find out more', notices.some((text) => /flint-dead\.invalid не дописана/.test(text) && /Проверить, видит ли сервер/.test(text)), notices.join(' | '))
  } finally {
    proxy.close()
    site.close()
  }
}
