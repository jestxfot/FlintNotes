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
  /** Where the cursor was when the search began: typing looks from there on. */
  let origin = view.state.selection.main.from

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
    centre(view)
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
    // What is being typed is shown as it is found, from where the cursor was when the bar was opened.
    const query = getSearchQuery(view.state)
    if (!query.search || !query.valid) return
    const cursor = query.getCursor(view.state, origin) as Iterator<{ from: number; to: number }>
    const found = cursor.next()
    const first = found.done ? (query.getCursor(view.state) as Iterator<{ from: number; to: number }>).next() : found
    if (!first.done) view.dispatch({ selection: { anchor: first.value.from, head: first.value.to }, effects: EditorView.scrollIntoView(first.value.from, { y: 'center' }) })
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
      origin = view.state.selection.main.from
      api.showReplace(withReplace)
      show()
      api.focus()
    },
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)))) {
        show()
        // Blocks are drawn after the editor has taken the change in.
        requestAnimationFrame(() => requestAnimationFrame(() => paintBlocks(view)))
      }
    },
    destroy() {
      bars.delete(view)
      highlights?.delete('flint-find')
      highlights?.delete('flint-find-current')
    },
  }
}

const highlights = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights
const makeHighlight = (ranges: Range[]) => new (globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight(...ranges)

/**
 * Lights what is searched for inside blocks that are drawn rather than shown as text
 * (tables, lists of tasks). The block stays as it is drawn: the places are painted over
 * its own text with the browser's highlights, and the current one is brought to the middle.
 */
function paintBlocks(view: EditorView): void {
  if (!highlights) return
  highlights.delete('flint-find')
  highlights.delete('flint-find-current')
  if (!searchPanelOpen(view.state)) return
  const query = getSearchQuery(view.state)
  if (!query.search || !query.valid || query.regexp) return
  const needle = query.caseSensitive ? query.search : query.search.toLowerCase()
  const fold = (text: string) => (query.caseSensitive ? text : text.toLowerCase())
  const head = view.state.selection.main
  const all: Range[] = []
  /** The drawn block the search stands in: the last one that begins at or before the place found. */
  let inside: { start: number; found: Range[] } | null = null
  for (const block of view.dom.querySelectorAll<HTMLElement>('.lp-block, .lp-embed')) {
    const found: Range[] = []
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = fold(node.textContent ?? '')
      for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        found.push(range)
      }
    }
    all.push(...found)
    if (head.empty) continue
    let start: number
    try {
      start = view.posAtDOM(block)
    } catch {
      continue
    }
    if (start <= head.from && (!inside || start >= inside.start)) inside = { start, found }
  }
  let current: Range | null = null
  // The place is the n-th one in the block's text, and so the n-th one in what is drawn of it. A block
  // that begins before the place but does not hold it has it nowhere in its text, and nothing is lit.
  if (inside && inside.found.length && fold(view.state.sliceDoc(head.from, head.to)) === needle) {
    const lineStart = view.state.doc.lineAt(head.from).from
    const blockText = fold(view.state.sliceDoc(inside.start, head.from))
    // Between the block's start and the place there must be no empty line: an empty line ends a table.
    if (!/\n[ \t]*\n/.test(view.state.sliceDoc(inside.start, lineStart))) {
      let nth = 0
      for (let at = blockText.indexOf(needle); at >= 0; at = blockText.indexOf(needle, at + needle.length)) nth++
      current = inside.found[Math.min(nth, inside.found.length - 1)]
    }
  }
  if (all.length) highlights.set('flint-find', makeHighlight(all))
  if (current) {
    highlights.set('flint-find-current', makeHighlight([current]))
    const box = current.getBoundingClientRect()
    const page = view.scrollDOM.getBoundingClientRect()
    // Into the middle, if it is not already comfortably on the page.
    if (box.top < page.top + 80 || box.bottom > page.bottom - 80) view.scrollDOM.scrollBy({ top: box.top - (page.top + page.height / 2) })
    const cell = current.startContainer.parentElement?.closest<HTMLElement>('.table-wrap, .lp-block-body, td, th')
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}

/** Puts what was found in the middle of the page, where the eye is, instead of at its very edge. */
function centre(view: EditorView): void {
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main, { y: 'center' }) })
}
const next = (view: EditorView) => findNext(view) && (centre(view), true)
const previous = (view: EditorView) => findPrevious(view) && (centre(view), true)

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
      { key: 'F3', run: next, shift: previous, preventDefault: true },
      { key: 'Mod-g', run: next, shift: previous, preventDefault: true },
      { key: 'Escape', run: closeSearchPanel },
    ]),
  ]
}

/** For commands: the same actions on a given editor. */
export const openFind = (view: EditorView, replace = false) => open(view, replace)
