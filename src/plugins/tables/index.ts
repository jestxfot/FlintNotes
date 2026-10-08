import { Plugin, type CodeBlockProcessor } from '../../api'
import './style.css'
import { TableWidget } from './widget'

const PLAIN = `| Столбец 1 | Столбец 2 |
| --------- | --------- |
|           |           |
|           |           |`

const EXTENDED = `\`\`\`table
| Товар      | Цена {number} | Кол-во {number} | Сумма {number} | Готово {checkbox} |
| ---------- | ------------- | --------------- | -------------- | ----------------- |
| Клавиатура | 3500          | 2               | =B1*C1         | x                 |
| Мышь       | 1200          | 1               | =B2*C2         |                   |
| Итого      | <             | <               | =sum(D1:D2)    |                   |
\`\`\``

const processor =
  (extended: boolean): CodeBlockProcessor =>
  (source, el, ctx) =>
    new TableWidget(el, { app: ctx.app, path: ctx.path, extended, setSource: ctx.setSource }, source)

export default class Tables extends Plugin {
  onload() {
    // Ordinary Markdown tables stay ordinary text; they only get a table editor.
    this.registerBlockRenderer('Table', processor(false))
    // A ```table block is the same table with formulas, column types and merged cells.
    this.registerCodeBlockProcessor('table', processor(true))

    const insert = (text: string) => {
      const editor = this.app.workspace.activeEditor
      if (!editor) {
        this.app.notice('Откройте заметку, чтобы вставить таблицу')
        return
      }
      const { doc } = editor.state
      const line = doc.lineAt(editor.state.selection.main.head)
      const br = editor.state.lineBreak
      // A table is only recognised after an empty line; the cursor ends up below it.
      const above = line.number > 1 ? doc.line(line.number - 1).text.trim() : ''
      const gap = line.text.trim() ? br + br : above ? br : ''
      const block = gap + text.replace(/\n/g, br) + br + br
      const at = line.text.trim() ? line.to : line.from
      editor.dispatch({ changes: { from: at, to: line.to, insert: block }, selection: { anchor: at + block.length } })
      editor.focus()
    }
    this.addCommand({ id: 'insert', name: 'Вставить таблицу', callback: () => insert(PLAIN) })
    this.addCommand({
      id: 'insert-extended',
      name: 'Вставить расширенную таблицу (формулы, типы, объединение)',
      callback: () => insert(EXTENDED),
    })
  }
}
