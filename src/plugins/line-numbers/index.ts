import { cm, Plugin } from '../../api'

export default class LineNumbers extends Plugin {
  onload() {
    this.registerEditorExtension(cm.view.lineNumbers())
  }
}
