import { path as paths, renderInline, type Off, type Plugin } from '../../api'
import { fromIso } from './dates'
import type { TaskStore } from './store'
import { formatTaskLine, isOpen, movePlainReminder, parseTaskLine, reminderTime, type Task } from './task'

const MINUTE = 60_000
const CHECK_EVERY = 15_000
const FORGET_AFTER = 60 * 24 * 60 * MINUTE

export interface Due {
  key: string
  task: Task
  at: Date
  /** It comes from a day's plan (`17:00 - 17:10 ...` in a daily note), not from a reminder written on the task. */
  planned?: boolean
  /** The user has closed it: it will not alert again, and lists show it only on request. */
  closed?: boolean
}

const PLANNED = /^(\d{1,2}):(\d{2})(?:\s*[-–—]\s*\d{1,2}:\d{2})?(?=\s|$)/
/**
 * The moment a line of a day's plan is for, in the form the Day Planner plugin has:
 * a task of a daily note that begins with a time, `- [ ] 17:00 - 17:10 Vitamin D`.
 * The day is the note's (its name is a date), or the task's own date.
 */
export function plannedTime(task: Task): Date | null {
  const time = PLANNED.exec(task.description)
  if (!time) return null
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(paths.basename(task.path))?.[1] ?? task.scheduled ?? task.due
  if (!day) return null
  const at = fromIso(day)
  at.setHours(Number(time[1]), Number(time[2]), 0, 0)
  return Number.isNaN(at.getTime()) ? null : at
}

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
class Beeper {
  private context: AudioContext | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  /** How many signals have sounded since the last `start`. */
  count = 0

  start(everySeconds: number): void {
    if (this.timer) return
    this.count = 0
    this.beep()
    this.timer = setInterval(() => this.beep(), Math.max(2, everySeconds) * 1000)
    // Browsers keep audio muted until the page has been interacted with.
    window.addEventListener('pointerdown', this.unlock, true)
    window.addEventListener('keydown', this.unlock, true)
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
    window.removeEventListener('pointerdown', this.unlock, true)
    window.removeEventListener('keydown', this.unlock, true)
  }

  private unlock = () => void this.context?.resume()

  /** Which signal to play and how loud (0..1); set from the settings before each start. */
  sound = 'chime'
  volume = 0.6

  /** Plays the signal once, for trying it out in the settings. */
  preview(): void {
    this.beep()
  }

  private beep(): void {
    this.count++
    try {
      const context = (this.context ??= new AudioContext())
      void context.resume()
      const out = context.createGain()
      out.gain.value = Math.max(0, Math.min(1, this.volume))
      out.connect(context.destination)
      /** One struck note: it sounds at once and dies away, like a bell or a chime bar, with overtones above it. */
      const strike = (frequency: number, at: number, length: number, loud: number, overtones: [ratio: number, share: number][] = [[2, 0.22], [3, 0.08]], type: OscillatorType = 'sine') => {
        const start = context.currentTime + at
        for (const [ratio, share] of [[1, 1], ...overtones] as [number, number][]) {
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          oscillator.type = type
          oscillator.frequency.value = frequency * ratio
          gain.gain.setValueAtTime(0.0001, start)
          gain.gain.exponentialRampToValueAtTime(loud * share, start + 0.012)
          // Overtones die sooner than the note itself, which is what makes it sound struck rather than switched on.
          gain.gain.exponentialRampToValueAtTime(0.0001, start + length / Math.sqrt(ratio))
          oscillator.connect(gain).connect(out)
          oscillator.start(start)
          oscillator.stop(start + length + 0.05)
        }
      }
      if (this.sound === 'bell') {
        // A small bell: one note with the uneven overtones of metal.
        strike(659.25, 0, 2.4, 0.5, [[2.76, 0.35], [5.4, 0.18], [8.93, 0.08]])
        strike(659.25, 0.9, 2.0, 0.3, [[2.76, 0.3], [5.4, 0.12]])
      } else if (this.sound === 'soft') {
        // Two quiet notes, a fifth apart.
        strike(523.25, 0, 1.1, 0.32, [[2, 0.12]], 'triangle')
        strike(783.99, 0.22, 1.4, 0.28, [[2, 0.1]], 'triangle')
      } else if (this.sound === 'classic') {
        // Three rising beeps: plain, and hard to miss.
        ;[880, 1100, 1320].forEach((frequency, i) => {
          const start = context.currentTime + i * 0.22
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          oscillator.frequency.value = frequency
          gain.gain.setValueAtTime(0, start)
          gain.gain.linearRampToValueAtTime(0.35, start + 0.02)
          gain.gain.linearRampToValueAtTime(0, start + 0.18)
          oscillator.connect(gain).connect(out)
          oscillator.start(start)
          oscillator.stop(start + 0.2)
        })
      } else {
        // A chime: a rising chord, each note ringing into the next.
        ;[783.99, 987.77, 1174.66, 1567.98].forEach((frequency, i) => strike(frequency, i * 0.14, 1.6, 0.36))
      }
    } catch {
      // No audio device or audio blocked: the alert is still on screen.
    }
  }
}

/**
 * Watches the tasks and, when one is due, covers the screen with an alert that
 * stays (and keeps beeping) until each task in it is completed, postponed or
 * dismissed.
 */
export class Reminders {
  private dialog: HTMLDialogElement | null = null
  private beeper = new Beeper()
  private shown = ''
  private title = document.title
  private flash: ReturnType<typeof setInterval> | undefined

  constructor(
    private plugin: Plugin,
    private store: TaskStore,
  ) {}

  start(): Off {
    const check = () => this.check()
    const timer = setInterval(check, CHECK_EVERY)
    const off = this.store.on('change', check)
    document.addEventListener('visibilitychange', check)
    check()
    return () => {
      clearInterval(timer)
      off()
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

  /** Every open task that has a moment to remind at, soonest first, with what the user did about it. */
  private timed(): Due[] {
    const defaultTime = this.setting<boolean>('remindDue') ? this.setting<string>('defaultTime') : null
    const fallback = /^\d{1,2}:\d{2}$/.test(defaultTime ?? '') ? defaultTime : null
    const planner = this.setting<boolean>('planner') !== false
    // A line of a past day's plan that was never ticked is not a debt for ever.
    const plannerFrom = Date.now() - Math.max(0, this.setting<number>('plannerOverdueDays') ?? 1) * 24 * 60 * MINUTE
    const acknowledged = this.marks('acknowledged')
    const result: Due[] = []
    for (const task of this.candidates()) {
      if (!isOpen(task)) continue
      const planned = planner && !task.reminder ? plannedTime(task) : null
      if (planned && planned.getTime() < plannerFrom) continue
      const at = planned ?? reminderTime(task, fallback)
      if (!at) continue
      const key = `${task.path}|${task.description}|${at.getTime()}`
      result.push({ key, task, at, planned: !!planned, closed: !!acknowledged[key] })
    }
    return result.sort((a, b) => a.at.getTime() - b.at.getTime())
  }

  /** Reminders whose time has come and that were neither handled nor postponed. */
  due(): Due[] {
    const now = Date.now()
    const snoozed = this.marks('snoozed')
    const oldest = now - this.setting<number>('maxAgeDays') * 24 * 60 * MINUTE
    // "Remind N minutes before": the alert comes that much earlier than the moment itself.
    const lead = Math.max(0, this.setting<number>('leadMinutes') ?? 0) * MINUTE
    return this.timed().filter(({ key, at, closed }) => !closed && at.getTime() - lead <= now && at.getTime() >= oldest && !((snoozed[key] ?? 0) > now))
  }

  private tune(): void {
    this.beeper.sound = this.setting<string>('soundKind') ?? 'chime'
    this.beeper.volume = Math.max(0, Math.min(100, this.setting<number>('volume') ?? 60)) / 100
  }

  /** Plays the chosen signal once. */
  playSound(): void {
    this.tune()
    this.beeper.preview()
  }

  /** Whether alerts are held back right now: "do not disturb" was asked for, or it is the quiet time of day. */
  muted(): boolean {
    if ((this.setting<number>('muteUntil') ?? 0) > Date.now()) return true
    const from = this.setting<string>('quietFrom') ?? ''
    const to = this.setting<string>('quietTo') ?? ''
    if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to) || from === to) return false
    const minutes = (text: string) => Number(text.split(':')[0]) * 60 + Number(text.split(':')[1])
    const now = new Date().getHours() * 60 + new Date().getMinutes()
    // The quiet time may run over midnight: 23:00 to 07:00.
    return minutes(from) < minutes(to) ? now >= minutes(from) && now < minutes(to) : now >= minutes(from) || now < minutes(to)
  }

  /** Holds alerts back for so many minutes; `0` lets them through again. */
  mute(minutes: number): void {
    this.plugin.setSetting('muteUntil', minutes > 0 ? Date.now() + minutes * MINUTE : 0)
    this.shown = ''
    this.check()
  }

  check(): void {
    const style = this.setting<string>('alertStyle') ?? 'fullscreen'
    const due = this.muted() || style === 'off' ? [] : this.due()
    const signature = due.map((d) => d.key).join('\n')
    if (signature === this.shown) return
    const fresh = due.filter((d) => !this.shown.split('\n').includes(d.key))
    this.shown = signature
    if (!due.length) {
      this.close()
      return
    }
    this.render(due)
    if (this.setting<boolean>('sound')) {
      this.tune()
      this.beeper.start(this.setting<number>('repeatSeconds'))
    }
    if (this.setting<boolean>('system') && globalThis.Notification?.permission === 'granted') {
      for (const { key, task } of fresh) {
        const note = new Notification(task.plain ? 'Напоминание' : 'Напоминание о задаче', { body: task.description, tag: key, requireInteraction: true })
        // A click on the system's notification brings this tab forward, at the task.
        note.onclick = () => {
          window.focus()
          this.plugin.app.workspace.openFile(task.path, { line: task.line })
        }
      }
    }
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
    this.beeper.stop()
    clearInterval(this.flash)
    this.flash = undefined
    document.title = this.title
    this.dialog?.remove()
    this.dialog = null
    this.shown = ''
  }

  private render(due: Due[]): void {
    const { app } = this.plugin
    const dialog = (this.dialog ??= this.createDialog())
    dialog.dataset.count = String(due.length)
    const list = dialog.querySelector('.alert-list')!
    list.replaceChildren()

    const button = (label: string, className: string, action: () => void) => {
      const el = document.createElement('button')
      el.textContent = label
      el.className = className
      el.onclick = action
      return el
    }

    const laterLabel = (label: string) => `Через ${label}`.replace(/^Через (через|завтра|послезавтра|in |tomorrow|next )/i, '$1').replace(/^./, (c) => c.toUpperCase())
    const keys = due.map((d) => d.key)
    const footer = dialog.querySelector('.alert-footer') as HTMLElement
    // Many at once are a list to go through, not a pile of cards: one line each, the days apart, and actions for all on top.
    const many = due.length > 3 && !dialog.classList.contains('banner')
    dialog.classList.toggle('many', many)
    if (many) {
      const icon = (name: string, label: string, className: string, action: () => void) => {
        const el = button('', className, action)
        el.title = label
        el.setAttribute('aria-label', label)
        el.append(app.icons.draw(name))
        return el
      }
      /** The choices of "later" open as a row of their own under what they are for. */
      const choices = (after: HTMLElement, pick: (at: Date) => void) => {
        const open = after.nextElementSibling
        list.querySelectorAll('.alert-choices').forEach((el) => el.remove())
        footer.querySelectorAll('.alert-choices').forEach((el) => el.remove())
        if (open?.classList.contains('alert-choices')) return
        const row = document.createElement('div')
        row.className = 'alert-choices'
        row.append(...this.laterOptions().map((option) => button(laterLabel(option.label), 'later', () => pick(option.at))))
        after.after(row)
      }
      const dayOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      const today = dayOf(new Date())
      let group = NaN
      for (const one of due) {
        const { key, task, at } = one
        if (dayOf(at) !== group) {
          group = dayOf(at)
          const days = Math.round((today - group) / 86_400_000)
          const title = list.appendChild(document.createElement('h2'))
          title.textContent = days === 0 ? 'Сегодня' : days === 1 ? 'Вчера' : at.toLocaleDateString('ru', { day: 'numeric', month: 'long', weekday: 'short' })
          const count = title.appendChild(document.createElement('span'))
          count.textContent = String(due.filter((other) => dayOf(other.at) === group).length)
        }
        const item = list.appendChild(document.createElement('div'))
        item.className = 'alert-task'
        const time = item.appendChild(document.createElement('span'))
        time.className = 'alert-time'
        time.textContent = at.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
        const text = item.appendChild(document.createElement('div'))
        text.className = 'alert-text'
        // A line of the day plan says its hours itself; the time before it is enough.
        text.append(renderInline(app, task.description.replace(/^\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})?\s+(?=\S)/, ''), task.path))
        const actions = item.appendChild(document.createElement('div'))
        actions.className = 'alert-actions'
        actions.append(
          icon('check', task.plain ? 'Готово' : 'Выполнено', 'primary', () => {
            this.acknowledge([key])
            if (!task.plain) void this.store.toggle(task)
          }),
          icon('alarm-clock', 'Напомнить позже', '', () => choices(item, (when) => this.later(one, when))),
          icon('file-text', 'Открыть заметку', '', () => {
            this.acknowledge([key])
            app.workspace.openFile(task.path, { line: task.line })
          }),
          icon('x', 'Закрыть', '', () => this.acknowledge([key])),
        )
      }
      const bar = document.createElement('div')
      bar.className = 'alert-bar'
      bar.append(
        button('✓ Выполнить все', 'primary', async () => {
          this.acknowledge(keys)
          // One after another: several of them may be lines of the same note.
          for (const { task } of due) if (!task.plain) await this.store.toggle(task)
        }),
        button('Отложить все…', '', () => choices(bar, (when) => this.snooze(keys, when.getTime()))),
        button('Закрыть все', '', () => this.acknowledge(keys)),
      )
      footer.replaceChildren(bar)
      footer.hidden = false
    } else {
      for (const one of due) {
        const { key, task, at } = one
        const item = list.appendChild(document.createElement('div'))
        item.className = 'alert-task'
        const text = item.appendChild(document.createElement('div'))
        text.className = 'alert-text'
        text.append(renderInline(app, task.description, task.path))
        const when = item.appendChild(document.createElement('div'))
        when.className = 'alert-when'
        const time = at.toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
        when.textContent = `${time} · ${paths.stripExt(paths.basename(task.path))}${task.heading ? ` › ${task.heading}` : ''}`
        const actions = item.appendChild(document.createElement('div'))
        actions.className = 'alert-actions'
        actions.append(
          // An ordinary line has no box to tick: its reminder is simply over.
          button(task.plain ? '✓ Готово' : '✓ Выполнено', 'primary', () => {
            this.acknowledge([key])
            if (!task.plain) void this.store.toggle(task)
          }),
          // "Remind me later": the choices come from the settings.
          ...this.laterOptions().map((option) => button(laterLabel(option.label), 'later', () => this.later(one, option.at))),
          button('Открыть заметку', '', () => {
            this.acknowledge([key])
            app.workspace.openFile(task.path, { line: task.line })
          }),
          button('Закрыть', '', () => this.acknowledge([key])),
        )
      }
      footer.replaceChildren(
        button('Отложить все на 10 минут', '', () => this.snooze(keys, Date.now() + 10 * MINUTE)),
        button('Закрыть все', '', () => this.acknowledge(keys)),
      )
      footer.hidden = due.length < 2
    }
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
    dialog.className = 'task-alert'
    dialog.innerHTML =
      '<div class="alert-body"><div class="alert-bell"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7 2.5 8.500h-17C3.500 16 6 15 6 9z"/><path d="M10 20.500a2.200 2.200 0 0 0 4 0"/><path class="alert-ring" d="M3.500 4.500C2.500 5.800 2 7.200 2 9"/><path class="alert-ring" d="M20.500 4.500c1 1.300 1.500 2.700 1.500 4.500"/></svg></div><h1></h1><div class="alert-clock"></div><div class="alert-list"></div><div class="alert-footer"></div></div>'
    // Escape must not make it go away: every reminder needs a decision.
    dialog.addEventListener('cancel', (event) => event.preventDefault())
    document.body.append(dialog)
    // Over the whole screen, or as a card in the corner that lets the work go on.
    if ((this.setting<string>('alertStyle') ?? 'fullscreen') === 'banner') {
      dialog.classList.add('banner')
      dialog.show()
    } else dialog.showModal()
    // Tests and curious users can see that the signal is sounding.
    const counter = setInterval(() => {
      if (!dialog.isConnected) clearInterval(counter)
      else dialog.dataset.beeps = String(this.beeper.count)
    }, 500)
    return dialog
  }
}
