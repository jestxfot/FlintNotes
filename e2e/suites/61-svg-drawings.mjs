// An SVG in a note is shown as a picture the server drew from it (`/api/thumb?…&x=2`, a WebP at twice its own size), not as
// the SVG itself: the charts of an article (thousands of shapes, blur filters) cost the page's own thread a second and more
// each time the text around them was redrawn, and typing under one waited for it. Shown in the same place, at the same size;
// where the server cannot draw it, the SVG itself, as before.

/** A drawing heavy in the way the real ones are: many shapes, under blur filters. 600×400 of its own. */
function drawing() {
  const shapes = []
  for (let i = 0; i < 1500; i++) shapes.push(`<rect x="${(i * 37) % 580}" y="${(i * 53) % 380}" width="20" height="14" rx="3" fill="hsl(${i % 360},60%,60%)" filter="url(#f${i % 5})"/>`)
  const filters = [0, 1, 2, 3, 4].map((n) => `<filter id="f${n}"><feGaussianBlur stdDeviation="${n + 1}"/></filter>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><defs>${filters}</defs><rect width="600" height="400" fill="#fff"/>${shapes.join('')}</svg>`
}

const WEB = 'http://flint-drawing.invalid/chart.svg'
const NOTE = `Above.\n\n![chart.svg](chart.svg)\n\nBetween.\n\n![a chart of the web](${WEB})\n\nBelow.\n`
export const viewport = { width: 1400, height: 1000 }
// The server cannot resolve the web drawing's name: its copy fails (400 or 502) and the page shows the drawing itself, which this suite serves.
export const expectsNetworkErrors = /ERR_NAME_NOT_RESOLVED|status of (400|502)/
export const vault = {
  settings: { core: { readableWidth: false } },
  files: { 'chart.svg': drawing(), 'Charts.md': NOTE },
}

export async function run(t) {
  const { page, ok, wait } = t
  await page.route('http://flint-drawing.invalid/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: drawing() }))
  const asked = []
  page.on('request', (request) => request.url().includes('/api/thumb') && asked.push(request.url()))
  await t.open('Charts')
  const local = page.locator(`${t.leaf} img.lp-image[alt="chart.svg"]`)
  const web = page.locator(`${t.leaf} img.lp-image[alt="a chart of the web"]`)
  const look = (img) =>
    img.evaluate(async (el) => {
      const blob = el.currentSrc.startsWith('http') ? await (await fetch(el.currentSrc)).blob() : null
      const box = el.getBoundingClientRect()
      return { src: el.currentSrc, complete: el.complete, natural: [el.naturalWidth, el.naturalHeight], shown: [Math.round(box.width), Math.round(box.height)], type: blob?.type, bytes: blob?.size }
    })
  await page.waitForFunction(() => { const img = document.querySelector('.leaf:not([hidden]) img[alt="chart.svg"]'); return img?.complete && img.naturalWidth }, null, { timeout: 20000 }).catch(() => {})
  const a = await look(local)
  ok('an SVG of the vault is shown from the server\'s drawing of it: a WebP, twice its size', a.src.includes('/api/thumb') && a.src.includes('x=2') && a.type === 'image/webp', JSON.stringify(a))
  ok('in the place the SVG itself would take (its own 600×400)', a.natural[0] === 600 && a.natural[1] === 400 && a.shown[0] === 600 && a.shown[1] === 400, JSON.stringify(a))
  const pixels = await local.evaluate(async (el) => (await createImageBitmap(await (await fetch(el.currentSrc)).blob())).width)
  ok('drawn at twice its width, so it stays sharp on a dense screen', pixels === 1200, String(pixels))

  await page.waitForFunction(() => { const img = document.querySelector('.leaf:not([hidden]) img[alt="a chart of the web"]'); return img?.complete && img.naturalWidth && !img.currentSrc.includes('/api/thumb') }, null, { timeout: 20000 }).catch(() => {})
  const b = await look(web)
  ok('an SVG of the web the server cannot get to is shown as it is, as before', b.src === WEB && b.natural[0] === 600, JSON.stringify(b))
  ok('after the server was asked for its drawing', asked.some((url) => url.includes('url=') && url.includes('x=2')), asked.join('\n'))

  // Asked again: the same drawing, from the server's disk.
  const again = await page.evaluate(async (src) => (await (await fetch(src, { cache: 'no-store' })).arrayBuffer()).byteLength, a.src)
  ok('the drawing is made once and kept', again === a.bytes, `${again} ${a.bytes}`)

  // Typed under it: the picture stays (no new request), the note gets the text.
  const before = asked.length
  await page.locator(`${t.leaf} .cm-line`, { hasText: 'Below.' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' More')
  await wait(900)
  ok('typing under it changes the note, and the picture is not asked for again', t.read('Charts.md').includes('Below. More') && asked.length === before, `${asked.length - before} more`)
  ok('the note itself names the SVG, untouched', t.read('Charts.md').includes('![chart.svg](chart.svg)'))
}
