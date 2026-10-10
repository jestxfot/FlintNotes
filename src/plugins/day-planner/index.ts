import { errorMessage, moment, path as paths, Plugin, renderInline, type Moment } from '../../api'
import './style.css'

const PANEL = 'day-planner'
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
    const addBlock = async (day: Moment, start: number, textOf = '') => {
      try {
        const file = noteOf(day) ?? (await periodic()?.ensure('daily', day)) ?? null
        if (!file) return app.notice('Нет заметки этого дня. Включите плагин «Календарь» или создайте заметку с датой в названии')
        await app.workspace.flushAll()
        const text = await app.vault.read(file)
        const eol = text.includes('\r\n') ? '\r\n' : '\n'
        const lines = text.split(/\r?\n/)
        const title = (get<string>('plannerHeading') ?? 'Day planner').trim()
        const line = `- ${get<boolean>('taskStatusOnCreation') === false ? '' : '[ ] '}${clock(start)} - ${clock(start + Math.max(5, get<number>('defaultDurationMinutes') ?? 30))} ${textOf}`
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

        const draw = () => {
          if (busy) return
          const keep = root.querySelector('.day-plan-scroll')?.scrollTop
          root.replaceChildren()
          const today = day.isSame(moment(), 'day')
          const file = noteOf(day)
          const { blocks: all, loose } = read(file)
          const blocks = get<boolean>('showCompletedTasks') === false ? all.filter((block) => !isDone(block)) : all

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
          button('chevron-left', 'Предыдущий день', () => go(day.clone().subtract(1, 'day')))
          const name = el(head, 'span', today ? 'day-plan-date today' : 'day-plan-date', day.format('D MMMM, dddd'))
          name.title = file ?? 'Заметки этого дня ещё нет'
          button('chevron-right', 'Следующий день', () => go(day.clone().add(1, 'day')))
          button('calendar-check', 'Сегодня', () => go(moment()))
          button('file-text', 'Открыть заметку дня', () => (file ? app.workspace.openFile(file) : void addBlock(day, Math.ceil((moment().hour() * 60 + moment().minute()) / 10) * 10)))
          button('plus', 'Новый блок на ближайшее время', () => void addBlock(day, today ? Math.ceil((moment().hour() * 60 + moment().minute()) / 10) * 10 : (get<number>('startHour') ?? 6) * 60 + 180))

          const timed = all.filter((block) => block.status !== null)
          if (timed.length) {
            const bar = el(el(root, 'div', 'day-plan-progress'), 'div')
            bar.style.width = `${Math.round((timed.filter(isDone).length / timed.length) * 100)}%`
            bar.parentElement!.title = `Выполнено ${timed.filter(isDone).length} из ${timed.length}`
          }

          const text = (parent: HTMLElement, block: Block) => {
            const node = el(parent, 'span', 'day-block-text')
            node.append(renderInline(app, block.text.replace(/\s*✅️?\s*\d{4}-\d{2}-\d{2}/u, ''), file ?? ''))
          }
          const box = (parent: HTMLElement, block: Block) => {
            if (block.status === null) return
            const tick = el(parent, 'input')
            tick.type = 'checkbox'
            tick.checked = isDone(block)
            tick.setAttribute('aria-label', 'Выполнено')
            tick.onpointerdown = (event) => event.stopPropagation()
            tick.onclick = (event) => event.stopPropagation()
            tick.onchange = () => file && void rewrite(file, block, toggle)
          }
          if (get<boolean>('showUncheduledTasks') !== false && loose.length) {
            const list = el(root, 'div', 'day-plan-loose')
            for (const block of loose.filter((one) => get<boolean>('showCompletedTasks') !== false || !isDone(one))) {
              const row = el(list, 'div', isDone(block) ? 'day-block done' : 'day-block')
              box(row, block)
              text(row, block)
              row.onclick = (event) => !(event.target as Element).closest('a, input') && file && app.workspace.openFile(file, { line: block.line })
            }
          }

          // ---- the scale
          const from = Math.min(Math.max(0, get<number>('startHour') ?? 6), 23) * 60
          const firstBlock = blocks.length ? Math.floor(blocks[0].start / 60) * 60 : from
          const top = Math.min(from, firstBlock)
          const perMinute = (28 + 14 * Math.min(4, Math.max(1, get<number>('zoomLevel') ?? 2))) / 60
          const snap = Math.max(1, get<number>('snapStepMinutes') ?? 10)
          const least = Math.max(5, get<number>('minimalDurationMinutes') ?? 10)
          const scroll = el(root, 'div', 'day-plan-scroll')
          const grid = el(scroll, 'div', 'day-plan-grid')
          grid.style.height = `${(24 * 60 - top) * perMinute}px`
          for (let hour = Math.ceil(top / 60); hour < 24; hour++) {
            const mark = el(grid, 'div', 'day-hour')
            mark.style.top = `${(hour * 60 - top) * perMinute}px`
            el(mark, 'span', '', String(hour))
          }
          if (!blocks.length) el(grid, 'div', 'day-plan-empty', file ? 'В заметке дня нет строк со временем. Двойной щелчок по шкале добавит блок' : 'Заметки этого дня ещё нет. Двойной щелчок по шкале создаст её и добавит блок')

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
            let column = columns.findIndex((one) => one[one.length - 1].end <= block.start)
            if (column < 0) column = columns.push([]) - 1
            columns[column].push(block)
            placed.set(block, { column, of: 1 })
            group.push(block)
            groupEnd = Math.max(groupEnd, block.end)
          }
          close()

          const nowMinutes = moment().hour() * 60 + moment().minute()
          for (const block of blocks) {
            const { column, of } = placed.get(block)!
            const node = el(grid, 'div', `day-block${isDone(block) ? ' done' : ''}${today && nowMinutes >= block.start && nowMinutes < block.end ? ' now' : ''}`)
            const place = (start: number, end: number) => {
              node.style.top = `${(start - top) * perMinute}px`
              node.style.height = `${Math.max(18, (end - start) * perMinute - 1)}px`
              time.textContent = `${clock(start)}–${clock(end)}`
            }
            node.style.left = `${(column / of) * 100}%`
            node.style.width = `calc(${100 / of}% - 4px)`
            box(node, block)
            const time = el(node, 'span', 'day-block-time')
            text(node, block)
            place(block.start, block.end)
            const handle = el(node, 'div', 'day-block-size')
            node.title = `${clock(block.start)}–${clock(block.end)} ${block.text}`

            // Dragging the block moves it in time; dragging its lower edge makes it longer or shorter.
            node.onpointerdown = (event) => {
              if (event.button !== 0 || (event.target as Element).closest('a, input')) return
              const resizing = event.target === handle
              const startY = event.clientY
              let start = block.start
              let end = block.end
              let moved = false
              node.setPointerCapture(event.pointerId)
              const move = (e: PointerEvent) => {
                const by = Math.round((e.clientY - startY) / perMinute / snap) * snap
                if (!moved && Math.abs(e.clientY - startY) < 4) return
                moved = busy = true
                node.classList.add('moving')
                if (resizing) end = Math.min(24 * 60, Math.max(block.start + least, block.end + by))
                else {
                  start = Math.min(24 * 60 - (block.end - block.start), Math.max(0, block.start + by))
                  end = start + (block.end - block.start)
                }
                place(start, end)
              }
              const up = () => {
                node.removeEventListener('pointermove', move)
                node.classList.remove('moving')
                busy = false
                if (!moved) return void (file && app.workspace.openFile(file, { line: block.line }))
                if (file && (start !== block.start || end !== block.end)) void rewrite(file, block, (raw) => retime(raw, start, end))
                else draw()
              }
              node.addEventListener('pointermove', move)
              node.addEventListener('pointerup', up, { once: true })
              node.addEventListener('pointercancel', up, { once: true })
            }
          }
          // A double click on an empty place of the scale makes a block there.
          grid.ondblclick = (event) => {
            if ((event.target as Element).closest('.day-block')) return
            const minutes = top + (event.clientY - grid.getBoundingClientRect().top) / perMinute
            void addBlock(day, Math.max(0, Math.min(23 * 60 + 30, Math.round(minutes / snap) * snap)))
          }

          if (today) {
            const needle = el(grid, 'div', 'day-now')
            needle.style.top = `${(nowMinutes - top) * perMinute}px`
          }
          // The first time a day is shown, the scale opens at now (or at the first block of another day).
          if (keep !== undefined && scrolled) scroll.scrollTop = keep
          else {
            const aim = today && get<boolean>('centerNeedle') !== false ? nowMinutes : (blocks[0]?.start ?? from)
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
        const offs = [app.metadata.on('changed', (file) => file === noteOf(day) && soon()), app.vault.on('create', soon), app.vault.on('delete', soon), app.settings.on('change', (scope) => scope === this.manifest.id && draw())]
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
