// A note does not jump while its pictures and blocks arrive: room is kept for them first (src/core/sizes.ts).
import sharp from 'sharp'

const PNG = (width, height) => sharp({ create: { width, height, channels: 3, background: { r: 30, g: 110, b: 190 } } }).png().toBuffer()

export const vault = {
  plugins: ['links'],
  files: {
    'Start.md': 'Start\n',
    // A picture of the vault in the text, one in a block of HTML with a width and no height, and a picture of the web the same way.
    'Pictures.md': ['# Pictures', '', 'Before.', '', '![](wide.png)', '', '<div>', '<img src="tall.png" style="width: 50%">', '<img src="https://pictures.test/web.png" style="width: 40%">', '</div>', '', 'After.', ''].join('\n'),
    'wide.png': await PNG(800, 200),
    'tall.png': await PNG(300, 600),
    'fake.png': 'not a picture',
  },
}

export async function run(t) {
  const { page, ok, leaf } = t
  // The picture of the web comes late, as over a real line.
  let release
  const web = await PNG(640, 360)
  await page.route('https://pictures.test/**', async (route) => {
    await new Promise((resolve) => (release = resolve))
    await route.fulfill({ status: 200, contentType: 'image/png', body: web })
  })
  // The vault's picture is slow too (a large file over a slow line), though the server's word about its size is not.
  await page.route('**/api/file?path=tall.png*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue()
  })
  await page.waitForFunction(() => window.app?.metadata)
  await page.evaluate(() => localStorage.removeItem('flint-sizes'))

  // ---- what the server says of the files of the vault
  const sizes = await page.evaluate(() => app.vault.imageSizes(['wide.png', 'tall.png', 'fake.png', 'missing.png', '../outside.png']))
  ok('the server tells the size of picture files from their headers, and leaves out what is not a picture, is missing, or is outside the vault', Object.keys(sizes).sort().join() === 'tall.png,wide.png' && sizes['wide.png'].join() === '800,200' && sizes['tall.png'].join() === '300,600', JSON.stringify(sizes))

  // ---- first sight: room is kept before the pictures arrive
  await t.open('Pictures')
  await page.waitForFunction(() => [...document.querySelectorAll('.leaf:not([hidden]) .cm-content img')].filter((img) => /png/.test(img.src)).length >= 3, null, { timeout: 15000 })
  // The server answers about the vault's pictures in a moment, much sooner than they would have loaded; the web picture is still held back.
  const reserved = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 400))
    return [...document.querySelectorAll('.leaf:not([hidden]) .cm-content img')].filter((img) => /png/.test(img.src)).map((img) => ({ src: decodeURIComponent(img.src).replace(/^.*path=/, '').replace(/&.*$/, ''), ratio: img.style.aspectRatio, height: Math.round(img.getBoundingClientRect().height), done: img.complete && img.naturalWidth > 0 }))
  })
  const tall = reserved.find((one) => one.src.startsWith('tall'))
  const webPicture = reserved.find((one) => one.src.includes('pictures.test'))
  ok('a picture of the vault written with a width and no height has the shape the server told it, from the start', tall?.ratio === '300 / 600', JSON.stringify(reserved))
  ok('a picture of the web with a width and no height has room for a frame while it is on its way', !!webPicture && !webPicture.done && /16 \/ 9/.test(webPicture.ratio) && webPicture.height > 50, JSON.stringify(reserved))

  // ---- it arrives, and what is below does not move more than the guess was off by
  release?.()
  await page.waitForFunction(() => [...document.querySelectorAll('.leaf:not([hidden]) .cm-content img')].filter((img) => /png/.test(img.src)).every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 15000 })
  // Written a couple of seconds after the last size is learnt (at once when the page is hidden or closed).
  await t.wait(2300)
  const known = await page.evaluate(() => JSON.parse(localStorage.getItem('flint-sizes') || '{}').images)
  ok('every picture that loads is remembered with its real size', Object.values(known ?? {}).some((size) => size[0] === 640 && size[1] === 360) && Object.values(known ?? {}).some((size) => size[0] === 300 && size[1] === 600), JSON.stringify(known))

  // ---- the next opening: the web picture has its real shape before it is fetched; the page does not move when it comes
  await page.reload()
  await page.waitForFunction(() => window.app?.metadata)
  await page.evaluate(() => {
    window.__shift = 0
    new PerformanceObserver((list) => list.getEntries().forEach((e) => !e.hadRecentInput && (window.__shift += e.value))).observe({ type: 'layout-shift' })
  })
  await t.open('Pictures')
  await page.waitForFunction(() => document.querySelectorAll('.leaf:not([hidden]) .cm-content img').length >= 2, null, { timeout: 15000 })
  const again = await page.evaluate(() => [...document.querySelectorAll('.leaf:not([hidden]) .cm-content img')].filter((img) => /png/.test(img.src)).map((img) => ({ src: img.src, ratio: img.style.aspectRatio })))
  ok('the next time, the web picture is given its real shape before it is fetched', again.some((one) => one.src.includes('pictures.test') && one.ratio === '640 / 360'), JSON.stringify(again))
  release?.()
  await page.waitForTimeout(800)
  await page.evaluate(() => (window.__shift = 0))
  await page.waitForTimeout(600)
  ok('nothing moves once the pictures are in', (await page.evaluate(() => window.__shift)) < 0.005)

  // ---- blocks: the editor is told how tall a block will be, and the block keeps that room while it fills
  const blocks = await page.evaluate(() => JSON.parse(localStorage.getItem('flint-sizes') || '{}').blocks ?? {})
  ok('a block drawn in the note has its height remembered once it has settled', Object.keys(blocks).length > 0 && Object.values(blocks).every((height) => height > 0), JSON.stringify(blocks))
}
