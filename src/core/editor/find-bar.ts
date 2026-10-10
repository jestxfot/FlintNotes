import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, SearchCursor, SearchQuery, searchPanelOpen, selectMatches, setSearchQuery } from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap, type Panel, type ViewUpdate } from '@codemirror/view'
import type { App } from '../app'

/** What was looked for, newest last: Up and Down in the field go through it. Shared by all notes. */
const history: string[] = []
const HISTORY = 30
/** Whether the bar about to be opened should show the "replace" row. */
let withReplace = false
/** The bars that are open, to change them from the keys. */
const bars = new WeakMap<EditorView, { showReplace(on: boolean): void; focus(): void }>()

function remember(text: string): void {
  if (!text.trim()) return
  const at = history.indexOf(text)
  if (at >= 0) history.splice(at, 1)
  history.push(text)
  if (history.length > HISTORY) history.shift()
}

/**
 * The bar for finding text in the open note, above the text as in Obsidian: a
 * field, the count of what was found, steps to the next and the previous one,
 * "select all found", and, on Ctrl+H, a second row to replace with.
 */
function findBar(app: App, view: EditorView): Panel {
  const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '') => {
    const node = parent.appendChild(document.createElement(tag))
    if (className) node.className = className
    return node
  }
  const dom = document.createElement('div')
  dom.className = 'find-bar'
  const row = el(dom, 'div', 'find-row')
  const box = el(row, 'div', 'find-field')
  box.append(app.icons.draw('lucide-search'))
  const field = el(box, 'input')
  field.placeholder = 'Найти…'
  field.setAttribute('aria-label', 'Найти в заметке')
  field.setAttribute('main-field', 'true')
  const count = el(box, 'span', 'find-count')
  const button = (parent: HTMLElement, icon: string, title: string, action: () => void, text = '') => {
    const node = el(parent, 'button', 'find-button')
    node.type = 'button'
    node.title = title
    node.setAttribute('aria-label', title)
    if (text) node.textContent = text
    else node.append(app.icons.draw(icon))
    // The field keeps the keyboard: a click on a button must not take it away.
    node.onmousedown = (event) => event.preventDefault()
    node.onclick = action
    return node
  }
  const caseButton = button(box, '', 'Учитывать регистр', () => toggle('caseSensitive'), 'Aa')
  const wordButton = button(box, '', 'Слово целиком', () => toggle('wholeWord'), '«а»')
  const regexButton = button(box, '', 'Регулярное выражение', () => toggle('regexp'), '.*')
  button(row, 'lucide-arrow-up', 'Предыдущее (Shift+Enter)', () => step(false))
  button(row, 'lucide-arrow-down', 'Следующее (Enter)', () => step(true))
  button(row, 'lucide-text-select', 'Выделить все найденные (Alt+Enter)', () => (commit(), selectMatches(view), view.focus()))
  button(row, 'lucide-x', 'Закрыть (Esc)', () => closeSearchPanel(view))

  const replaceRow = el(dom, 'div', 'find-row find-replace')
  const replaceBox = el(replaceRow, 'div', 'find-field')
  const replaceField = el(replaceBox, 'input')
  replaceField.placeholder = 'Заменить на…'
  replaceField.setAttribute('aria-label', 'Заменить на')
  button(replaceRow, 'lucide-replace', 'Заменить (Enter)', () => (commit(), replaceNext(view)))
  button(replaceRow, 'lucide-replace-all', 'Заменить все (Ctrl+Alt+Enter)', () => (commit(), replaceAll(view)))

  let options = { caseSensitive: false, wholeWord: false, regexp: false }
  /** Where in the history the Up key has got to; -1 is what is being typed. */
  let back = -1
  let draft = ''

  const commit = () => {
    const query = new SearchQuery({ search: field.value, replace: replaceField.value, ...options })
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) })
  }
  const toggle = (key: keyof typeof options) => {
    options = { ...options, [key]: !options[key] }
    commit()
    show()
  }
  const step = (forward: boolean) => {
    commit()
    remember(field.value)
    back = -1
    ;(forward ? findNext : findPrevious)(view)
  }
  /** "3 из 12": which of the found places the cursor is on. */
  const tally = () => {
    const query = getSearchQuery(view.state)
    if (!query.search || !query.valid) return void (count.textContent = query.search && !query.valid ? 'ошибка' : '')
    const head = view.state.selection.main.from
    let total = 0
    let at = 0
    const cursor = query.getCursor(view.state) as Iterator<{ from: number; to: number }> & SearchCursor
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      total++
      if (next.value.from <= head) at = total
      if (total >= 9999) break
    }
    count.textContent = total ? `${at || 1} из ${total}` : 'нет'
    box.classList.toggle('none', !total)
  }
  const show = () => {
    const query = getSearchQuery(view.state)
    if (document.activeElement !== field) field.value = query.search
    if (document.activeElement !== replaceField) replaceField.value = query.replace
    options = { caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regexp: query.regexp }
    caseButton.classList.toggle('on', options.caseSensitive)
    wordButton.classList.toggle('on', options.wholeWord)
    regexButton.classList.toggle('on', options.regexp)
    tally()
  }

  field.oninput = () => {
    back = -1
    commit()
  }
  replaceField.oninput = commit
  field.onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.altKey) return void (commit(), selectMatches(view), view.focus())
      step(!event.shiftKey)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // Earlier searches, newest first; Down comes back to what was being typed.
      if (!history.length) return
      event.preventDefault()
      if (back < 0) draft = field.value
      back = Math.max(-1, Math.min(history.length - 1, back + (event.key === 'ArrowUp' ? 1 : -1)))
      field.value = back < 0 ? draft : history[history.length - 1 - back]
      commit()
    }
  }
  replaceField.onkeydown = (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    commit()
    if ((event.ctrlKey || event.metaKey) && event.altKey) replaceAll(view)
    else replaceNext(view)
  }
  dom.onkeydown = (event) => {
    // The keys of the editor do not reach it from here, so the bar answers them itself.
    const mod = event.ctrlKey || event.metaKey
    if (mod && !event.altKey && (event.code === 'KeyH' || event.code === 'KeyF')) {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'KeyH') {
        replaceRow.hidden = !replaceRow.hidden
        ;(replaceRow.hidden ? field : replaceField).focus()
      } else api.focus()
      return
    }
    if (event.key === 'F3' || (mod && event.code === 'KeyG')) {
      event.preventDefault()
      return step(!event.shiftKey)
    }
    if (event.key !== 'Escape') return
    event.preventDefault()
    remember(field.value)
    closeSearchPanel(view)
    view.focus()
  }

  const api = {
    showReplace(on: boolean) {
      replaceRow.hidden = !on
    },
    focus() {
      field.focus()
      field.select()
    },
  }
  return {
    dom,
    top: true,
    mount() {
      bars.set(view, api)
      api.showReplace(withReplace)
      show()
      api.focus()
    },
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)))) show()
    },
    destroy() {
      bars.delete(view)
    },
  }
}

/** Opens the bar, with or without the row to replace with; an open bar is changed and takes the keyboard. */
function open(view: EditorView, replace: boolean): boolean {
  withReplace = replace
  if (searchPanelOpen(view.state)) {
    bars.get(view)?.showReplace(replace)
    bars.get(view)?.focus()
  } else openSearchPanel(view)
  return true
}

/** Finding and replacing in a note: Ctrl+F, Ctrl+H, F3 and Shift+F3 for the next and the previous. */
export function findInNote(app: App): Extension {
  return [
    search({ top: true, createPanel: (view) => findBar(app, view) }),
    keymap.of([
      { key: 'Mod-f', run: (view) => open(view, false), preventDefault: true },
      { key: 'Mod-h', run: (view) => open(view, true), preventDefault: true },
      { key: 'F3', run: findNext, shift: findPrevious, preventDefault: true },
      { key: 'Mod-g', run: findNext, shift: findPrevious, preventDefault: true },
      { key: 'Escape', run: closeSearchPanel },
    ]),
  ]
}

/** For commands: the same actions on a given editor. */
export const openFind = (view: EditorView, replace = false) => open(view, replace)
