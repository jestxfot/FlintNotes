import { Plugin } from '../../api'
import { propertiesForm } from './form'
import './style.css'

export default class Properties extends Plugin {
  onload() {
    this.registerBlockRenderer('Frontmatter', propertiesForm)

    this.addCommand({
      id: 'add',
      name: 'Добавить свойства в заметку',
      callback: () => {
        const editor = this.app.workspace.activeEditor
        if (!editor) return
        if (editor.state.doc.line(1).text.trimEnd() === '---') {
          this.app.notice('В этой заметке уже есть блок свойств')
          return
        }
        const br = editor.state.lineBreak
        const block = `---${br}свойство: ${br}---${br}`
        // The cursor goes below the block, so the block shows as a form at once.
        editor.dispatch({ changes: { from: 0, insert: block }, selection: { anchor: block.length + editor.state.selection.main.head } })
      },
    })
  }
}
