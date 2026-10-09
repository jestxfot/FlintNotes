import { errorMessage, openLink, path as paths, Plugin, type App, type CodeBlockProcessor } from '../../api'
import type { TemplatesService } from '../templates'
import './style.css'

type Options = Record<string, string>

/** Every line is a key, a space and the value: `name Open`, `type command`. */
function parseOptions(source: string): Options {
  const options: Options = {}
  for (const line of source.split('\n')) {
    const m = /^\s*(\S+)\s+(.*)$/.exec(line)
    if (m) options[m[1].toLowerCase()] = m[2].trim()
  }
  return options
}

/** Zero-based numbers of the lines of the ```button block with this text: its fences and what is between. */
function locate(lines: string[], source: string): { from: number; to: number } | null {
  const wanted = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(`{3,}|~{3,})button\s*$/.test(lines[i])) continue
    if (wanted.every((line, n) => lines[i + 1 + n] === line) && /^\s*(`{3,}|~{3,})\s*$/.test(lines[i + 1 + wanted.length] ?? '')) {
      return { from: i, to: i + 1 + wanted.length }
    }
  }
  return null
}

/** Changes the lines of a note: through its editor if the note is open, so that nothing typed is lost. */
async function editNote(app: App, path: string, change: (lines: string[]) => string[] | void): Promise<void> {
  const editor = app.workspace.leaves.find((leaf) => leaf.path === path)?.view?.editor
  const before = editor ? editor.state.doc.toString() : await app.vault.read(path)
  const lines = before.split('\n')
  const after = (change(lines) ?? lines).join('\n')
  if (after === before) return
  if (!editor) return void (await app.vault.write(path, after))
  // Only the part that differs is replaced, so the cursor and the scroll position stay.
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  editor.dispatch({ changes: { from: start, to: before.length - end, insert: after.slice(start, after.length - end) } })
}

/** `2 + $3 * 2`: `$3` is the first number on line 3 of the note. */
function calculate(formula: string, lines: string[]): string {
  const filled = formula.replace(/\$(\d+)/g, (_, n: string) => /-?\d+(?:\.\d+)?/.exec(lines[Number(n) - 1] ?? '')?.[0] ?? '0')
  if (!/^[\d\s+\-*/().%]+$/.test(filled)) throw new Error('в формуле могут быть числа, скобки и + − * / %')
  return String(new Function(`return (${filled})`)())
}

/**
 * ```button
 * name Открыть сайт
 * type link
 * action https://example.com
 * color blue
 * ```
 * Types: `command`, `link`, `copy`, `calculate`, and `append` / `prepend` /
 * `line(5)` / `note(Name)` followed by `text` or `template`.
 */
export default class Buttons extends Plugin {
  onload() {
    const { app } = this
    this.addSettings([
      {
        key: 'webHome',
        name: 'Страница для кнопок «Web viewer»',
        desc: 'Кнопка с командой Obsidian «Web viewer: Open web viewer» открывает эту страницу в новой вкладке браузера',
        type: 'text',
        default: 'https://www.google.com',
      },
    ])

    /** The text a button inserts: the action itself, or a filled-in template. */
    const content = async (kind: string, action: string, target: string): Promise<{ text: string; target: string; done?: () => Promise<void> }> => {
      if (kind === 'text') return { text: action, target }
      const templates = app.services.get<TemplatesService>('templates')
      if (!templates) throw new Error('для шаблонов включите плагин «Шаблоны»')
      const template = templates.resolve(action)
      if (!template) throw new Error(`шаблон «${action}» не найден`)
      return templates.render(template, target)
    }

    const run = async (options: Options, path: string, source: string) => {
      const type = (options.type ?? '').toLowerCase()
      const action = options.action ?? ''
      // Run on the type as written: the name of the note keeps its capitals.
      const place = /^(append|prepend|line\((\d+)\)|note\(([^,)]+)(?:,\s*[^)]*)?\))\s+(text|template)$/i.exec((options.type ?? '').trim())

      if (type === 'command') {
        // Obsidian writes the command's name here; commands are matched by theirs.
        const wanted = action.toLowerCase()
        const command = app.commands.list().find((c) => c.name.toLowerCase() === wanted || c.id.toLowerCase() === wanted)
        if (command) await command.callback()
        // Obsidian's built-in browser has no twin here; its button opens the page in a browser tab.
        else if (wanted === 'web viewer: open web viewer') window.open(this.getSetting<string>('webHome') || 'about:blank', '_blank', 'noopener')
        else throw new Error(`команда «${action}» есть только в Obsidian`)
      } else if (type === 'link') {
        openLink(app, action, path)
      } else if (type === 'copy') {
        await navigator.clipboard.writeText(action)
        app.notice('Скопировано')
      } else if (type === 'calculate') {
        await editNote(app, path, (lines) => {
          const block = locate(lines, source)
          lines.splice(block ? block.to + 1 : lines.length, 0, `Результат: ${calculate(action, lines)}`)
        })
      } else if (place?.[3]) {
        const name = paths.normalize(place[3].trim())
        const made = await content(place[4].toLowerCase(), action, paths.extname(name) ? name : `${name}.md`)
        if (!app.vault.get(made.target)) await app.vault.create(made.target, made.text)
        await made.done?.()
        app.workspace.openFile(made.target)
      } else if (place) {
        const made = await content(place[4].toLowerCase(), action, path)
        await editNote(app, path, (lines) => {
          const block = locate(lines, source)
          const at = place[2] ? Math.min(lines.length, Math.max(0, Number(place[2]) - 1)) : !block ? lines.length : place[1].toLowerCase() === 'prepend' ? block.from : block.to + 1
          lines.splice(at, 0, ...made.text.split('\n'))
        })
      } else {
        throw new Error(`тип «${options.type ?? ''}» не поддерживается`)
      }

      // `replace [2,4]` clears those lines after the click; `remove true` takes the button itself away.
      const replace = /^\[\s*(\d+)\s*,\s*(\d+)\s*\]$/.exec(options.replace ?? '')
      if (replace || options.remove === 'true') {
        await editNote(app, path, (lines) => {
          if (options.remove === 'true') {
            const block = locate(lines, source)
            if (block) lines.splice(block.from, block.to - block.from + 1)
          }
          if (replace) lines.splice(Number(replace[1]) - 1, Number(replace[2]) - Number(replace[1]) + 1)
        })
      }
    }

    const processor: CodeBlockProcessor = (source, el, { path }) => {
      el.classList.add('button-block')
      let current = source
      const button = el.appendChild(document.createElement('button'))
      const draw = (text: string) => {
        current = text
        const options = parseOptions(text)
        button.className = ['button-default', options.color, options.class].filter(Boolean).join(' ')
        button.textContent = options.name || 'Кнопка'
        button.style.background = options.customcolor ?? ''
        button.style.color = options.customtextcolor ?? ''
        button.title = [options.type, options.action].filter(Boolean).join(': ')
      }
      draw(source)
      button.onclick = () => {
        run(parseOptions(current), path, current).catch((err) => app.notice(`Кнопка «${button.textContent}»: ${errorMessage(err)}`))
      }
      return { update: draw }
    }
    this.registerCodeBlockProcessor('button', processor)
  }
}
