// Draws the desktop app's icons from public/favicon.svg into desktop/icons/ (kept in git, so the
// release needs no browser): flintnotes.ico for Windows (the program, its shortcuts, the tray),
// flintnotes.png for the window elsewhere, tray.png for the tray elsewhere.
// Run again after the logo changes: node scripts/make-icons.mjs
// (in WSL with FLINT_E2E_BROWSER pointing at Playwright's chrome-headless-shell, as for the tests).
import fs from 'node:fs'
import { chromium } from 'playwright'

const OUT = 'desktop/icons'
const svg = fs.readFileSync('public/favicon.svg', 'utf8')
const browser = await chromium.launch(process.env.FLINT_E2E_BROWSER ? { executablePath: process.env.FLINT_E2E_BROWSER } : {})
const page = await browser.newPage()

async function draw(size) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`)
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

/** An .ico of PNG images, which Windows reads since Vista. */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, at)
    head.writeUInt8(size >= 256 ? 0 : size, at + 1)
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(png.length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([head, ...images.map(({ png }) => png)])
}

fs.mkdirSync(OUT, { recursive: true })
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const images = []
for (const size of sizes) images.push({ size, png: await draw(size) })
fs.writeFileSync(`${OUT}/flintnotes.ico`, ico(images))
fs.writeFileSync(`${OUT}/flintnotes.png`, images.find(({ size }) => size === 256).png)
fs.writeFileSync(`${OUT}/tray.png`, images.find(({ size }) => size === 32).png)
await browser.close()
console.log(`Значки: ${OUT}/flintnotes.ico, flintnotes.png, tray.png`)
