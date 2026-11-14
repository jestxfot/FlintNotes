// The outline of a note (shared/outline.ts) is read by the tasks list and the queries exactly as the note itself is:
//   node e2e/outline-check.mjs <folder with notes>      (read only; every .md below it)
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './helpers.mjs'

const folder = path.resolve(process.argv[2] ?? path.join(ROOT, 'examples'))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-outline-'))
fs.writeFileSync(path.join(dir, 'api-stub.ts'), `export { moment, Moment } from ${JSON.stringify(path.join(ROOT, 'src/core/moment'))}\nexport * as path from ${JSON.stringify(path.join(ROOT, 'src/core/path'))}\n`)
fs.writeFileSync(
  path.join(dir, 'entry.ts'),
  `export { outline } from ${JSON.stringify(path.join(ROOT, 'shared/outline'))}
export { parseTasks } from ${JSON.stringify(path.join(ROOT, 'src/plugins/tasks/due'))}
export { parseBody } from ${JSON.stringify(path.join(ROOT, 'src/plugins/dataview/pages'))}
export { parseMarkdown } from ${JSON.stringify(path.join(ROOT, 'src/core/parse-markdown'))}
`,
)
await build({
  entryPoints: [path.join(dir, 'entry.ts')],
  outfile: path.join(dir, 'entry.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'error',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{ name: 'api', setup: (b) => b.onResolve({ filter: /^\.\.\/\.\.\/api$/ }, () => ({ path: path.join(dir, 'api-stub.ts') })) }],
})
const { outline, parseTasks, parseBody, parseMarkdown } = await import(path.join(dir, 'entry.mjs'))

const files = []
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.md')) files.push(p)
  }
}
walk(folder)
let full = 0
let small = 0
const bad = []
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const mine = outline(text)
  full += text.length
  small += mine.length
  const meta = parseMarkdown(text)
  const read = (t) => {
    const plain = []
    const tasks = parseTasks('n.md', t, meta.headings, plain)
    return JSON.stringify([tasks, plain, parseBody('n.md', t)])
  }
  if (read(text) !== read(mine)) {
    bad.push(path.relative(folder, file))
    if (process.env.EXPLAIN && bad.length === 1) {
      const a = JSON.parse(read(text))
      const b = JSON.parse(read(mine))
      for (const [n, name] of [[0, 'tasks'], [1, 'plain'], [2, 'body']]) if (JSON.stringify(a[n]) !== JSON.stringify(b[n])) console.log(name, 'differs\n', JSON.stringify(a[n]).slice(0, 500), '\n', JSON.stringify(b[n]).slice(0, 500))
    }
  }
  if (mine.split('\n').length !== text.split('\n').length) bad.push(`${path.relative(folder, file)} (line count)`)
}
fs.rmSync(dir, { recursive: true, force: true })
console.log(`${files.length} notes, ${(full / 1e6).toFixed(1)} MB as text, ${(small / 1e6).toFixed(1)} MB as outline`)
if (bad.length) {
  console.log(`DIFFERENT for ${bad.length}:\n  ${bad.slice(0, 20).join('\n  ')}`)
  process.exit(1)
}
console.log('every note reads the same from its outline')
