// Builds a self-contained copy of the app into `release/`:
//   release/launcher.mjs   keeps the server running and puts new builds in place (see server/launcher.ts)
//   release/server.mjs     the server with all its libraries in one file
//   release/public/        the app for the browser
//   release/desktop.mjs    the desktop app's main process (see desktop/main.ts), with preload.cjs and icons/
//   release/build.json     which build this is; written last, it tells the running app (or launcher) the build is complete
// On Windows the app (npm run installer) runs it; in a browser it needs Node.js only, no `npm install`: node release/launcher.mjs
import { build as bundle } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { build as buildApp } from 'vite'

// FLINT_RELEASE_OUT builds elsewhere, e.g. over a copy, to see a running launcher take the new build.
const OUT = process.env.FLINT_RELEASE_OUT ?? 'release'
const id = new Date().toISOString()
// The page carries the same id (vite.config.ts), to see that it comes from an older build than the server.
process.env.FLINT_BUILD = id

let previous = []
try {
  previous = JSON.parse(fs.readFileSync(path.join(OUT, 'build.json'), 'utf8')).files ?? []
} catch {}

// The folder is not emptied: a page still open from the previous build may yet ask for its parts,
// until it reloads itself. Files of the builds before that are removed below.
const result = await buildApp({ build: { outDir: `${OUT}/public`, emptyOutDir: false }, logLevel: 'warn' })
const files = [result].flat().flatMap((output) => output.output.map((file) => file.fileName))
const keep = new Set([...files, ...previous])
const assets = path.join(OUT, 'public', 'assets')
for (const name of fs.existsSync(assets) ? fs.readdirSync(assets) : []) {
  if (!keep.has(`assets/${name}`)) fs.rmSync(path.join(assets, name), { recursive: true, force: true })
}

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Some libraries still call require(), which an ES module does not have by itself.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
}
await bundle({ ...common, entryPoints: ['server/index.ts'], outfile: `${OUT}/server.mjs` })
await bundle({ ...common, entryPoints: ['server/launcher.ts'], outfile: `${OUT}/launcher.mjs` })
// The desktop app's own parts: Electron gives them `electron`. Its preload runs in a sandbox, which only knows CommonJS.
await bundle({ ...common, entryPoints: ['desktop/main.ts'], outfile: `${OUT}/desktop.mjs`, external: ['electron'] })
await bundle({ ...common, banner: {}, format: 'cjs', entryPoints: ['desktop/preload.ts'], outfile: `${OUT}/preload.cjs`, external: ['electron'] })
fs.cpSync('desktop/icons', path.join(OUT, 'icons'), { recursive: true })
// The desktop app's sandbox: a vault of examples, made anew from this at every start.
fs.rmSync(path.join(OUT, 'sandbox'), { recursive: true, force: true })
fs.cpSync('desktop/sandbox', path.join(OUT, 'sandbox'), { recursive: true })
fs.writeFileSync(path.join(OUT, 'build.json'), JSON.stringify({ id, files }, null, 2))

console.log('Готово: release/ (приложение FlintNotes подхватит сборку само; в браузере — node release/launcher.mjs)')
