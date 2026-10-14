import { errorMessage, moment, path as paths, Plugin, renderInline, type Moment } from '../../api'
import './style.css'

const PANEL = 'day-planner'
/** What a line of the month carries while it is dragged to another day. */
const DRAG = 'application/x-flint-plan-line'
// `- [ ] 17:00 - 17:10 text`, `- 9:30 text`; the box and the end are optional.
const LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)(?:\[(.)\]\s+)?(\d{1,2}):(\d{2})(?:(\s*[-–—]\s*)(\d{1,2}):(\d{2}))?(\s+.*|)$/
const LOOSE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[(.)\]\s+(.*)$/

interface Block {
  /** Zero-based line in the note. */
  line: number
  raw: string
  status: string | null
  /** Minutes from midnight. */
  start: number
  end: number
  /** Whether the line itself says when the block ends. */
  hasEnd: boolean
  text: string
}

type Mode = 'day' | 'three' | 'week' | 'month'
const MODES: { id: Mode; name: string }[] = [
  { id: 'day', name: 'День' },
  { id: 'three', name: '3 дня' },
  { id: 'week', name: 'Неделя' },
  { id: 'month', name: 'Месяц' },
]

const two = (n: number) => String(n).padStart(2, '0')
const clock = (minutes: number) => `${two(Math.floor(minutes / 60) % 24)}:${two(minutes % 60)}`

/**
 * The plan of a day as a timeline, in the form the Day Planner plugin for
 * Obsidian has: list lines of the daily note that begin with a time are
 * blocks on a scale of hours. The note is the plan; the timeline shows it
 * and, when a block is moved, stretched or ticked, rewrites that one line.
 *
 * Reminding of a block when its time comes is the Tasks plugin's part (its
 * "day plan" setting): the two read the same lines and need nothing from
 * each other.
 */
export default class DayPlanner extends Plugin {
  async onload() {
    const { app } = this
    this.addSettings([
      { key: 'plannerHeading', section: 'Заметка дня', name: 'Заголовок плана', desc: 'Под ним в заметке дня появляются новые блоки. Блоками считаются строки со временем в любом месте заметки', type: 'text', default: 'Day planner' },
      { key: 'plannerHeadingLevel', section: 'Заметка дня', name: 'Уровень заголовка', type: 'number', default: 1, min: 1, max: 6 },
      { key: 'taskStatusOnCreation', section: 'Заметка дня', name: 'Новый блок — задача с флажком', type: 'toggle', default: true },
      { key: 'defaultDurationMinutes', section: 'Заметка дня', name: 'Длительность блока по умолчанию, минут', type: 'number', default: 30, min: 5, max: 480, step: 5 },
      { key: 'startHour', section: 'Шкала', name: 'С какого часа начинается шкала', type: 'number', default: 6, min: 0, max: 23 },
      { key: 'zoomLevel', section: 'Шкала', name: 'Масштаб', desc: '1 — весь день на экране, 4 — крупно', type: 'number', default: 2, min: 1, max: 4 },
      { key: 'snapStepMinutes', section: 'Шкала', name: 'Шаг при перетаскивании, минут', type: 'number', default: 10, min: 1, max: 60 },
      { key: 'minimalDurationMinutes', section: 'Шкала', name: 'Наименьшая длительность блока, минут', type: 'number', default: 10, min: 5, max: 120 },
      { key: 'centerNeedle', section: 'Шкала', name: 'Держать текущее время на виду', type: 'toggle', default: true },
      { key: 'showCompletedTasks', section: 'Шкала', name: 'Показывать выполненные блоки', type: 'toggle', default: true },
      { key: 'showUncheduledTasks', section: 'Шкала', name: 'Показывать над шкалой задачи дня без времени', type: 'toggle', default: true },
      { key: 'showActiveClockInStatusBar', section: 'Строка состояния', name: 'Показывать текущий и следующий блок', type: 'toggle', default: true },
    ])
    await this.importFromObsidian(false)
    const get = <T>(key: string) => this.getSetting<T>(key)
    const periodic = () => app.services.get<{ find(period: 'daily', date: Moment): string | null; ensure(period: 'daily', date: Moment): Promise<string | null> }>('periodic-notes')

    /** The note of a day: the one the calendar plugin knows, or any note named by the date. */
    const noteOf = (day: Moment): string | null => {
      const known = periodic()?.find('daily', day)
      if (known) return known
      const name = `${day.format('YYYY-MM-DD')}.md`
      return app.vault.files().find((file) => paths.basename(file.path) === name)?.path ?? null
    }
    /** The blocks of a note, and its tasks that have no time. */
    const read = (file: string | null): { blocks: Block[]; loose: Block[] } => {
      const blocks: Block[] = []
      const loose: Block[] = []
      const text = file ? app.metadata.text(file) : null
      if (!text) return { blocks, loose }
      const fallback = Math.max(5, get<number>('defaultDurationMinutes') ?? 30)
      let fence = false
      let inPlan = false
      const heading = (get<string>('plannerHeading') ?? '').trim().toLowerCase()
      text.split(/\r?\n/).forEach((raw, line) => {
        if (/^\s*(```|~~~)/.test(raw)) fence = !fence
        if (fence) return
        const title = /^#{1,6}\s+(.*)$/.exec(raw)
        if (title) inPlan = !!heading && title[1].trim().toLowerCase() === heading
        const m = LINE.exec(raw)
        if (m) {
          const start = Number(m[3]) * 60 + Number(m[4])
          const end = m[6] ? Number(m[6]) * 60 + Number(m[7]) : start + fallback
          if (start < 24 * 60) blocks.push({ line, raw, status: m[2] ?? null, start, end: end > start ? end : start + fallback, hasEnd: !!m[6], text: m[8].trim() })
          return
        }
        // Tasks under the plan's heading that have no time yet wait above the scale.
        const task = inPlan ? LOOSE.exec(raw) : null
        if (task) loose.push({ line, raw, status: task[2], start: 0, end: 0, hasEnd: false, text: task[3].trim() })
      })
      return { blocks: blocks.sort((a, b) => a.start - b.start || a.end - b.end), loose }
    }
    const isDone = (block: Block) => block.status !== null && block.status !== ' '

    /** Rewrites one line of a note; the line is found again by its text if the note has changed meanwhile. */
    const rewrite = async (file: string, block: Block, change: (raw: string) => string | null) => {
      try {
        await app.workspace.flushAll()
        const text = await app.vault.read(file)
        const lines = text.split(/\r?\n/)
        const at = lines[block.line] === block.raw ? block.line : lines.indexOf(block.raw)
        if (at < 0) return app.notice('Заметка изменилась, план сейчас обновится')
        const next = change(lines[at])
        if (next === null) lines.splice(at, 1)
        else lines[at] = next
        await app.vault.write(file, lines.join(text.includes('\r\n') ? '\r\n' : '\n'))
      } catch (err) {
        app.notice(`План дня: ${errorMessage(err)}`)
      }
    }
    const retime = (raw: string, start: number, end: number): string => {
      const m = LINE.exec(raw)
      if (!m) return raw
      return `${m[1]}${m[2] !== undefined ? `[${m[2]}] ` : ''}${clock(start)}${m[5] ?? ' - '}${clock(end)}${m[8]}`
    }
    /** Ticks or unticks a line the way the Tasks plugin does: with the day it was done. */
    const toggle = (raw: string): string => {
      const done = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/.exec(raw)
      if (!done) return raw
      const open = done[2] === ' '
      const body = raw.slice(done[0].length).replace(/\s*✅️?\s*\d{4}-\d{2}-\d{2}/u, '')
      return `${done[1]}${open ? 'x' : ' '}${done[3]}${body}${open ? ` ✅ ${moment().format('YYYY-MM-DD')}` : ''}`
    }
    /** Adds a block to the day's note under the plan's heading, making the note and the heading if need be. */
    /** Puts a line under the plan's heading of a note, making the heading if need be; returns where it went. */
    const insertLine = async (file: string, line: string): Promise<number> => {
      await app.workspace.flushAll()
      const text = await app.vault.read(file)
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      const lines = text.split(/\r?\n/)
      const title = (get<string>('plannerHeading') ?? 'Day planner').trim()
      let at = lines.findIndex((one) => new RegExp(`^#{1,6}\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(one))
      if (at < 0) {
        // No plan in this note yet: its heading goes at the end.
        if (lines[lines.length - 1] === '') lines.pop()
        lines.push('', `${'#'.repeat(Math.max(1, get<number>('plannerHeadingLevel') ?? 1))} ${title}`)
        at = lines.length - 1
      }
      // After the last line of the plan: the list under the heading, up to the first empty line or heading.
      let end = at + 1
      while (end < lines.length && lines[end].trim() && !/^#{1,6}\s/.test(lines[end])) end++
      lines.splice(end, 0, line)
      await app.vault.write(file, lines.join(eol))
      return end
    }
    const dayNote = async (day: Moment): Promise<string | null> => {
      const file = noteOf(day) ?? (await periodic()?.ensure('daily', day)) ?? null
      if (!file) app.notice('Нет заметки этого дня. Включите плагин «Календарь» или создайте заметку с датой в названии')
      return file
    }
    /** Adds a block to the day's note under the plan's heading, making the note and the heading if need be. */
    const addBlock = async (day: Moment, start: number, textOf = '') => {
      try {
        const file = await dayNote(day)
        if (!file) return
        const line = `- ${get<boolean>('taskStatusOnCreation') === false ? '' : '[ ] '}${clock(start)} - ${clock(start + Math.max(5, get<number>('defaultDurationMinutes') ?? 30))} ${textOf}`
        const end = await insertLine(file, line)
        app.workspace.openFile(file, { line: end })
        // The cursor goes to the end of the new line, ready for what the block is about.
        setTimeout(() => {
          const editor = app.workspace.activeEditor
          if (!editor || app.workspace.active?.path !== file) return
          const made = editor.state.doc.line(Math.min(end + 1, editor.state.doc.lines))
          editor.dispatch({ selection: { anchor: made.to } })
          editor.focus()
        }, 400)
      } catch (err) {
        app.notice(`План дня: ${errorMessage(err)}`)
      }
    }
    /**
     * Moves a block to another day: its line goes into that day's note (made if
     * need be) at its new time, and only then leaves the note it was in, so a
     * failure leaves it twice rather than nowhere.
     */
    const moveBlock = async (from: string, block: Block, day: Moment, start: number, end: number) => {
      try {
        const file = await dayNote(day)
        if (!file || file === from) return
        await insertLine(file, retime(block.raw, start, end).trimStart())
        await rewrite(from, block, () => null)
      } catch (err) {
        app.notice(`План дня: ${errorMessage(err)}`)
      }
    }

    /**
     * The window of one block: what it is about, when it begins and ends, whether
     * it is done. Saving rewrites the block's line; a task without a time gets one here.
     */
    const editBlock = (file: string, block: Block) => {
      const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = '') => {
        const node = parent.appendChild(document.createElement(tag))
        if (className) node.className = className
        if (text) node.textContent = text
        return node
      }
      const marker = /\s*✅️?\s*\d{4}-\d{2}-\d{2}/u
      const timed = LINE.test(block.raw)
      const dialog = el(document.body, 'dialog', 'day-dialog')
      const form = el(dialog, 'form')
      el(form, 'h2', '', timed ? 'Блок плана дня' : 'Задача дня')
      const field = (label: string, type: string, value: string, parent: HTMLElement = form) => {
        const wrap = el(parent, 'label', 'day-dialog-field')
        el(wrap, 'span', '', label)
        const input = el(wrap, 'input')
        input.type = type
        input.value = value
        return input
      }
      const what = field('Что', 'text', block.text.replace(marker, ''))
      const times = el(form, 'div', 'day-dialog-times')
      const from = field('Начало', 'time', timed ? clock(block.start) : '', times)
      const to = field('Конец', 'time', timed ? clock(block.end) : '', times)
      const quick = el(form, 'div', 'day-dialog-quick')
      for (const minutes of [10, 15, 30, 45, 60, 90, 120]) {
        const pick = el(quick, 'button', '', minutes < 60 ? `${minutes} мин` : `${minutes / 60} ч`)
        pick.type = 'button'
        pick.onclick = () => {
          const [h, m] = (from.value || clock(Math.ceil((moment().hour() * 60 + moment().minute()) / 10) * 10)).split(':').map(Number)
          from.value = clock(h * 60 + m)
          to.value = clock(Math.min(24 * 60 - 1, h * 60 + m + minutes))
        }
      }
      let done: HTMLInputElement | null = null
      if (block.status !== null) {
        const wrap = el(form, 'label', 'day-dialog-check')
        done = el(wrap, 'input')
        done.type = 'checkbox'
        done.checked = isDone(block)
        el(wrap, 'span', '', 'Выполнено')
      }
      el(form, 'p', 'day-dialog-note', `${paths.basename(file).replace(/\.md$/, '')}, строка ${block.line + 1}`)
      const buttons = el(form, 'div', 'day-dialog-buttons')
      const action = (text: string, className: string, run?: () => void) => {
        const button = el(buttons, 'button', className, text)
        button.type = 'button'
        button.onclick = () => (run ? (dialog.close(), run()) : save())
      }
      action('Удалить', 'danger', () => void rewrite(file, block, () => null))
      action('Открыть в заметке', '', () => app.workspace.openFile(file, { line: block.line }))
      el(buttons, 'span', 'day-dialog-grow')
      action('Отмена', '', () => {})
      action('Сохранить', 'primary')
      const save = () => {
        const minutes = (value: string) => (/^\d{1,2}:\d{2}$/.test(value) ? Number(value.split(':')[0]) * 60 + Number(value.split(':')[1]) : null)
        const start = minutes(from.value)
        const ending = minutes(to.value)
        dialog.close()
        void rewrite(file, block, (raw) => {
          const m = LINE.exec(raw)
          const loose = m ? null : LOOSE.exec(raw)
          const prefix = m ? m[1] : loose ? loose[1] : /^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(raw)?.[1]
          if (prefix === undefined) return raw
          const status = m ? m[2] : loose?.[2]
          const before = (m ? m[8] : (loose?.[3] ?? '')).trim()
          // The day it was done stays as written unless the tick is changed below.
          const text = `${what.value.trim()}${marker.exec(before)?.[0] ?? ''}`
          const end = start === null ? null : ending !== null && ending > start ? ending : start + Math.max(5, get<number>('defaultDurationMinutes') ?? 30)
          const time = start === null ? '' : `${clock(start)}${m?.[5] ?? ' - '}${clock(end!)} `
          const line = `${prefix}${status !== undefined ? `[${status}] ` : ''}${time}${text}`
          return done && done.checked !== (status !== undefined && status !== ' ') ? toggle(line) : line
        })
      }
      // Enter in a field saves, as the button does.
      form.onsubmit = (event) => (event.preventDefault(), save())
      form.onkeydown = (event) => event.key === 'Enter' && (event.target as Element).tagName === 'INPUT' && (event.preventDefault(), save())
      dialog.onclick = (event) => event.target === dialog && dialog.close()
      dialog.onclose = () => dialog.remove()
      dialog.showModal()
      what.focus()
      what.select()
    }

    // ---- the timeline: a widget of a sidebar, and (like every widget) a tab when asked
    this.addPanel({
      id: PANEL,
      title: 'План дня',
      side: 'right',
      icon: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 0 0 0-11zM8 5v3l2 1.5',
      mount: (target) => {
        const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = '') => {
          const node = parent.appendChild(document.createElement(tag))
          if (className) node.className = className
          if (text) node.textContent = text
          return node
        }
        const root = el(target, 'div', 'day-plan')
        let day = moment().startOf('day')
        let scrolled = false
        /** While a block is being dragged the picture is not drawn again under it. */
        let busy = false
        /** The notes now on the screen: a change in one of them draws the plan again. */
        let shown = new Set<string>()
        // A tab has room for a week; a sidebar remembers a choice of its own.
        const place = () => (root.closest('.leaf') ? 'viewTab' : 'viewSide')
        const mode = (): Mode => {
          const kept = get<string>(place())
          return MODES.some((one) => one.id === kept) ? (kept as Mode) : 'day'
        }
        /** The days a mode shows around a day. */
        const daysOf = (kind: Mode): Moment[] => {
          const first = kind === 'week' ? day.clone().startOf('week') : kind === 'month' ? day.clone().startOf('month').startOf('week') : day.clone()
          const count = kind === 'day' ? 1 : kind === 'three' ? 3 : kind === 'week' ? 7 : 42
          return Array.from({ length: count }, (_, i) => first.clone().add(i, 'day'))
        }

        const draw = () => {
          if (busy) return
          const keep = root.querySelector('.day-plan-scroll')?.scrollTop
          root.replaceChildren()
          const kind = mode()
          root.dataset.mode = kind
          const now = moment()
          const today = day.isSame(now, 'day')
          const file = noteOf(day)
          const days = daysOf(kind).map((date) => {
            const note = noteOf(date)
            const { blocks: all, loose } = read(note)
            return { date, note, all, loose, blocks: get<boolean>('showCompletedTasks') === false ? all.filter((block) => !isDone(block)) : all }
          })
          shown = new Set(days.flatMap((one) => (one.note ? [one.note] : [])))

          const head = el(root, 'div', 'day-plan-head')
          const button = (icon: string, title: string, action: () => void) => {
            const node = el(head, 'button')
            node.title = title
            node.setAttribute('aria-label', title)
            node.append(app.icons.draw(icon))
            node.onclick = action
          }
          const go = (to: Moment) => {
            day = to.startOf('day')
            scrolled = false
            draw()
          }
          const show = (next: Mode, at?: Moment) => {
            if (at) day = at.clone().startOf('day')
            scrolled = false
            // Saving the choice draws the plan again by itself.
            if (get<string>(place()) === next) draw()
            else this.setSetting(place(), next)
          }
          const step: [number, 'day' | 'week' | 'month'] = kind === 'day' ? [1, 'day'] : kind === 'three' ? [3, 'day'] : kind === 'week' ? [1, 'week'] : [1, 'month']
          const last = days[days.length - 1].date
          const caption =
            kind === 'day'
              ? day.format('D MMMM, dddd')
              : kind === 'month'
                ? day.format('MMMM YYYY')
                : days[0].date.isSame(last, 'month')
                  ? `${days[0].date.format('D')}–${last.format('D MMMM')}`
                  : `${days[0].date.format('D MMM')} – ${last.format('D MMM')}`
          const holdsToday = kind === 'month' ? day.isSame(now, 'month') : days.some((one) => one.date.isSame(now, 'day'))
          button('chevron-left', 'Назад', () => go(day.clone().subtract(step[0], step[1])))
          const name = el(head, 'span', holdsToday ? 'day-plan-date today' : 'day-plan-date', caption)
          name.title = kind === 'day' ? (file ?? 'Заметки этого дня ещё нет') : caption
          button('chevron-right', 'Вперёд', () => go(day.clone().add(step[0], step[1])))
          button('calendar-check', 'Сегодня', () => go(moment()))
          button('file-text', 'Открыть заметку дня', () => (file ? app.workspace.openFile(file) : void addBlock(day, Math.ceil((moment().hour() * 60 + moment().minute()) / 10) * 10)))
          button('plus', 'Новый блок на ближайшее время', () => void addBlock(day, today ? Math.ceil((moment().hour() * 60 + moment().minute()) / 10) * 10 : (get<number>('startHour') ?? 6) * 60 + 180))

          // ---- day, three days, week, month
          const modes = el(root, 'div', 'day-plan-modes')
          modes.setAttribute('role', 'tablist')
          for (const one of MODES) {
            const tab = el(modes, 'button', one.id === kind ? 'on' : '', one.name)
            tab.setAttribute('role', 'tab')
            tab.setAttribute('aria-selected', String(one.id === kind))
            tab.onclick = () => show(one.id)
          }

          const period = kind === 'month' ? days.filter((one) => one.date.isSame(day, 'month')) : days
          const timed = period.flatMap((one) => one.all.filter((block) => block.status !== null))
          if (timed.length) {
            const bar = el(el(root, 'div', 'day-plan-progress'), 'div')
            bar.style.width = `${Math.round((timed.filter(isDone).length / timed.length) * 100)}%`
            bar.parentElement!.title = `Выполнено ${timed.filter(isDone).length} из ${timed.length}`
          }

          const text = (parent: HTMLElement, block: Block, note: string | null) => {
            const node = el(parent, 'span', 'day-block-text')
            node.append(renderInline(app, block.text.replace(/\s*✅️?\s*\d{4}-\d{2}-\d{2}/u, ''), note ?? ''))
          }
          const box = (parent: HTMLElement, block: Block, note: string | null) => {
            if (block.status === null) return
            const tick = el(parent, 'input')
            tick.type = 'checkbox'
            tick.checked = isDone(block)
            tick.setAttribute('aria-label', 'Выполнено')
            tick.onpointerdown = (event) => event.stopPropagation()
            tick.onclick = (event) => event.stopPropagation()
            tick.onchange = () => note && void rewrite(note, block, toggle)
          }

          // ---- a month: the days as cells, each with the lines of its plan
          if (kind === 'month') {
            const names = el(root, 'div', 'day-plan-days')
            for (const one of days.slice(0, 7)) el(names, 'span', '', one.date.format('dd'))
            const month = el(root, 'div', 'day-plan-month')
            for (const one of days) {
              const cell = el(month, 'div', `day-cell${one.date.isSame(day, 'month') ? '' : ' other'}${one.date.isSame(now, 'day') ? ' today' : ''}`)
              const number = el(cell, 'button', 'day-cell-date', one.date.format('D'))
              number.title = one.date.format('D MMMM, dddd')
              number.onclick = () => show('day', one.date)
              // A line can be carried to another day of the month.
              cell.ondragover = (event) => event.dataTransfer?.types.includes(DRAG) && (event.preventDefault(), cell.classList.add('drop'))
              cell.ondragleave = () => cell.classList.remove('drop')
              cell.ondrop = (event) => {
                cell.classList.remove('drop')
                const [from, index] = (event.dataTransfer?.getData(DRAG) ?? '').split('\n')
                const source = days.find((other) => other.note === from)
                const block = source?.blocks[Number(index)]
                if (!block || !from || source === one) return
                event.preventDefault()
                void moveBlock(from, block, one.date, block.start, block.end)
              }
              for (const block of one.blocks) {
                const row = el(cell, 'div', isDone(block) ? 'day-line done' : 'day-line')
                row.draggable = !!one.note
                row.ondragstart = (event) => event.dataTransfer?.setData(DRAG, `${one.note}\n${one.blocks.indexOf(block)}`)
                el(row, 'span', 'day-block-time', clock(block.start))
                text(row, block, one.note)
                row.title = `${clock(block.start)}–${clock(block.end)} ${block.text}`
                row.onclick = (event) => !(event.target as Element).closest('a') && one.note && editBlock(one.note, block)
              }
              cell.ondblclick = (event) => !(event.target as Element).closest('.day-line, button') && void addBlock(one.date, (get<number>('startHour') ?? 6) * 60 + 180)
            }
            scrolled = true
            return
          }

          const loose = days[0].loose
          if (kind === 'day' && get<boolean>('showUncheduledTasks') !== false && loose.length) {
            const list = el(root, 'div', 'day-plan-loose')
            for (const block of loose.filter((one) => get<boolean>('showCompletedTasks') !== false || !isDone(one))) {
              const row = el(list, 'div', isDone(block) ? 'day-block done' : 'day-block')
              box(row, block, file)
              text(row, block, file)
              row.onclick = (event) => !(event.target as Element).closest('a, input') && file && editBlock(file, block)
            }
          }
          // Several days stand side by side, each under its name; the name opens that day alone.
          if (days.length > 1) {
            const names = el(root, 'div', 'day-plan-days scaled')
            for (const one of days) {
              const title = el(names, 'button', one.date.isSame(now, 'day') ? 'today' : '', one.date.format('dd, D'))
              title.title = one.date.format('D MMMM, dddd')
              title.onclick = () => show('day', one.date)
            }
          }

          // ---- the scale
          const from = Math.min(Math.max(0, get<number>('startHour') ?? 6), 23) * 60
          const firsts = days.flatMap((one) => (one.blocks.length ? [Math.floor(one.blocks[0].start / 60) * 60] : []))
          const top = Math.min(from, ...firsts)
          const perMinute = (28 + 14 * Math.min(4, Math.max(1, get<number>('zoomLevel') ?? 2))) / 60
          const snap = Math.max(1, get<number>('snapStepMinutes') ?? 10)
          const least = Math.max(5, get<number>('minimalDurationMinutes') ?? 10)
          const scroll = el(root, 'div', 'day-plan-scroll')
          const grid = el(scroll, 'div', 'day-plan-grid')
          grid.style.height = `${(24 * 60 - top) * perMinute}px`
          for (let hour = Math.ceil(top / 60); hour < 24; hour++) {
            const mark = el(grid, 'div', 'day-hour')
            mark.style.top = `${(hour * 60 - top) * perMinute}px`
            el(mark, 'span', '', `${hour}:00`)
          }
          if (!firsts.length) el(grid, 'div', 'day-plan-empty', kind !== 'day' ? 'В эти дни нет строк со временем. Двойной щелчок по шкале добавит блок' : file ? 'В заметке дня нет строк со временем. Двойной щелчок по шкале добавит блок' : 'Заметки этого дня ещё нет. Двойной щелчок по шкале создаст её и добавит блок')

          const nowMinutes = now.hour() * 60 + now.minute()
          const cols = el(grid, 'div', 'day-plan-cols')
          for (const one of days) {
            const { blocks, note } = one
            const isToday = one.date.isSame(now, 'day')
            const col = el(cols, 'div', isToday ? 'day-plan-col today' : 'day-plan-col')

            // Blocks that overlap in time stand side by side.
            const columns: Block[][] = []
            const placed = new Map<Block, { column: number; of: number }>()
            let group: Block[] = []
            let groupEnd = -1
            const close = () => {
              for (const block of group) placed.get(block)!.of = columns.length
              columns.length = 0
              group = []
            }
            for (const block of blocks) {
              if (group.length && block.start >= groupEnd) close()
              let column = columns.findIndex((list) => list[list.length - 1].end <= block.start)
              if (column < 0) column = columns.push([]) - 1
              columns[column].push(block)
              placed.set(block, { column, of: 1 })
              group.push(block)
              groupEnd = Math.max(groupEnd, block.end)
            }
            close()

            for (const block of blocks) {
              const { column, of } = placed.get(block)!
              const node = el(col, 'div', `day-block${isDone(block) ? ' done' : ''}${isToday && nowMinutes >= block.start && nowMinutes < block.end ? ' now' : ''}`)
              const put = (start: number, end: number) => {
                node.style.top = `${(start - top) * perMinute}px`
                node.style.height = `${Math.max(22, (end - start) * perMinute - 1)}px`
                time.textContent = days.length > 3 ? clock(start) : `${clock(start)}–${clock(end)}`
              }
              node.style.left = `${(column / of) * 100}%`
              node.style.width = `calc(${100 / of}% - 4px)`
              box(node, block, note)
              const time = el(node, 'span', 'day-block-time')
              text(node, block, note)
              put(block.start, block.end)
              const handle = el(node, 'div', 'day-block-size')
              node.title = `${clock(block.start)}–${clock(block.end)} ${block.text}`

              // Dragging the block moves it in time; dragging its lower edge makes it longer or shorter.
              node.onpointerdown = (event) => {
                if (event.button !== 0 || (event.target as Element).closest('a, input')) return
                const resizing = event.target === handle
                const startX = event.clientX
                const startY = event.clientY
                let start = block.start
                let end = block.end
                let moved = false
                // Where several days stand side by side, a block can be carried sideways to another day.
                const columns = [...cols.children].map((one) => one.getBoundingClientRect())
                const own = days.indexOf(one)
                let target = own
                node.setPointerCapture(event.pointerId)
                const move = (e: PointerEvent) => {
                  const by = Math.round((e.clientY - startY) / perMinute / snap) * snap
                  if (!moved && Math.abs(e.clientY - startY) < 4 && Math.abs(e.clientX - startX) < 4) return
                  moved = busy = true
                  node.classList.add('moving')
                  if (resizing) end = Math.min(24 * 60, Math.max(block.start + least, block.end + by))
                  else {
                    start = Math.min(24 * 60 - (block.end - block.start), Math.max(0, block.start + by))
                    end = start + (block.end - block.start)
                    if (columns.length > 1) {
                      const over = columns.findIndex((rect) => e.clientX >= rect.left && e.clientX < rect.right)
                      target = over < 0 ? target : over
                      node.style.transform = `translateX(${columns[target].left - columns[own].left}px)`
                    }
                  }
                  put(start, end)
                }
                const up = () => {
                  node.removeEventListener('pointermove', move)
                  node.classList.remove('moving')
                  busy = false
                  if (!moved) return void (note && editBlock(note, block))
                  if (note && target !== own) void moveBlock(note, block, days[target].date, start, end)
                  else if (note && (start !== block.start || end !== block.end)) void rewrite(note, block, (raw) => retime(raw, start, end))
                  else draw()
                }
                node.addEventListener('pointermove', move)
                node.addEventListener('pointerup', up, { once: true })
                node.addEventListener('pointercancel', up, { once: true })
              }
            }
            // A double click on an empty place of a day's scale makes a block there.
            col.ondblclick = (event) => {
              if ((event.target as Element).closest('.day-block')) return
              const minutes = top + (event.clientY - grid.getBoundingClientRect().top) / perMinute
              void addBlock(one.date, Math.max(0, Math.min(23 * 60 + 30, Math.round(minutes / snap) * snap)))
            }
            if (isToday) {
              const needle = el(col, 'div', 'day-now')
              needle.style.top = `${(nowMinutes - top) * perMinute}px`
            }
          }
          // The first time a day is shown, the scale opens at now (or at the first block of another day).
          if (keep !== undefined && scrolled) scroll.scrollTop = keep
          else {
            const aim = holdsToday && get<boolean>('centerNeedle') !== false ? nowMinutes : firsts.length ? Math.min(...days.flatMap((one) => (one.blocks.length ? [one.blocks[0].start] : []))) : from
            scroll.scrollTop = Math.max(0, (aim - top) * perMinute - scroll.clientHeight / 3)
            // Not while the scale has no size yet (its tab or sidebar is still hidden): then it is aimed again when shown.
            scrolled = scroll.clientHeight > 0
          }
        }

        draw()
        let later: ReturnType<typeof setTimeout> | undefined
        const soon = () => {
          clearTimeout(later)
          later = setTimeout(draw, 150)
        }
        const offs = [app.metadata.on('changed', (file) => shown.has(file) && soon()), app.vault.on('create', soon), app.vault.on('delete', soon), app.settings.on('change', (scope) => scope === this.manifest.id && draw())]
        // The needle moves, and at midnight "today" becomes another day.
        const timer = setInterval(() => {
          if (!root.isConnected || root.closest('[hidden]')) return
          draw()
        }, 60_000)
        // The scale may have been laid out while hidden; it finds "now" when first shown.
        const seen = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && !scrolled && draw())
        seen.observe(root)
        return () => {
          clearTimeout(later)
          clearInterval(timer)
          seen.disconnect()
          offs.forEach((off) => off())
          root.remove()
        }
      },
    })

    // ---- the status bar: what is on now and what comes next
    const status = this.addStatusBarItem()
    status.classList.add('day-plan-status')
    status.title = 'План дня'
    status.onclick = () => app.panels.reveal(PANEL)
    const tell = () => {
      status.hidden = get<boolean>('showActiveClockInStatusBar') === false
      if (status.hidden) return
      const now = moment().hour() * 60 + moment().minute()
      const open = read(noteOf(moment())).blocks.filter((block) => !isDone(block))
      const current = open.find((block) => now >= block.start && now < block.end)
      const next = open.find((block) => block.start > now)
      const short = (block: Block) => block.text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\s*✅.*$/u, '').slice(0, 40)
      status.textContent = current ? `▶ ${short(current)} до ${clock(current.end)}` : next ? `Далее в ${clock(next.start)}: ${short(next)}` : ''
      status.hidden = !status.textContent
    }
    tell()
    const ticking = setInterval(tell, 30_000)
    this.register(() => clearInterval(ticking))
    this.register(app.metadata.on('changed', (file) => file === noteOf(moment()) && tell()))
    this.onSettingChange(tell)

    this.addCommand({ id: 'add-block', name: 'Добавить блок в план на сегодня', icon: 'calendar-plus', scope: 'vault', callback: () => void addBlock(moment().startOf('day'), Math.ceil((moment().hour() * 60 + moment().minute()) / 10) * 10) })
    this.addCommand({ id: 'import', name: 'Взять настройки плана дня из Obsidian (Day Planner)', icon: 'import', callback: () => void this.importFromObsidian(true) })
    this.addInsertCommand('insert-block', 'Вставить блок плана дня', `- [ ] ${clock(9 * 60)} - ${clock(9 * 60 + 30)} |`, 'clock')
  }

  /** Takes the settings of the Day Planner plugin from the vault, once by itself and again on request. */
  private async importFromObsidian(asked: boolean): Promise<void> {
    const { app } = this
    if (!asked && this.getSetting<boolean>('imported')) return
    this.setSetting('imported', true)
    let data: Record<string, unknown> | null = null
    try {
      const text = await app.vault.readOptional(`${app.obsidianConfig ?? '.obsidian'}/plugins/obsidian-day-planner/data.json`)
      data = text ? (JSON.parse(text) as Record<string, unknown>) : null
    } catch {
      data = null
    }
    if (!data) {
      if (asked) app.notice('В хранилище не найдены настройки Day Planner')
      return
    }
    for (const key of ['plannerHeading', 'plannerHeadingLevel', 'defaultDurationMinutes', 'startHour', 'zoomLevel', 'snapStepMinutes', 'minimalDurationMinutes', 'centerNeedle', 'showCompletedTasks', 'showUncheduledTasks', 'showActiveClockInStatusBar']) {
      if (key in data && ['string', 'number', 'boolean'].includes(typeof data[key])) this.setSetting(key, data[key])
    }
    // There a new block is a task when its status is a space, and plain text when it is empty.
    if (typeof data.eventFormatOnCreation === 'string') this.setSetting('taskStatusOnCreation', data.eventFormatOnCreation === 'task')
    if (asked) app.notice('Настройки плана дня взяты из Obsidian')
  }
}
