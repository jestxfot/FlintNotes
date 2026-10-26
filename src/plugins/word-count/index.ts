import { cm, Plugin } from '../../api'

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

const plural = new Intl.PluralRules('ru')
const FORMS: Record<string, [string, string, string]> = {
  words: ['слово', 'слова', 'слов'],
  chars: ['символ', 'символа', 'символов'],
}

function count(n: number, unit: keyof typeof FORMS): string {
  const [one, few, many] = FORMS[unit]
  const rule = plural.select(n)
  return `${n} ${rule === 'one' ? one : rule === 'few' ? few : many}`
}

export default class WordCount extends Plugin {
  onload() {
    const item = this.addStatusBarItem()

    const render = () => {
      const editor = this.app.workspace.activeEditor
      if (!editor) {
        item.textContent = ''
        return
      }
      const text = editor.state.doc.toString()
      const parts = [count(text.match(WORD)?.length ?? 0, 'words')]
      if (this.getSetting<boolean>('characters')) parts.push(count(text.length, 'chars'))
      item.textContent = parts.join(' · ')
    }

    this.addSettings([
      { key: 'characters', name: 'Показывать число символов', desc: 'Рядом с числом слов в строке состояния', type: 'toggle', default: false },
    ])
    // Counting a long note takes a while; while typing goes on it is counted once, when the typing pauses.
    let later: ReturnType<typeof setTimeout> | undefined
    this.register(() => clearTimeout(later))
    this.registerEditorExtension(
      cm.view.EditorView.updateListener.of((update) => {
        if (!update.docChanged || update.view !== this.app.workspace.activeEditor) return
        clearTimeout(later)
        later = setTimeout(render, update.state.doc.length > 20_000 ? 400 : 120)
      }),
    )
    this.register(this.app.workspace.on('active-change', render))
    this.onSettingChange(render)
    render()
  }
}
