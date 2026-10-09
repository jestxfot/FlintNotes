import { path as paths, renderInline, type Off, type Plugin } from '../../api'
import type { TaskStore } from './store'
import { isOpen, reminderTime, type Task } from './task'

const MINUTE = 60_000
const CHECK_EVERY = 15_000
const FORGET_AFTER = 60 * 24 * 60 * MINUTE

interface Due {
  key: string
  task: Task
  at: Date
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

  private beep(): void {
    this.count++
    try {
      const context = (this.context ??= new AudioContext())
      void context.resume()
      ;[880, 1100, 1320].forEach((frequency, i) => {
        const start = context.currentTime + i * 0.22
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.frequency.value = frequency
        // A quick fade in and out avoids clicks at the edges of each beep.
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.35, start + 0.02)
        gain.gain.linearRampToValueAtTime(0, start + 0.18)
        oscillator.connect(gain).connect(context.destination)
        oscillator.start(start)
        oscillator.stop(start + 0.2)
      })
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

  private marks(key: 'acknowledged' | 'snoozed'): Record<string, number> {
    return { ...(this.setting<Record<string, number> | undefined>(key) ?? {}) }
  }

  /** Reminders whose time has come and that were neither handled nor postponed. */
  due(): Due[] {
    const now = Date.now()
    const acknowledged = this.marks('acknowledged')
    const snoozed = this.marks('snoozed')
    const defaultTime = this.setting<boolean>('remindDue') ? this.setting<string>('defaultTime') : null
    const oldest = now - this.setting<number>('maxAgeDays') * 24 * 60 * MINUTE
    const result: Due[] = []
    for (const task of this.store.all()) {
      if (!isOpen(task)) continue
      const at = reminderTime(task, /^\d{1,2}:\d{2}$/.test(defaultTime ?? '') ? defaultTime : null)
      if (!at || at.getTime() > now || at.getTime() < oldest) continue
      const key = `${task.path}|${task.description}|${at.getTime()}`
      if (acknowledged[key] || (snoozed[key] ?? 0) > now) continue
      result.push({ key, task, at })
    }
    return result.sort((a, b) => a.at.getTime() - b.at.getTime())
  }

  check(): void {
    const due = this.due()
    const signature = due.map((d) => d.key).join('\n')
    if (signature === this.shown) return
    const fresh = due.filter((d) => !this.shown.split('\n').includes(d.key))
    this.shown = signature
    if (!due.length) {
      this.close()
      return
    }
    this.render(due)
    if (this.setting<boolean>('sound')) this.beeper.start(this.setting<number>('repeatSeconds'))
    if (this.setting<boolean>('system') && globalThis.Notification?.permission === 'granted') {
      for (const { key, task } of fresh) {
        new Notification('Напоминание о задаче', { body: task.description, tag: key, requireInteraction: true })
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

  private snooze(keys: string[], until: number): void {
    this.mark('snoozed', keys, until)
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
    const tomorrow = () => {
      const date = new Date()
      date.setDate(date.getDate() + 1)
      date.setHours(9, 0, 0, 0)
      return date.getTime()
    }

    for (const { key, task, at } of due) {
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
        button('✓ Выполнено', 'primary', () => {
          this.acknowledge([key])
          void this.store.toggle(task)
        }),
        button('Через 10 минут', '', () => this.snooze([key], Date.now() + 10 * MINUTE)),
        button('Через час', '', () => this.snooze([key], Date.now() + 60 * MINUTE)),
        button('Завтра в 9:00', '', () => this.snooze([key], tomorrow())),
        button('Открыть заметку', '', () => {
          this.acknowledge([key])
          app.workspace.openFile(task.path, { line: task.line })
        }),
        button('Закрыть', '', () => this.acknowledge([key])),
      )
    }

    const keys = due.map((d) => d.key)
    const footer = dialog.querySelector('.alert-footer')!
    footer.replaceChildren(
      button('Отложить все на 10 минут', '', () => this.snooze(keys, Date.now() + 10 * MINUTE)),
      button('Закрыть все', '', () => this.acknowledge(keys)),
    )
    ;(footer as HTMLElement).hidden = due.length < 2
    dialog.querySelector('h1')!.textContent = due.length > 1 ? `Напоминания: ${due.length}` : 'Напоминание'

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
      '<div class="alert-body"><div class="alert-bell">🔔</div><h1></h1><div class="alert-list"></div><div class="alert-footer"></div></div>'
    // Escape must not make it go away: every reminder needs a decision.
    dialog.addEventListener('cancel', (event) => event.preventDefault())
    document.body.append(dialog)
    dialog.showModal()
    // Tests and curious users can see that the signal is sounding.
    const counter = setInterval(() => {
      if (!dialog.isConnected) clearInterval(counter)
      else dialog.dataset.beeps = String(this.beeper.count)
    }, 500)
    return dialog
  }
}
