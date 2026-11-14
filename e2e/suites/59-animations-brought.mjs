// A GIF of the web that the server cannot get to (here: a name it cannot resolve) but this computer can: the desktop app fetches it,
// the server keeps it and makes the light copy from it, and the page plays that, like any other.
import { fixture } from '../helpers.mjs'

const ADDRESS = 'http://flint-brought.invalid/anim.gif'
const NOTE = `<div><img style="width: 160px" src="${ADDRESS}"></div>\n`
export const viewport = { width: 1400, height: 1000 }
// The server cannot resolve the name: the browser asked for it, and the picture's own request is answered by this suite.
export const expectsNetworkErrors = /ERR_NAME_NOT_RESOLVED|status of (400|502)/
export const vault = {
  plugins: ['animations'],
  settings: { core: { readableWidth: false } },
  files: { 'Gif.md': NOTE },
}

export async function run(t) {
  const { page, ok, wait } = t
  const gif = fixture('anim.gif')
  await page.route('http://flint-brought.invalid/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: gif }))
  // The desktop app as far as the page can tell: a bridge that fetches pictures over its own connection.
  const fetched = []
  await page.exposeFunction('__fetchBytes', (address) => (fetched.push(address), gif.toString('base64')))
  await page.addInitScript(() => {
    const none = () => {}
    window.flintDesktop = {
      fetchBytes: async (address) => {
        const bin = atob(await window.__fetchBytes(address))
        return { type: 'image/gif', bytes: Uint8Array.from(bin, (c) => c.charCodeAt(0)) }
      },
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
  await t.open('Gif')
  const small = page.locator(`${t.leaf} img[style*="160px"]`)
  await page.waitForFunction(() => document.querySelector('.leaf:not([hidden]) img[style*="160px"]')?.src.includes('/api/thumb'), null, { timeout: 20000 }).catch(() => {})
  await wait(300)
  const src = await small.evaluate((img) => img.src)
  const look = await small.evaluate(async (el) => {
    const blob = await (await fetch(el.src)).blob()
    const decoder = new ImageDecoder({ data: blob.stream(), type: blob.type })
    await decoder.tracks.ready
    return { frames: decoder.tracks.selectedTrack.frameCount, type: blob.type, bytes: blob.size }
  })
  ok('the desktop app was asked to fetch the GIF the server could not', fetched.length === 1 && fetched[0] === ADDRESS, JSON.stringify(fetched))
  ok('the page then plays the server\'s light copy: a WebP with all the frames', src.includes('animated=1') && look.type === 'image/webp' && look.frames === 12, JSON.stringify({ src, look }))
  ok('a second ask for the same GIF does not carry it again', (await page.evaluate(() => document.images.length)) >= 1 && fetched.length === 1)
  ok('the note itself is untouched', t.read('Gif.md') === NOTE)
}
