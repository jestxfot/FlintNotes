// Animated pictures: a GIF shown smaller than it is plays from a copy at its shown size, and GIFs stop
// on their first frame while the window is not focused or when the command asks.
import { fixture } from '../helpers.mjs'

const NOTE = '<div><img style="width: 160px" src="anim.gif"></div>\n\nText between.\n\n<img src="anim.gif">\n'
export const viewport = { width: 1400, height: 1000 }
export const vault = {
  plugins: ['animations'],
  settings: { core: { readableWidth: false } },
  files: { 'anim.gif': fixture('anim.gif'), 'Gif.md': NOTE },
}

export async function run(t) {
  const { page, ok, wait } = t
  await t.open('Gif')
  const small = page.locator(`${t.leaf} img[style*="160px"]`)
  const large = page.locator(`${t.leaf} img:not([style*="160px"])`)
  /** What a picture shows: its address, how wide it is shown, and how many frames and pixels the shown file has. */
  const look = (img) =>
    img.evaluate(async (el) => {
      const blob = await (await fetch(el.src)).blob()
      const decoder = new ImageDecoder({ data: blob.stream(), type: blob.type || 'image/gif' })
      await decoder.tracks.ready
      return { src: el.src, shown: Math.round(el.getBoundingClientRect().width), frames: decoder.tracks.selectedTrack.frameCount, natural: el.naturalWidth, type: blob.type }
    })
  await page.waitForFunction(() => document.querySelector('.leaf:not([hidden]) img[style*="160px"]')?.src.startsWith('blob:'), null, { timeout: 15000 }).catch(() => {})
  await wait(300)
  let a = await look(small)
  ok('a GIF shown smaller than it is plays from a copy of its shown size, all its frames kept', a.src.startsWith('blob:') && a.type === 'image/png' && a.frames === 12 && a.natural === 192, JSON.stringify(a))
  ok('and it takes as much room on the page as before', a.shown === 160, JSON.stringify(a))
  let b = await look(large)
  ok('a GIF shown as large as it is plays as it is', !b.src.startsWith('blob:') && b.shown === 640 && b.frames === 12, JSON.stringify(b))

  await page.evaluate(() => app.commands.run('animations:toggle'))
  await wait(400)
  a = await look(small)
  b = await look(large)
  ok('the command stops both on their first frame, in the same room', a.frames === 1 && b.frames === 1 && a.shown === 160 && b.shown === 640, JSON.stringify([a, b]))
  await page.evaluate(() => app.commands.run('animations:toggle'))
  await wait(400)
  a = await look(small)
  b = await look(large)
  ok('and given again, plays them again', a.frames === 12 && a.natural === 192 && !b.src.startsWith('blob:'), JSON.stringify([a, b]))

  // The window loses the focus (another program is worked in), then gets it back.
  await page.evaluate(() => {
    document.hasFocus = () => false
    window.dispatchEvent(new Event('blur'))
  })
  await wait(400)
  a = await look(small)
  b = await look(large)
  ok('while the window is not focused, GIFs stand still', a.frames === 1 && b.frames === 1, JSON.stringify([a, b]))
  await page.evaluate(() => {
    delete document.hasFocus
    window.dispatchEvent(new Event('focus'))
  })
  await wait(400)
  a = await look(small)
  ok('and play when it is focused again', a.frames === 12, JSON.stringify(a))

  await page.evaluate(() => app.settings.set('animations', 'pauseUnfocused', false))
  await page.evaluate(() => {
    document.hasFocus = () => false
    window.dispatchEvent(new Event('blur'))
  })
  await wait(400)
  a = await look(small)
  ok('with that setting off, they play on', a.frames === 12, JSON.stringify(a))
  await page.evaluate(() => {
    delete document.hasFocus
    app.settings.set('animations', 'pauseUnfocused', true)
  })

  ok('the note itself is untouched', t.read('Gif.md') === NOTE, t.read('Gif.md'))
  const kept = await page.evaluate(async () => (await (await caches.open('flint-animations')).keys()).map((r) => r.url.split('/').pop()).sort())
  ok('the copies are kept for the next run', kept.includes('light') && kept.includes('still') && kept.includes('info'), kept.join())

  await page.evaluate(() => app.plugins.disable('animations'))
  await wait(300)
  a = await look(small)
  ok('turned off, the plugin gives every picture its own GIF back', !a.src.startsWith('blob:') && a.frames === 12 && a.shown === 160, JSON.stringify(a))
}
