// Animated pictures made by the server (/api/thumb, animated and still): the page downloads a small WebP at the shown size,
// not the GIF, and the copy is made once and kept on the server.
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
  const asked = []
  page.on('request', (request) => request.url().includes('/api/thumb') && asked.push(request.url()))
  await t.open('Gif')
  const small = page.locator(`${t.leaf} img[style*="160px"]`)
  const large = page.locator(`${t.leaf} img:not([style*="160px"])`)
  /** What a picture shows: its address, how wide it is shown, and how many frames the shown file has. */
  const look = (img) =>
    img.evaluate(async (el) => {
      const blob = await (await fetch(el.src)).blob()
      const decoder = new ImageDecoder({ data: blob.stream(), type: blob.type || 'image/gif' })
      await decoder.tracks.ready
      return { src: el.src, shown: Math.round(el.getBoundingClientRect().width), frames: decoder.tracks.selectedTrack.frameCount, natural: el.naturalWidth, type: blob.type, bytes: blob.size }
    })
  await page.waitForFunction(() => document.querySelector('.leaf:not([hidden]) img[style*="160px"]')?.src.includes('/api/thumb'), null, { timeout: 15000 }).catch(() => {})
  await wait(300)
  let a = await look(small)
  ok('a GIF shown smaller than it is plays from the server\'s copy: a WebP with all its frames, in the room it had', a.src.includes('animated=1') && a.type === 'image/webp' && a.frames === 12 && a.shown === 160 && a.natural === 240, JSON.stringify(a))
  let b = await look(large)
  ok('a GIF shown as large as it is plays as it is', !b.src.includes('/api/thumb') && b.type === 'image/gif' && b.shown === 640 && b.frames === 12, JSON.stringify(b))
  ok('and the page made no copies itself (no blob pictures)', !a.src.startsWith('blob:') && !b.src.startsWith('blob:'))

  await page.evaluate(() => app.commands.run('animations:toggle'))
  await wait(500)
  a = await look(small)
  b = await look(large)
  ok('the command stops both on their first frame (the server\'s still copy for the small one)', a.frames === 1 && a.src.includes('still=1') && b.frames === 1, JSON.stringify([a, b]))
  await page.evaluate(() => app.commands.run('animations:toggle'))
  await wait(500)
  a = await look(small)
  ok('and given again, plays them again', a.frames === 12 && a.src.includes('animated=1'), JSON.stringify(a))

  // The copy is made once: the same address, answered from the server\'s disk the next time.
  const first = await page.evaluate(async (src) => ({ a: (await (await fetch(src, { cache: 'no-store' })).arrayBuffer()).byteLength, b: (await (await fetch(src, { cache: 'no-store' })).arrayBuffer()).byteLength }), a.src)
  ok('asked again, the server gives the same copy', first.a === first.b && first.a === a.bytes, JSON.stringify([first, a.bytes]))
  ok('the note itself is untouched', t.read('Gif.md') === NOTE)
  ok('the page asked the server for it, once per kind', asked.some((url) => url.includes('animated=1')) && asked.some((url) => url.includes('still=1')), asked.join('\n'))
}
