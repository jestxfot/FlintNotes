// Small edits of the open note as commands: what a phone's bar over the keyboard offers (a phone has no
// Tab, no Ctrl+Z), and what anyone may put on a button or a shortcut.
import { startCompletion } from '@codemirror/autocomplete'
import { indentLess, indentMore, redo, undo } from '@codemirror/commands'
import { EditorSelection, type ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** Puts `mark` on both sides of the selection, or takes it off; with nothing selected, the cursor goes between two. */
function wrap(view: EditorView, mark: string): boolean {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - mark.length, range.from)
      const after = state.sliceDoc(range.to, range.to + mark.length)
      if (before === mark && after === mark)
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + mark.length },
          ],
          range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
        }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      }
    }),
  )
  return true
}

/** Rewrites the start of every line the selection touches. */
function eachLine(view: EditorView, rewrite: (text: string) => string): boolean {
  const { state } = view
  const changes: ChangeSpec[] = []
  const seen = new Set<number>()
  for (const range of state.selection.ranges) {
    for (let at = range.from; ; ) {
      const line = state.doc.lineAt(at)
      if (!seen.has(line.number)) {
        seen.add(line.number)
        const next = rewrite(line.text)
        if (next !== line.text) {
          // Only the changed beginning is replaced, so the cursor further along the line stays where it was.
          let same = 0
          while (same < next.length && same < line.text.length && next[same] === line.text[same]) same++
          let tail = 0
          while (tail < next.length - same && tail < line.text.length - same && next[next.length - 1 - tail] === line.text[line.text.length - 1 - tail]) tail++
          changes.push({ from: line.from + same, to: line.to - tail, insert: next.slice(same, next.length - tail) })
        }
      }
      if (line.to >= range.to) break
      at = line.to + 1
    }
  }
  if (changes.length) view.dispatch({ changes, scrollIntoView: true })
  return true
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+/
const TASK = /^(\s*)([-*+]|\d+[.)])\s+\[(.)\]\s?/

/** A line becomes a task; a task is ticked or unticked. */
const checkbox = (text: string) => {
  const task = TASK.exec(text)
  if (task) return text.replace(TASK, (all, indent, bullet, mark) => `${indent}${bullet} [${mark === ' ' ? 'x' : ' '}] `)
  const list = LIST.exec(text)
  if (list) return `${list[0]}[ ] ${text.slice(list[0].length)}`
  const indent = /^\s*/.exec(text)![0]
  return `${indent}- [ ] ${text.slice(indent.length)}`
}

/** A line becomes an item of a list, or stops being one. */
const bullet = (text: string) => {
  const list = LIST.exec(text)
  if (list) return list[1] + text.slice(list[0].length).replace(/^\[.\]\s?/, '')
  const indent = /^\s*/.exec(text)![0]
  return `${indent}- ${text.slice(indent.length)}`
}

/** Plain text, then headings of the first three levels, then plain text again. */
const heading = (text: string) => {
  const level = /^(#{1,6})\s+/.exec(text)
  const body = level ? text.slice(level[0].length) : text
  const next = level ? level[1].length + 1 : 1
  return next > 3 ? body : `${'#'.repeat(next)} ${body}`
}

/** `[[` and `]]` around the selection or the cursor; with nothing selected the list of notes opens. */
function link(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)
  view.dispatch({ changes: { from, to, insert: `[[${text}]]` }, selection: { anchor: from + 2, head: from + 2 + text.length } })
  if (!text) startCompletion(view)
  return true
}

function tag(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  const before = view.state.sliceDoc(from - 1, from)
  const insert = before && !/\s/.test(before) ? ' #' : '#'
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } })
  startCompletion(view)
  return true
}

export interface FormatCommand {
  id: string
  name: string
  icon: string
  run: (view: EditorView) => boolean
}

export const FORMAT_COMMANDS: FormatCommand[] = [
  { id: 'core:edit-undo', name: 'Отменить правку', icon: 'undo-2', run: undo },
  { id: 'core:edit-redo', name: 'Вернуть правку', icon: 'redo-2', run: redo },
  { id: 'core:edit-checkbox', name: 'Задача: поставить или снять отметку', icon: 'square-check', run: (view) => eachLine(view, checkbox) },
  { id: 'core:edit-list', name: 'Сделать строки списком или обычным текстом', icon: 'list', run: (view) => eachLine(view, bullet) },
  { id: 'core:edit-indent', name: 'Сдвинуть строки вправо', icon: 'indent-increase', run: indentMore },
  { id: 'core:edit-outdent', name: 'Сдвинуть строки влево', icon: 'indent-decrease', run: indentLess },
  { id: 'core:edit-link', name: 'Ссылка на заметку', icon: 'link', run: link },
  { id: 'core:edit-tag', name: 'Тег', icon: 'hash', run: tag },
  { id: 'core:edit-heading', name: 'Заголовок: уровень по кругу', icon: 'heading', run: (view) => eachLine(view, heading) },
  { id: 'core:edit-bold', name: 'Полужирный', icon: 'bold', run: (view) => wrap(view, '**') },
  { id: 'core:edit-italic', name: 'Курсив', icon: 'italic', run: (view) => wrap(view, '*') },
  { id: 'core:edit-strike', name: 'Зачёркнутый', icon: 'strikethrough', run: (view) => wrap(view, '~~') },
  { id: 'core:edit-highlight', name: 'Выделить маркером', icon: 'highlighter', run: (view) => wrap(view, '==') },
  { id: 'core:edit-code', name: 'Код в строке', icon: 'code', run: (view) => wrap(view, '`') },
]
