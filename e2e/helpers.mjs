import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** A binary test file from `e2e/fixtures`, to put into a suite's vault. */
export const fixture = (name) => fs.readFileSync(path.join(ROOT, 'e2e/fixtures', name))

const pad = (n) => String(n).padStart(2, '0')

/** Today's date shifted by `offset` days, as `YYYY-MM-DD`. */
export function day(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A vault plugin that draws ```counter blocks as a number with a +1 button. */
export const COUNTER_PLUGIN = {
  'manifest.json': JSON.stringify({ name: 'Counter' }),
  'main.js': `export default class Counter extends flint.Plugin {
  onload() {
    this.registerCodeBlockProcessor('counter', (source, el, ctx) => {
      const label = el.appendChild(document.createElement('span'))
      const btn = el.appendChild(document.createElement('button')); btn.textContent = '+1'; btn.className = 'inc'
      let value = 0
      const show = (s) => { value = Number(s.trim()) || 0; label.textContent = 'count: ' + value + ' ' }
      show(source)
      btn.onclick = () => ctx.setSource(String(value + 1))
      return { update: show }
    })
  }
}`,
}

/** Writes a suite's vault: its files, enabled plugins, settings and vault plugins. */
export function buildVault(dir, { files = {}, plugins = [], settings = {}, externalPlugins = {} }) {
  const write = (file, content) => {
    const target = path.join(dir, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  for (const [file, content] of Object.entries(files)) write(file, content)
  write('.flint/settings.json', JSON.stringify({ core: { enabledPlugins: plugins }, ...settings }))
  for (const [id, parts] of Object.entries(externalPlugins)) {
    for (const [file, content] of Object.entries(parts)) write(`.flint/plugins/${id}/${file}`, content)
  }
}

/** What a suite's `run` receives: the page, the vault on disk and shortcuts for common steps. */
export function tools(page, vault, results) {
  const leaf = '.leaf:not([hidden])'
  const t = {
    page,
    vault,
    leaf,
    /** Records a check. `extra` is shown when it fails. */
    ok(name, cond, extra = '') {
      results.push({ name, pass: !!cond, extra: cond ? '' : String(extra).slice(0, 500) })
    },
    read: (file) => fs.readFileSync(path.join(vault, file), 'utf8'),
    write: (file, text) => fs.writeFileSync(path.join(vault, file), text),
    exists: (file) => fs.existsSync(path.join(vault, file)),
    wait: (ms) => page.waitForTimeout(ms),
    count: (selector) => page.locator(selector).count(),
    /** The file tree row with exactly this name (a folder's row starts with its arrow). */
    row: (name) => page.locator('.row', { hasText: new RegExp(`^\\s*›?\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
    tab: (name) => page.locator('.tab-title', { hasText: new RegExp(`^${name}$`) }),
    activeTab: () => page.locator('.tab.active .tab-title').innerText(),
    /** Text of the open note as the editor shows it. */
    text: () => page.locator(`${leaf} .cm-content`).first().innerText(),
    /** Text of an element with all whitespace collapsed. */
    flat: async (locator) => (await locator.innerText()).replace(/\s+/g, ' '),
    /** Moves the cursor to the end of the note, so nothing above is "under the cursor". */
    cursorToEnd: () =>
      page.evaluate(() => {
        const editor = app.workspace.activeEditor
        editor.dispatch({ selection: { anchor: editor.state.doc.length } })
        editor.focus()
      }),
    /** Opens a note from the file tree and waits for its editor. */
    async open(name) {
      await t.row(name).click()
      await page.waitForSelector(`${leaf} .cm-content`)
      await t.cursorToEnd()
      await t.wait(800)
    },
  }
  return t
}
