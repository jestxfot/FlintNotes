import { path as paths, renderInline, type Off, type Plugin } from '../../api'
import { desktop } from '../../core/desktop'
import { Signal, type Repeat } from './sound'
import { fromIso, iso } from './dates'
import { dueReminders, isQuiet, plannedTime, reminderSettings, timedReminders, type Due, type ReminderSettings } from './due'
import { daysChip } from './days-left'
import type { TaskStore } from './store'
import type { AlertAction, AlertModel } from '../../../shared/reminders'
import { formatTaskLine, movePlainReminder, NO_PRIORITY, parseTaskLine, type Task } from './task'

export { plannedTime, type Due }

const MINUTE = 60_000
const CHECK_EVERY = 15_000
const FORGET_AFTER = 60 * 24 * 60 * MINUTE

/**
 * A track with a handle: sliding it to the end does the work, anything less and it goes back. A click does
 * nothing. The arrow keys work too, in five steps. (The reminders window of the desktop app has its own
 * copy of this in desktop/pages/alert.js.)
 */
export function slideConfirm(label: string, done: () => void): HTMLElement {
  const track = document.createElement('div')
  track.className = 'alert-slide'
  track.setAttribute('role', 'slider')
  track.setAttribute('aria-label', label)
  track.setAttribute('aria-valuemin', '0')
  track.setAttribute('aria-valuemax', '100')
  track.setAttribute('aria-valuenow', '0')
  track.tabIndex = 0
  const text = document.createElement('div')
  text.className = 'alert-slide-label'
  text.textContent = label
  const handle = document.createElement('div')
  handle.className = 'alert-slide-handle'
  handle.textContent = '›'
  track.append(text, handle)
  let value = 0
  let start = 0
  let dragging = false
  const room = () => Math.max(1, track.clientWidth - 38)
  const set = (next: number) => {
    value = Math.max(0, Math.min(1, next))
    track.style.setProperty('--slide', String(value))
    track.setAttribute('aria-valuenow', String(Math.round(value * 100)))
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    dragging = true
    track.classList.remove('back')
    start = event.clientX - value * room()
    handle.setPointerCapture(event.pointerId)
  })
  handle.addEventListener('pointermove', (event) => dragging && set((event.clientX - start) / room()))
  for (const type of ['pointerup', 'pointercancel']) {
    handle.addEventListener(type, () => {
      if (!dragging) return
      dragging = false
      if (value >= 0.95) return done()
      track.classList.add('back')
      set(0)
    })
  }
  track.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') set(value + 0.2)
    else if (event.key === 'ArrowLeft') set(value - 0.2)
    else if (event.key === 'Escape') set(0)
    else return
    event.preventDefault()
    if (value >= 1) done()
  })
  return track
}

/** A task with a priority raised above the ordinary: putting it off must be confirmed by a slide. */
const laterLabel = (label: string) => `Через ${label}`.replace(/^Через (через|завтра|послезавтра|in |tomorrow|next )/i, '$1').replace(/^./, (c) => c.toUpperCase())
const urgent = (task: Task) => task.priority < NO_PRIORITY

const pad = (n: number) => String(n).padStart(2, '0')
/** A moment as reminders are written: `2026-10-10 14:00`. */
export const stamp = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`

/**
 * When "remind me later: <option>" is. Options are written in the settings in
 * plain words, in Russian or as the Reminder plugin has them: `10 минут`,
 * `1 час`, `Завтра`, `Через неделю`, `In 30 minutes`, `Tomorrow`, `Next week`.
 * `null` if the words are not understood.
 */
export function laterTime(option: string, morning = '09:00', now = new Date()): Date | null {
  const text = option.trim().toLowerCase().replace(/^(через|in)\s+/, '')
  const [hours, minutes] = morning.split(':').map(Number)
  const day = (offset: number) => {
    const date = new Date(now)
    date.setDate(date.getDate() + offset)
    date.setHours(hours || 9, minutes || 0, 0, 0)
    return date
  }
  if (/^(завтра|tomorrow)/.test(text)) return day(1)
  if (/^(послезавтра)/.test(text)) return day(2)
  if (/^(неделю|next week|недел)/.test(text)) return day(7)
  if (/^(месяц|next month)/.test(text)) return day(30)
  const amount = /^(\d+)\s*(мин|min|m\b|час|hour|h\b|дн|день|day|d\b|нед|week|w\b)/.exec(text)
  if (!amount) return null
  const unit = amount[2]
  const count = Number(amount[1])
  if (/^(дн|день|day|d)/.test(unit)) return day(count)
  if (/^(нед|week|w)/.test(unit)) return day(count * 7)
  return new Date(now.getTime() + count * (/^(час|hour|h)/.test(unit) ? 60 : 1) * MINUTE)
}

/** A short, hard-to-miss signal: three rising beeps, made with the Web Audio API. */
/**
 * Watches the tasks and, when one is due, shows a card in the bottom right corner
 * of the program (on top of other windows on the desktop). It stays, and keeps
 * beeping, until each task in it is completed or put off: there is no way to
 * close it, and a priority task asks for confirmation before it is put off.
 */
export class Reminders {
  private dialog: HTMLDialogElement | null = null
  private beeper = new Signal()
  private shown = ''
  private title = document.title
  private flash: ReturnType<typeof setInterval> | undefined

  constructor(
    private plugin: Plugin,
    private store: TaskStore,
  ) {}

  start(): Off {
    const check = () => this.check()
    // Electron supplies ticks from its main process, even in the tray. In a browser,
    // a worker avoids the background tab's usual timer throttling.
    let ticker: Worker | null = null
    try {
      if (!desktop) {
        const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${CHECK_EVERY})`], { type: 'text/javascript' }))
        ticker = new Worker(url)
        URL.revokeObjectURL(url)
        ticker.onmessage = check
      }
    } catch {
      ticker = null
    }
    const timer = ticker || desktop ? undefined : setInterval(check, CHECK_EVERY)
    const offTick = desktop?.onReminderTick(check)
    const off = this.store.on('change', check)
    const offSettings = this.plugin.app.settings.on('change', (scope) => {
      if (scope === this.plugin.manifest.id) check()
    })
    const offAction = desktop?.onReminderAction?.((action) => this.act(action))
    document.addEventListener('visibilitychange', check)
    check()
    return () => {
      clearInterval(timer)
      ticker?.terminate()
      off()
      offSettings()
      offTick?.()
      offAction?.()
      document.removeEventListener('visibilitychange', check)
      this.close()
    }
  }

  private setting<T>(key: string): T {
    return this.plugin.getSetting<T>(key)
  }

  /** What may remind: every task, and ordinary lines with a reminder unless the settings leave those out. */
  private candidates(): Task[] {
    return this.setting<boolean>('remindPlain') === false ? this.store.all() : [...this.store.all(), ...this.store.plain()]
  }

  private marks(key: 'acknowledged' | 'snoozed'): Record<string, number> {
    return { ...(this.setting<Record<string, number> | undefined>(key) ?? {}) }
  }

  /** The settings that decide what reminds, as the plugin has them now. */
  private settings(): ReminderSettings {
    return reminderSettings(Object.fromEntries(['remindDue', 'defaultTime', 'planner', 'plannerOverdueDays', 'remindPlain', 'maxAgeDays', 'leadMinutes', 'muteUntil', 'quietFrom', 'quietTo', 'acknowledged', 'snoozed'].map((key) => [key, this.plugin.getSetting(key)])))
  }

  /** Every open task that has a moment to remind at, soonest first, with what the user did about it. */
  private timed(): Due[] {
    return timedReminders(this.candidates(), this.settings(), Date.now())
  }

  /** Reminders whose time has come and that were neither handled nor postponed. */
  due(): Due[] {
    return dueReminders(this.timed(), this.settings(), Date.now())
  }

  private sound(): { kind: string; volume: number } {
    return { kind: this.setting<string>('soundKind') ?? 'glass', volume: Math.max(0, Math.min(100, this.setting<number>('volume') ?? 40)) / 100 }
  }

  /** Plays the chosen signal once. */
  playSound(): void {
    const { kind, volume } = this.sound()
    void this.beeper.play(kind, volume)
  }

  /** Whether alerts are held back right now: "do not disturb" was asked for, or it is the quiet time of day. */
  muted(): boolean {
    return isQuiet(this.settings(), new Date())
  }

  /** Holds alerts back for so many minutes; `0` lets them through again. */
  mute(minutes: number): void {
    this.plugin.setSetting('muteUntil', minutes > 0 ? Date.now() + minutes * MINUTE : 0)
    this.shown = ''
    this.check()
  }

  check(): void {
    const due = this.muted() || this.setting<string>('alertStyle') === 'off' ? [] : this.due()
    const signature = due.map((d) => d.key).join('\n')
    if (signature === this.shown) return
    this.shown = signature
    if (!due.length) {
      this.close()
      return
    }
    // The desktop app shows reminders in a window of its own, on top of everything; elsewhere the page draws the card.
    const own = !!desktop?.onReminderAction
    if (!own) this.render(due)
    desktop?.setReminders({
      items: due.map(({ key, task }) => ({ key, title: task.plain ? 'Напоминание' : 'Напоминание о задаче', body: task.description })),
      ...(own ? { model: this.model(due) } : {}),
    })
    if (this.setting<boolean>('sound')) {
      const { kind, volume } = this.sound()
      this.beeper.start(kind, volume, (this.setting<string>('soundRepeat') ?? 'few') as Repeat, this.setting<number>('repeatSeconds'))
    }
  }

  /** What the reminders window draws: the text as markup, and the colours of this page. */
  private model(due: Due[]): AlertModel {
    const { app } = this.plugin
    const style = getComputedStyle(document.documentElement)
    const theme = Object.fromEntries(['--bg', '--bg-hover', '--text', '--text-muted', '--text-faint', '--border', '--accent', '--accent-text', '--radius-m', '--radius-xl'].map((name) => [name, style.getPropertyValue(name).trim()]))
    return {
      theme: { ...theme, 'color-scheme': style.colorScheme || 'light dark' },
      later: this.laterOptions().map((option) => laterLabel(option.label)),
      items: due.map(({ key, task, at }) => {
        const text = document.createElement('div')
        text.append(renderInline(app, task.description, task.path))
        return {
          key,
          time: at.toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
          html: text.innerHTML,
          source: paths.stripExt(paths.basename(task.path)),
          statusHtml: daysChip(task.due ?? task.scheduled ?? iso(at), task.due || task.scheduled ? undefined : 'Напоминание').outerHTML,
          urgent: urgent(task),
          plain: !!task.plain,
        }
      }),
    }
  }

  /** What was chosen in the reminders window. Confirming a priority task's postponement was done there. */
  private act(action: AlertAction): void {
    const due = this.due()
    const one = 'key' in action ? due.find((d) => d.key === action.key) : undefined
    if (action.type === 'all-later') return this.snooze(due.map((d) => d.key), Date.now() + 10 * MINUTE)
    if (!one) return
    if (action.type === 'done') {
      this.acknowledge([one.key])
      if (!one.task.plain) void this.store.toggle(one.task)
    } else if (action.type === 'later') {
      const option = this.laterOptions()[action.option]
      if (option) this.later(one, option.at)
    } else this.plugin.app.workspace.openFile(one.task.path, { line: one.task.line })
  }

  private mark(kind: 'acknowledged' | 'snoozed', keys: string[], value: number): void {
    const marks = this.marks(kind)
    const now = Date.now()
    for (const [key, time] of Object.entries(marks)) if (now - time > FORGET_AFTER) delete marks[key]
    for (const key of keys) marks[key] = value
    this.plugin.setSetting(kind, marks)
    this.check()
  }

  private acknowledge(keys: string[]): void {
    this.mark('acknowledged', keys, Date.now())
  }

  /** Closes a reminder for good: it will not alert again. */
  dismiss(due: Due): void {
    this.acknowledge([due.key])
  }

  /** Brings a closed reminder back. */
  restore(due: Due): void {
    const marks = this.marks('acknowledged')
    delete marks[due.key]
    this.plugin.setSetting('acknowledged', marks)
    this.check()
  }

  /** The "later" choices, for lists that offer them. */
  choices(): { label: string; at: Date }[] {
    return this.laterOptions()
  }

  /** Reminds of it at another moment. */
  postpone(due: Due, at: Date): void {
    this.later(due, at)
  }

  private snooze(keys: string[], until: number): void {
    this.mark('snoozed', keys, until)
  }

  /** The "remind me later" choices from the settings, with the time each stands for. */
  private laterOptions(): { label: string; at: Date }[] {
    const morning = this.setting<string>('defaultTime') || '09:00'
    return (this.setting<string>('laterOptions') ?? '')
      .split('\n')
      .map((label) => ({ label: label.trim(), at: laterTime(label, morning) }))
      .filter((option): option is { label: string; at: Date } => !!option.label && !!option.at)
  }

  /**
   * Reminds of a task later. A task that carries its own reminder gets the new
   * time written into the note, as the Reminder plugin does, so it holds in
   * Obsidian too; a task that only has a due date is put off here alone.
   */
  private later(due: Due, at: Date): void {
    // A task that only has a due date, or a line of a day's plan, is put off here alone: its text stays as it is.
    if (!due.task.reminder || due.planned) return this.snooze([due.key], at.getTime())
    void this.store.edit(due.task, (raw) => {
      if (due.task.plain) return [movePlainReminder(raw, stamp(at))]
      const parsed = parseTaskLine(raw)
      return parsed ? [formatTaskLine({ ...parsed, reminder: stamp(at) }, parsed.prefix)] : [raw]
    })
  }

  /** Every open task that has a time to remind at, soonest first: what the reminders panel lists. */
  upcoming(): Due[] {
    return this.timed()
  }

  /** Until when a reminder is put off, if it is. */
  snoozedUntil(due: Due): number {
    const until = this.marks('snoozed')[due.key] ?? 0
    return until > Date.now() ? until : 0
  }

  private close(): void {
    desktop?.setReminders({ items: [] })
    this.beeper.stop()
    clearInterval(this.flash)
    this.flash = undefined
    document.title = this.title
    this.dialog?.remove()
    this.dialog = null
    this.shown = ''
  }

  /**
   * Asks again before a priority task is put off: its buttons are replaced by a
   * slider that has to be dragged to the end, so that a slip of the finger cannot skip it.
   * (Re-rendering is skipped while the list is unchanged, so this stays put.)
   */
  private confirmPutOff(actions: HTMLElement, what: string, run: () => void): void {
    const saved = [...actions.childNodes]
    const ask = document.createElement('span')
    ask.className = 'alert-confirm'
    ask.textContent = `${what}?`
    const yes = slideConfirm('Проведите, чтобы отложить', run)
    const no = document.createElement('button')
    no.className = 'primary'
    no.textContent = 'Нет, вернуться'
    no.onclick = () => actions.replaceChildren(...saved)
    actions.replaceChildren(ask, yes, no)
  }

  private render(due: Due[]): void {
    const { app } = this.plugin
    const dialog = (this.dialog ??= this.createDialog())
    dialog.dataset.count = String(due.length)
    const list = dialog.querySelector('.alert-list')!
    list.replaceChildren()

    const button = (label: string, className: string, action: (event: MouseEvent) => void) => {
      const el = document.createElement('button')
      el.textContent = label
      el.className = className
      el.onclick = action
      return el
    }

    const keys = due.map((d) => d.key)
    const footer = dialog.querySelector('.alert-footer') as HTMLElement
    for (const one of due) {
      const { key, task, at } = one
      const item = list.appendChild(document.createElement('div'))
      item.className = 'alert-task'
      const text = item.appendChild(document.createElement('div'))
      text.className = 'alert-text'
      text.append(renderInline(app, task.description, task.path))
      const status = daysChip(task.due ?? task.scheduled ?? iso(at), task.due || task.scheduled ? undefined : 'Напоминание')
      const when = item.appendChild(document.createElement('div'))
      when.className = 'alert-when'
      const time = at.toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
      // Opening the note is only a look: the reminder stays until the task is done or put off.
      const open = button(paths.stripExt(paths.basename(task.path)), 'alert-source', () => app.workspace.openFile(task.path, { line: task.line }))
      open.title = `Открыть заметку: ${task.path}`
      open.prepend(app.icons.draw('file-text'))
      when.replaceChildren(document.createTextNode(time), document.createTextNode(' · '), open)
      const meta = item.appendChild(document.createElement('div'))
      meta.className = 'alert-status'
      meta.append(status)
      const actions = item.appendChild(document.createElement('div'))
      actions.className = 'alert-actions'
      const done = button(task.plain ? 'Готово' : 'Выполнено', 'primary', () => {
        this.acknowledge([key])
        if (!task.plain) void this.store.toggle(task)
      })
      done.prepend(app.icons.draw('check'))
      const later = button('Напомнить позже', 'alert-later', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
        app.menus.show({ x: bounds.left, y: bounds.bottom + 6 }, 'reminders-later', one,
          this.laterOptions().map((option) => ({
            icon: 'clock',
            title: laterLabel(option.label),
            onClick: () => (urgent(task) ? this.confirmPutOff(actions, 'Это важная задача. Отложить', () => this.later(one, option.at)) : this.later(one, option.at)),
          })))
      })
      later.prepend(app.icons.draw('clock'))
      later.append(app.icons.draw('chevron-down'))
      actions.append(done, later)
    }
    // There is no "close all": a reminder goes away by being done or put off.
    const putOff = button('Отложить все на 10 минут', '', () => {
      const run = () => this.snooze(keys, Date.now() + 10 * MINUTE)
      if (due.some(({ task }) => urgent(task))) this.confirmPutOff(footer, 'Среди них есть важные задачи. Отложить все', run)
      else run()
    })
    footer.replaceChildren(putOff)
    footer.hidden = due.length < 2
    dialog.querySelector('h1')!.textContent = due.length > 1 ? `Напоминания: ${due.length}` : 'Напоминание'
    dialog.querySelector('.alert-clock')!.textContent = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })

    if (!this.flash) {
      // The tab's title follows the open note, so it is remembered when the flashing starts.
      this.title = document.title
      let on = false
      this.flash = setInterval(() => {
        on = !on
        document.title = on ? `🔔 Напоминание · ${this.title}` : this.title
      }, 1000)
    }
  }

  private createDialog(): HTMLDialogElement {
    const dialog = document.createElement('dialog')
    dialog.className = 'task-alert banner'
    dialog.setAttribute('aria-labelledby', 'task-alert-title')
    dialog.innerHTML =
      '<div class="alert-body"><div class="alert-bell"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7 2.5 8.500h-17C3.500 16 6 15 6 9z"/><path d="M10 20.500a2.200 2.200 0 0 0 4 0"/><path class="alert-ring" d="M3.500 4.500C2.500 5.800 2 7.200 2 9"/><path class="alert-ring" d="M20.500 4.500c1 1.300 1.500 2.700 1.500 4.500"/></svg></div><h1></h1><div class="alert-clock"></div><div class="alert-list"></div><div class="alert-footer"></div></div>'
    // Escape must not make it go away: every reminder needs a decision.
    dialog.addEventListener('cancel', (event) => event.preventDefault())
    document.body.append(dialog)
    dialog.querySelector('h1')!.id = 'task-alert-title'
    // A card in the bottom right corner, over the program's own page; the work can go on beside it.
    const head = document.createElement('div')
    head.className = 'alert-banner-head'
    const bell = document.createElement('span')
    bell.className = 'alert-banner-icon'
    bell.append(this.plugin.app.icons.draw('bell'))
    head.append(bell, dialog.querySelector('h1')!)
    dialog.querySelector('.alert-body')!.prepend(head)
    dialog.show()
    dialog.focus({ preventScroll: true })
    // Tests and curious users can see that the signal is sounding.
    const counter = setInterval(() => {
      if (!dialog.isConnected) clearInterval(counter)
      else dialog.dataset.beeps = String(this.beeper.count)
    }, 500)
    return dialog
  }
}
