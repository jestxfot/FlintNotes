// Builds a self-contained copy of the app into `release/`:
//   release/server.mjs   the server with all its libraries in one file
//   release/public/      the app for the browser
// Running it needs Node.js only, no `npm install`: node release/server.mjs
import { build as bundle } from 'esbuild'
import { build as buildApp } from 'vite'

await buildApp({ build: { outDir: 'release/public', emptyOutDir: true }, logLevel: 'warn' })
await bundle({
  entryPoints: ['server/index.ts'],
  outfile: 'release/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Some libraries still call require(), which an ES module does not have by itself.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
})
console.log('Готово: release/ (запуск: node release/server.mjs или FlintNotes.bat)')
