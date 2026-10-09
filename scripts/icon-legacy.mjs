// Lucide renames and redraws icons now and then (home -> house) and keeps the
// old ones under their old names. Obsidian and its plugins store whichever name
// was current when an icon was chosen, so the app must be able to draw the old
// ones too. This collects them from the installed lucide-static:
//   node scripts/icon-legacy.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'node_modules/lucide-static/dist/esm/icons')
const nodes = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/lucide-static/icon-nodes.json'), 'utf8'))

const legacy = {}
for (const file of fs.readdirSync(dir).sort()) {
  const name = file.slice(0, -3)
  if (!file.endsWith('.js') || name in nodes) continue
  const body = /<svg[^>]*>([\s\S]*?)<\/svg>/.exec(fs.readFileSync(path.join(dir, file), 'utf8'))?.[1]
  if (body) legacy[name] = body.replace(/\s*\n\s*/g, '').trim()
}
fs.writeFileSync(path.join(root, 'src/core/icon-legacy.json'), `${JSON.stringify(legacy, null, 1)}\n`)
console.log(`${Object.keys(legacy).length} legacy icons`)
