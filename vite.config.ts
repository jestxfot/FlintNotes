import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// Windows drives mounted into WSL deliver no file events, so fall back to polling there.
const onWindowsDrive = /^\/mnt\/[a-z]\//.test(`${process.cwd()}/`)

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4600' },
    watch: onWindowsDrive ? { usePolling: true, interval: 500 } : undefined,
  },
  build: { target: 'es2022' },
  // Which build the page belongs to; `npm run release` names it, otherwise `dev` (see scripts/release.mjs).
  define: { __FLINT_BUILD__: JSON.stringify(process.env.FLINT_BUILD ?? 'dev') },
})
