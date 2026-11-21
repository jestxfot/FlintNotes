// Link cards of sites that the server cannot get to (here: names it cannot resolve), through the desktop app: the app fetches the page,
// and the card is read from it by the page (shared/cards.ts), a video's description included.
const card = (url) => `\`\`\`embed\ntitle: "${url}"\nimage: ""\ndescription: ""\nurl: "${url}"\n\`\`\`\n\nend\n`
const SHOP = 'http://flint-shop.invalid/goods/cheese'
const VIDEO = 'https://www.youtube.com/watch?v=flinttest01'
// The app is slow and the server quick; the app quick and the server slow; neither can connect (the app says why).
const WIN_SLOW = 'http://flint-winslow.invalid/a'
const SRV_SLOW = 'http://flint-srvslow.invalid/b'
const NEITHER = 'http://flint-neither.invalid/c'

// (404: the made-up video's frames on the real i.ytimg.com.)
export const expectsNetworkErrors = /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_FAILED|status of (400|404|502)/
export const vault = {
  plugins: ['link-embed'],
  files: { 'Start.md': 'start\n', 'Shop.md': card(SHOP), 'Video.md': card(VIDEO), 'WinSlow.md': card(WIN_SLOW), 'SrvSlow.md': card(SRV_SLOW), 'Neither.md': card(NEITHER) },
}

const PAGES = {
  [SRV_SLOW]: { url: SRV_SLOW, status: 200, text: '<html><head><title>From the app</title><meta property="og:description" content="App was quick"></head></html>' },
  [NEITHER]: { url: NEITHER, status: 0, text: '', error: 'ERR_CONNECTION_TIMED_OUT: соединение с сайтом не установилось' },
  [SHOP]: { url: SHOP, status: 200, text: '<html><head><title>Сыр лёгкий 200 г</title><meta property="og:title" content="Сыр лёгкий 200 г"><meta property="og:description" content="Полутвёрдый сыр &amp; ничего лишнего"><meta property="og:image" content="/img/cheese.jpg"><link rel="icon" href="/favicon-32.png"></head></html>' },
  ['https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(VIDEO)]: { url: 'x', status: 200, text: JSON.stringify({ title: 'Тестовое видео', author_name: 'Тестовый канал', thumbnail_url: 'https://i.ytimg.com/vi/flinttest01/hqdefault.jpg' }) },
  [VIDEO]: { url: VIDEO, status: 200, text: '<html><script>var x={"shortDescription":"Первая строка\\nВторая строка","ownerChannelName":"Тестовый канал"}</script></html>' },
}

export async function run(t) {
  const { page, ok, wait } = t
  const asked = []
  await page.exposeFunction('__fetchPage', async (address) => {
    asked.push(address)
    // A slow app: the answer comes after the server's.
    if (address === WIN_SLOW) await new Promise((resolve) => setTimeout(resolve, 7000))
    return JSON.stringify(PAGES[address] ?? null)
  })
  // The server's side, as the page sees it: quick for one address, hanging for another, its own (real) answer for the rest.
  await page.route('**/api/unfurl*', async (route) => {
    const address = new URL(route.request().url()).searchParams.get('url')
    if (address === WIN_SLOW) return route.fulfill({ json: { url: WIN_SLOW, title: 'From the server', description: 'Server was quick', image: '', favicon: '' } })
    if (address === SRV_SLOW) {
      await new Promise((resolve) => setTimeout(resolve, 8000))
      return route.fulfill({ json: { url: SRV_SLOW, title: 'Too late', description: '', image: '', favicon: '' } }).catch(() => {})
    }
    return route.continue()
  })
  await page.addInitScript(() => {
    const none = () => {}
    window.flintDesktop = {
      fetchPage: async (address) => JSON.parse(await window.__fetchPage(address)),
      setTitleBarColors: none,
      onFlush: none,
      onCommand: none,
      setReminders: none,
      onReminderClick: () => none,
      onReminderTick: () => none,
      show: none,
      quit: none,
      autostart: async () => ({ enabled: false }),
      setAutostart: async () => ({ enabled: false }),
      updates: async () => ({ supported: false, enabled: false }),
      setUpdates: async () => ({ supported: false, enabled: false }),
      checkUpdates: async () => ({ supported: false, enabled: false, result: '' }),
      installUpdate: async () => false,
    }
  })
  await page.reload()
  await page.waitForFunction(() => window.app?.metadata)

  await t.open('Shop')
  for (let i = 0; i < 40 && !t.read('Shop.md').includes('Сыр лёгкий'); i++) await wait(250)
  const shop = t.read('Shop.md')
  ok('a card of a site the server cannot reach is filled in from the page the desktop app fetched', shop.includes('title: "Сыр лёгкий 200 г"') && shop.includes('description: "Полутвёрдый сыр & ничего лишнего"'), shop)
  ok('its picture and icon are read as the page names them, made whole by the page\'s address', shop.includes('image: "http://flint-shop.invalid/img/cheese.jpg"') && shop.includes('favicon: "http://flint-shop.invalid/favicon-32.png"'), shop)

  await t.open('Video')
  for (let i = 0; i < 60 && !t.read('Video.md').includes('Первая строка'); i++) await wait(250)
  const video = t.read('Video.md')
  ok('a video card has its title and channel, and the description under the video from the page the desktop app fetched', video.includes('title: "Тестовое видео"') && video.includes('description: "Первая строка Вторая строка"'), video)
  ok('the app was asked for each page, the video\'s oEmbed answer and its page among them', asked.includes(SHOP) && asked.includes(VIDEO) && asked.some((a) => a.includes('/oembed')), asked.join('\n'))

  // Both are asked at once and the first card wins: neither waits for the other's timeout.
  let began = Date.now()
  await t.open('WinSlow')
  for (let i = 0; i < 24 && !t.read('WinSlow.md').includes('From the server'); i++) await wait(250)
  ok('a slow app does not hold up a card the server already has', t.read('WinSlow.md').includes('title: "From the server"') && Date.now() - began < 5500, `${Date.now() - began} ms\n${t.read('WinSlow.md')}`)
  began = Date.now()
  await t.open('SrvSlow')
  for (let i = 0; i < 24 && !t.read('SrvSlow.md').includes('From the app'); i++) await wait(250)
  ok('a server that hangs does not hold up the card the app already has', t.read('SrvSlow.md').includes('title: "From the app"') && Date.now() - began < 5500, `${Date.now() - began} ms\n${t.read('SrvSlow.md')}`)
  // When neither gets the page, the notice says what each met.
  await t.open('Neither')
  let notice = ''
  for (let i = 0; i < 40 && !/Окно приложения/.test(notice); i++) {
    await wait(250)
    notice = (await page.locator('.notice').allInnerTexts()).join('\n')
  }
  ok('when neither can get the page, the notice tells what the app met and what the server did', /Окно приложения: ERR_CONNECTION_TIMED_OUT/.test(notice) && /flint-neither\.invalid/.test(notice), notice)
}
