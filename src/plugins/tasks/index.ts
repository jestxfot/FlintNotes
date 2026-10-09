import { mount, unmount } from 'svelte'
import { cm, errorMessage, Plugin, type CodeBlockContext, type PreviewRenderer } from '../../api'
import { today } from './dates'
import { Reminders } from './reminders'
import { tasksProcessor } from './render'
import { TaskStore } from './store'
import './style.css'
import {
  formatTaskLine,
  isDone,
  nextOccurrence,
  NO_PRIORITY,
  parseTaskLine,
  toggleTaskLine,
  type Task,
  type TaskFields,
} from './task'
import TaskDialog from './TaskDialog.svelte'

// A date field, a priority, a repeat rule or a reminder, as written in a task line.
const FIELD = /[📅⏳🛫➕✅❌]\uFE0F?\s*\d{4}-\d{2}-\d{2}|[🔺⏫🔼🔽⏬]\uFE0F?|🔁\uFE0F?\s*[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬⏰🆔⛔🏁#]+|⏰\uFE0F?\s*(?:\d{4}-\d{2}-\d{2}[ T]?)?(?:\d{1,2}:\d{2})?/gu

export default class Tasks extends Plugin {
  onload() {
    const { app } = this
    const store = new TaskStore(app)
    this.register(store.start())

    this.addSettings([
      {
        key: 'inbox',
        name: 'Заметка для новых задач',
        desc: 'Сюда попадает задача, созданная командой, когда не открыта ни одна заметка',
        type: 'text',
        default: 'Задачи.md',
      },
      {
        key: 'panelQuery',
        name: 'Запрос для виджета задач',
        desc: 'Те же инструкции, что в блоке ```tasks',
        type: 'lines',
        default: 'not done\ngroup by when\nsort by due\nsort by priority',
      },
      {
        key: 'remindDue',
        name: 'Напоминать о задачах со сроком',
        desc: 'Задача со сроком 📅, но без времени ⏰, напомнит о себе в день срока',
        type: 'toggle',
        default: true,
      },
      { key: 'defaultTime', name: 'Время таких напоминаний', type: 'text', default: '09:00', placeholder: '09:00' },
      {
        key: 'maxAgeDays',
        name: 'Не напоминать о просроченном старше, дней',
        type: 'number',
        default: 7,
        min: 1,
        max: 365,
      },
      { key: 'sound', name: 'Звуковой сигнал', type: 'toggle', default: true },
      { key: 'repeatSeconds', name: 'Повторять сигнал каждые, секунд', type: 'number', default: 5, min: 2, max: 120 },
      {
        key: 'system',
        name: 'Системные уведомления',
        desc: 'Дополнительно показывать уведомление операционной системы, когда вкладка не на виду',
        type: 'toggle',
        default: false,
      },
    ])
    this.onSettingChange((key) => {
      // The browser only shows the permission prompt in response to a click, like this toggle.
      if (key === 'system' && this.getSetting<boolean>('system')) void globalThis.Notification?.requestPermission()
    })

    const openDialog = (task: TaskFields, title: string, onsave: (fields: TaskFields) => void) => {
      const target = document.body.appendChild(document.createElement('div'))
      const dialog = mount(TaskDialog, {
        target,
        props: {
          task,
          title,
          onsave,
          onclose: () => {
            void unmount(dialog)
            target.remove()
          },
        },
      })
    }

    const editTask = (task: Task) =>
      openDialog(task, 'Изменить задачу', (fields) => {
        void store.edit(task, (raw) => {
          const prefix = parseTaskLine(raw)?.prefix
          // Ticking "done" in the form completes the task properly: date stamp and next occurrence.
          if (!isDone(fields) || isDone(task)) return [formatTaskLine({ ...fields, done: isDone(fields) ? fields.done : undefined }, prefix)]
          const next = nextOccurrence({ ...fields, status: ' ' }, today())
          const done = formatTaskLine({ ...fields, done: today() }, prefix)
          return next ? [formatTaskLine(next, prefix), done] : [done]
        })
      })

    const addTask = async (fields: TaskFields) => {
      const line = formatTaskLine(isDone(fields) ? { ...fields, done: today() } : fields)
      const editor = app.workspace.activeEditor
      if (editor) {
        // Below the cursor's line, or in its place if that line is empty.
        const at = editor.state.doc.lineAt(editor.state.selection.main.head)
        const insert = at.text.trim() ? `${editor.state.lineBreak}${line}` : line
        editor.dispatch({ changes: { from: at.text.trim() ? at.to : at.from, to: at.to, insert } })
        return
      }
      const inbox = this.getSetting<string>('inbox').trim() || 'Задачи.md'
      try {
        const text = await app.vault.readOptional(inbox)
        await app.vault.write(inbox, text === null ? `${line}\n` : `${text.replace(/\n*$/, '\n')}${line}\n`)
        app.notice(`Задача добавлена в «${inbox}»`)
      } catch (err) {
        app.notice(`Не удалось добавить задачу: ${errorMessage(err)}`)
      }
    }

    const render = tasksProcessor(store, editTask)
    this.registerCodeBlockProcessor('tasks', render)

    // The same list as a widget: every task of the vault, by the query from the settings.
    this.addPanel({
      id: 'tasks',
      title: 'Задачи',
      side: 'right',
      icon: 'M2.5 4.5l1.5 1.5 2.5-3M2.5 10.5l1.5 1.5 2.5-3M9 5h5M9 11h5',
      mount: (target) => {
        const list = target.appendChild(document.createElement('div'))
        list.className = 'tasks-panel'
        const context: CodeBlockContext = { app, path: '', lang: 'tasks', setSource: () => {} }
        const view = render(this.getSetting<string>('panelQuery'), list, context)
        const off = app.settings.on('change', (scope, key) => {
          if (scope === this.manifest.id && key === 'panelQuery') view?.update?.(this.getSetting<string>('panelQuery'))
        })
        return () => {
          off()
          view?.destroy?.()
        }
      },
    })

    /** In the editor a task's dates, priority and repeat rule are set apart from its text. */
    const fields: PreviewRenderer = {
      name: 'task-fields',
      nodes: ['Task'],
      render(node, ctx) {
        const text = ctx.text(node.from, node.to)
        for (const m of text.matchAll(FIELD)) {
          const overdue = m[0].startsWith('📅') && !/^\[[xX-]\]/.test(text) && m[0].slice(-10) < today()
          ctx.mark(node.from + m.index, node.from + m.index + m[0].length, { class: overdue ? 'lp-task-field overdue' : 'lp-task-field' })
        }
      },
    }
    this.registerPreviewRenderer(fields)

    // A click on one of those opens the task's form, filled from the line as it is in the editor
    // (saved or not); the form writes the line back.
    const fieldAt = (event: MouseEvent) => (event.button === 0 && !event.ctrlKey && !event.metaKey && event.target instanceof Element ? event.target.closest('.lp-task-field') : null)
    this.registerEditorExtension(
      cm.view.EditorView.domEventHandlers({
        // Swallowing mousedown keeps the cursor where it was.
        mousedown: (event) => !!fieldAt(event),
        click: (event, view) => {
          const chip = fieldAt(event)
          if (!chip) return false
          const raw = view.state.doc.lineAt(view.posAtDOM(chip)).text
          const task = parseTaskLine(raw)
          if (!task) return false
          openDialog(task, 'Изменить задачу', (fields) => {
            // The note may have been edited while the form was open; the line is found again by its text.
            const { doc } = view.state
            let line = null
            for (let n = 1; n <= doc.lines && !line; n++) if (doc.line(n).text === raw) line = doc.line(n)
            if (!line) return app.notice('Строка задачи изменилась, правка не записана')
            const completing = isDone(fields) && !isDone(task)
            const next = completing ? nextOccurrence({ ...fields, status: ' ' }, today()) : null
            const written = formatTaskLine(completing ? { ...fields, done: today() } : { ...fields, done: isDone(fields) ? fields.done : undefined }, task.prefix)
            const lines = next ? [formatTaskLine(next, task.prefix), written] : [written]
            view.dispatch({ changes: { from: line.from, to: line.to, insert: lines.join(view.state.lineBreak) } })
          })
          return true
        },
      }),
    )

    // Ticking a task's checkbox in the editor completes it like everywhere else:
    // the done date is stamped and a repeating task gets its next occurrence.
    this.registerEditorExtension(
      cm.state.EditorState.transactionFilter.of((tr) => {
        if (!tr.isUserEvent('input.task')) return tr
        let pos = -1
        tr.changes.iterChangedRanges((from) => (pos = from))
        if (pos < 0) return tr
        const line = tr.startState.doc.lineAt(pos)
        const lines = toggleTaskLine(line.text, today())
        return { changes: { from: line.from, to: line.to, insert: lines.join(tr.startState.lineBreak) } }
      }),
    )

    const reminders = new Reminders(this, store)
    this.register(reminders.start())

    this.addCommand({
      id: 'new',
      name: 'Новая задача',
      hotkey: 'Alt+T',
      callback: () => openDialog({ status: ' ', description: '', priority: NO_PRIORITY }, 'Новая задача', (f) => void addTask(f)),
    })
    this.addCommand({ id: 'check-reminders', name: 'Проверить напоминания', callback: () => reminders.check() })
  }
}
