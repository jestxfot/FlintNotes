import { mount, unmount } from 'svelte'
import { cm, errorMessage, path as paths, Plugin, renderInline, type CodeBlockContext, type PreviewRenderer } from '../../api'
import { today } from './dates'
import { Reminders, stamp } from './reminders'
import { mountReminders } from './reminders-panel'
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
import TaskManager from './TaskManager.svelte'

const MANAGER = 'tasks-manager'

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
      { key: 'managerFile', name: 'Заметка для новых задач менеджера', desc: 'Сюда попадают задачи, добавленные в менеджере задач не в списке конкретной заметки', type: 'text', default: 'Задачи.md', placeholder: 'Задачи.md' },
      {
        key: 'remindDue',
        name: 'Напоминать о задачах со сроком',
        desc: 'Задача со сроком 📅, но без времени ⏰, напомнит о себе в день срока',
        type: 'toggle',
        default: true,
      },
      {
        key: 'alertStyle',
        name: 'Как показывать напоминание',
        desc: 'На весь экран — не пропустить; карточкой в углу — не отрываться от работы; только в списке — без всплывающих окон',
        type: 'select',
        default: 'fullscreen',
        options: [
          { value: 'fullscreen', label: 'На весь экран' },
          { value: 'banner', label: 'Карточкой в углу' },
          { value: 'off', label: 'Только в списке напоминаний' },
        ],
      },
      { key: 'leadMinutes', name: 'Напоминать заранее, минут', desc: '0 — точно в назначенное время', type: 'number', default: 0, min: 0, max: 240 },
      { key: 'planner', name: 'План дня из ежедневных заметок', desc: 'Строка задачи в заметке дня, которая начинается со времени — «- [ ] 17:00 - 17:10 Витамин D», как в плагине Day Planner, — напоминает о себе в это время', type: 'toggle', default: true },
      { key: 'plannerOverdueDays', name: 'Сколько дней помнить невыполненный план дня', desc: 'Неотмеченные строки плана старше этого срока не считаются просроченными и не показываются', type: 'number', default: 1, min: 0, max: 60 },
      { key: 'quietFrom', name: 'Тихие часы: с', desc: 'В тихие часы напоминания не всплывают и не звучат, но остаются в списке. Пусто — без тихих часов', type: 'text', default: '', placeholder: '23:00' },
      { key: 'quietTo', name: 'Тихие часы: до', type: 'text', default: '', placeholder: '08:00' },
      {
        key: 'remindPlain',
        name: 'Напоминать и по обычным строкам',
        desc: 'Любая строка с «(@2026-10-10 14:00)» напомнит о себе, даже без флажка задачи. Сам Reminder в Obsidian напоминает только по строкам с флажком',
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
      {
        key: 'laterOptions',
        name: 'Варианты «напомнить позже»',
        desc: 'По одному в строке: «10 минут», «1 час», «3 часа», «Завтра», «Через неделю» (или In 30 minutes, Tomorrow, Next week). У задачи со своим временем напоминания новое время записывается в заметку',
        type: 'lines',
        default: '10 минут\n30 минут\n1 час\n3 часа\nЗавтра\nЧерез неделю',
      },
      {
        key: 'reminderStyle',
        name: 'Как записывать напоминание',
        desc: 'Для напоминаний, заданных в форме задачи и подсказкой после «(@». Оба вида читаются всегда',
        type: 'select',
        default: 'emoji',
        options: [
          { value: 'emoji', label: '⏰ 2026-10-10 14:00 (как Tasks)' },
          { value: 'at', label: '(@2026-10-10 14:00) (как Reminder)' },
        ],
      },
      { key: 'sound', name: 'Звуковой сигнал', type: 'toggle', default: true },
      {
        key: 'soundKind',
        name: 'Звук',
        desc: 'Послушать: команда «Проиграть звук напоминания»',
        type: 'select',
        default: 'chime',
        options: [
          { value: 'chime', label: 'Перезвон' },
          { value: 'bell', label: 'Колокольчик' },
          { value: 'soft', label: 'Тихий, две ноты' },
          { value: 'classic', label: 'Три гудка (прежний)' },
        ],
      },
      { key: 'volume', name: 'Громкость, %', type: 'number', default: 60, min: 0, max: 100, step: 5 },
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

    /** A reminder set in the form is written the way the settings say, unless the task already had one written otherwise. */
    const styled = (before: TaskFields, after: TaskFields): TaskFields => ({ ...after, reminderAt: before.reminder ? before.reminderAt : this.getSetting<string>('reminderStyle') === 'at' })
    const openDialog = (task: TaskFields, title: string, save: (fields: TaskFields) => void) => {
      // Tasks chosen as "before" or "after" this one get an id or a ⛔ written into their own lines first.
      const onsave = async (fields: TaskFields, others: { task: Task; extra: string | undefined }[] = []) => {
        for (const other of others) {
          await store.edit(other.task, (raw) => {
            const parsed = parseTaskLine(raw)
            return parsed ? [formatTaskLine({ ...parsed, extra: other.extra }, parsed.prefix)] : [raw]
          })
        }
        save(styled(task, fields))
      }
      const target = document.body.appendChild(document.createElement('div'))
      const dialog = mount(TaskDialog, {
        target,
        props: {
          task,
          title,
          tasks: store.all(),
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
          const done = formatTaskLine({ ...fields, done: fields.done ?? today() }, prefix)
          return next ? [formatTaskLine(next, prefix), done] : [done]
        })
      })
    // Other plugins (the calendar) list the vault's tasks and open their window through this.
    this.provide('tasks', { all: () => store.all(), toggle: (task: Task) => store.toggle(task), edit: editTask, on: (name: 'change', fn: () => void) => store.on(name, fn) })

    // ---- the task manager: a tab of its own over every task of the vault
    this.registerView(
      MANAGER,
      ({ containerEl }) => {
        containerEl.classList.add('task-manager-view')
        const manager = mount(TaskManager, {
          target: containerEl,
          props: {
            app,
            store,
            inbox: () => paths.normalize(this.getSetting<string>('managerFile') || 'Задачи.md').replace(/(\.md)?$/, '.md'),
            onedit: editTask,
          },
        })
        return { destroy: () => void unmount(manager) }
      },
      [],
    )
    const openManager = () => app.workspace.openView(MANAGER, 'Задачи')
    this.addCommand({ id: 'manager', name: 'Открыть менеджер задач', icon: 'list-todo', scope: 'vault', hotkey: 'Alt+Shift+T', callback: openManager })

    const addTask = async (fields: TaskFields) => {
      const line = formatTaskLine(isDone(fields) ? { ...fields, done: fields.done ?? today() } : fields)
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
            const written = formatTaskLine(completing ? { ...fields, done: fields.done ?? today() } : { ...fields, done: isDone(fields) ? fields.done : undefined }, task.prefix)
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

    // ---- the list of reminders, as a sidebar widget: overdue, today, tomorrow, then by day
    this.addPanel({
      id: 'reminders',
      title: 'Напоминания',
      side: 'right',
      icon: 'M8 2.5a4 4 0 0 0-4 4c0 3-1.5 4-1.5 5h11c0-1-1.5-2-1.5-5a4 4 0 0 0-4-4zM6.5 13.5a1.6 1.6 0 0 0 3 0',
      mount: (target) => mountReminders(app, store, reminders, editTask, target),
    })
    // Whatever is put off, closed or muted shows in the lists at once.
    this.onSettingChange((key) => ['acknowledged', 'snoozed', 'muteUntil', 'planner', 'plannerOverdueDays', 'remindDue', 'defaultTime', 'remindPlain'].includes(key) && store.trigger('change'))
    this.addCommand({ id: 'play-sound', name: 'Проиграть звук напоминания', icon: 'volume-2', callback: () => reminders.playSound() })
    // A sound chosen in the settings is heard at once.
    this.onSettingChange((key) => (key === 'soundKind' || key === 'volume') && reminders.playSound())
    this.addCommand({ id: 'mute-hour', name: 'Не беспокоить напоминаниями 1 час', icon: 'bell-off', callback: () => reminders.mute(60) })
    this.addCommand({ id: 'unmute', name: 'Включить напоминания (снять «не беспокоить»)', icon: 'bell', callback: () => reminders.mute(0) })

    // ---- typing a reminder: after "(@" a list of times is offered
    this.registerCompletionSource((context) => {
      const match = context.matchBefore(/\(@[^)\n]*$/)
      if (!match) return null
      const closed = context.state.sliceDoc(context.pos, context.pos + 1) === ')'
      const now = new Date()
      const at = (days: number, hours: number, minutes = 0) => stamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours, minutes))
      const typed = match.text.slice(2).trim()
      const choices: [label: string, value: string][] = [
        ['Через час', stamp(new Date(now.getTime() + 3_600_000))],
        ['Сегодня вечером, 19:00', at(0, 19)],
        ['Завтра утром, 09:00', at(1, 9)],
        ['Завтра вечером, 19:00', at(1, 19)],
        ['Послезавтра, 09:00', at(2, 9)],
        ['Через неделю, 09:00', at(7, 9)],
      ]
      // What is typed may already be a time of its own: "14:30" means today at that time.
      if (/^\d{1,2}:\d{2}$/.test(typed)) choices.unshift([`Сегодня, ${typed}`, at(0, Number(typed.split(':')[0]), Number(typed.split(':')[1]))])
      return {
        from: match.from + 2,
        filter: false,
        options: choices.map(([label, value], i) => ({
          label,
          detail: value,
          boost: -i,
          apply: (view: InstanceType<typeof cm.view.EditorView>, _c: unknown, from: number, to: number) =>
            view.dispatch({ changes: { from, to, insert: closed ? value : `${value})` }, selection: { anchor: from + value.length + 1 }, userEvent: 'input.complete' }),
        })),
      }
    })
    this.addInsertCommand('insert-reminder', 'Вставить напоминание', '(@|)', 'bell')

    this.addCommand({
      id: 'new',
      name: 'Новая задача',
      hotkey: 'Alt+T',
      callback: () => openDialog({ status: ' ', description: '', priority: NO_PRIORITY }, 'Новая задача', (f) => void addTask(f)),
    })
    this.addInsertCommand('insert-query', 'Вставить список задач', '```tasks\nnot done\n|\n```\n', 'list-todo')
    this.addInsertCommand('insert-calendar', 'Вставить календарь задач', '```tasks\nnot done\n# view calendar\n```\n', 'calendar-check')
    this.addCommand({
      id: 'toggle-done',
      name: 'Отметить задачу в строке с курсором',
      icon: 'square-check',
      callback: () => {
        const editor = app.workspace.activeEditor
        if (!editor) return
        const line = editor.state.doc.lineAt(editor.state.selection.main.head)
        if (!parseTaskLine(line.text)) return app.notice('В этой строке нет задачи')
        editor.dispatch({ changes: { from: line.from, to: line.to, insert: toggleTaskLine(line.text, today()).join(editor.state.lineBreak) } })
      },
    })
    this.addCommand({ id: 'check-reminders', name: 'Проверить напоминания', callback: () => reminders.check() })
  }
}
