import { errorMessage, path as paths, Plugin, type VaultEntry } from '../../api'
import { compare, HistoryStore, textAt, type History } from './store'
import './style.css'

const MINUTE = 60_000
const listed = (text: string) => text.split('\n').map((line) => line.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean)

/**
 * Keeps the earlier versions of notes, the way a version control system
 * would, without the user doing anything: each time a note is saved (here or
 * by another program) what changed is put away with the exact time. A note's
 * history shows who changed what and when, compares any version with the
 * note as it is now, and brings a version back.
 */
/** How long typing must pause before the note's text becomes a version. */
const PAUSE = 5000

export default class NoteHistory extends Plugin {
  private store = new HistoryStore(this.app)

  async onload() {
    const { app, store } = this
    this.addSettings([
      { key: 'merge', name: 'Одна версия за правку подряд, минут', desc: 'Сохранения этой программы, идущие чаще, считаются одной версией: при наборе текста заметка сохраняется постоянно. Изменения другими программами записываются всегда отдельно', type: 'number', default: 5, min: 0, max: 120 },
      { key: 'keep', name: 'Сколько версий хранить у заметки', desc: 'Когда версий больше, самые старые сливаются в одну', type: 'number', default: 200, min: 5, max: 5000, step: 5 },
      { key: 'excluded', name: 'Папки без истории', desc: 'По одной в строке', type: 'lines', default: '' },
    ])
    await store.load()
    const watched = (path: string) => paths.extname(path) === 'md' && !listed(this.getSetting<string>('excluded') ?? '').some((folder) => path.startsWith(`${folder}/`))
    const options = (entry: VaultEntry | undefined) => ({ created: entry?.ctime ?? 0, merge: Math.max(0, this.getSetting<number>('merge') ?? 5) * MINUTE, keep: this.getSetting<number>('keep') ?? 200 })
    /** Texts this app has just written, so that the file event that follows is not taken for another program's change. */
    const mine = new Map<string, string>()

    // Typing saves the note every moment; its history takes the text once the typing pauses
    // (or the page is left), not at every save: a version is a diff and a packed file to write.
    const pending = new Map<string, { text: string; entry: VaultEntry; at: number; timer: ReturnType<typeof setTimeout> }>()
    const settle = (path: string) => {
      const waiting = pending.get(path)
      if (!waiting) return
      clearTimeout(waiting.timer)
      pending.delete(path)
      void store.record(path, waiting.text, waiting.at, 'here', options(waiting.entry))
    }
    this.settleAll = () => settleAll()
    const settleAll = () => [...pending.keys()].forEach(settle)
    this.register(
      app.vault.on('written', (entry, text) => {
        if (!watched(entry.path)) return
        mine.set(entry.path, text)
        clearTimeout(pending.get(entry.path)?.timer)
        pending.set(entry.path, { text, entry, at: Date.now(), timer: setTimeout(() => settle(entry.path), PAUSE) })
      }),
    )
    const hidden = () => document.visibilityState === 'hidden' && settleAll()
    document.addEventListener('visibilitychange', hidden)
    this.register(() => {
      document.removeEventListener('visibilitychange', hidden)
      settleAll()
    })
    this.register(
      app.vault.on('modify', (entry) => {
        if (entry.kind !== 'file' || !watched(entry.path)) return
        // What was typed here comes before what another program did after it.
        settle(entry.path)
        void app.vault.read(entry.path).then(
          (text) => {
            if (mine.get(entry.path) === text) return
            mine.delete(entry.path)
            void store.record(entry.path, text, entry.mtime || Date.now(), 'outside', options(entry))
          },
          () => {},
        )
      }),
    )
    // A note seen for the first time gets its starting point, so that the first change has something to be compared with.
    // It is also how changes made while this app was closed get into the history: when the note is next
    // opened, its text is compared with the last version, and what differs is put down as changed outside,
    // at the time the file says it was changed.
    const begin = (path: string) => {
      if (!watched(path)) return
      const text = app.metadata.text(path)
      const entry = app.vault.get(path)
      if (text === undefined || text === null) return
      if (mine.get(path) === text) return
      void store.record(path, text, entry?.mtime || Date.now(), 'outside', options(entry))
    }
    this.register(app.workspace.on('active-change', (leaf) => leaf && !leaf.path.startsWith('view:') && begin(leaf.path)))
    this.register(
      app.vault.on('rename', (entry, from) => {
        settle(from)
        void store.renamed(from, entry.path)
      }),
    )
    this.register(
      app.vault.on('delete', (entry) => {
        settle(entry.path)
        void store.deleted(entry.path)
      }),
    )

    const open = (path: string) => void this.show(path).catch((err) => app.notice(`История: ${errorMessage(err)}`))
    this.addCommand({
      id: 'show',
      name: 'История этой заметки',
      icon: 'history',
      scope: 'note',
      callback: () => {
        const path = app.workspace.active?.path
        if (path && !path.startsWith('view:')) open(path)
        else app.notice('Откройте заметку')
      },
    })
    this.addCommand({
      id: 'deleted',
      name: 'История удалённых заметок',
      icon: 'archive-restore',
      scope: 'vault',
      callback: () => {
        const gone = store.paths().filter((path) => !app.vault.get(path))
        if (!gone.length) return app.notice('Удалённых заметок с историей нет')
        app.suggest<string>({
          placeholder: 'Удалённая заметка…',
          items: (query) => gone.filter((path) => path.toLowerCase().includes(query.trim().toLowerCase())),
          label: (path) => paths.stripExt(paths.basename(path)),
          detail: (path) => (paths.dirname(path) ? `${paths.dirname(path)}/` : undefined),
          onChoose: open,
        })
      },
    })
    this.registerMenu('file', (entry: VaultEntry | null, add) => {
      if (entry?.kind === 'file' && watched(entry.path)) add({ icon: 'history', title: 'История заметки', command: 'history:show', onClick: () => open(entry.path) })
    })
  }

  /** The window with a note's versions. */
  /** Puts down at once what is waiting for a pause in typing. */
  private settleAll: () => void = () => {}

  private async show(path: string): Promise<void> {
    const { app, store } = this
    // The window shows what was typed a moment ago too.
    this.settleAll()
    await store.idle()
    const history = await store.get(path)
    const exists = !!app.vault.get(path)
    const current = exists ? await app.vault.read(path) : ''
    const dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.className = 'history-dialog'
    const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = '') => {
      const node = parent.appendChild(document.createElement(tag))
      if (className) node.className = className
      if (text) node.textContent = text
      return node
    }
    const stamp = (time: number) => new Date(time).toLocaleString('ru', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const head = el(dialog, 'div', 'history-head')
    el(head, 'h2', '', paths.stripExt(paths.basename(path)))
    const entry = app.vault.get(path)
    const about = el(head, 'small')
    const close = el(head, 'button', '', 'Закрыть')
    close.onclick = () => dialog.close()
    const body = el(dialog, 'div', 'history-body')
    dialog.onclose = () => dialog.remove()
    dialog.onclick = (event) => event.target === dialog && dialog.close()

    if (!history?.versions.length) {
      about.textContent = 'версий пока нет'
      el(body, 'div', 'history-none', 'История начнётся со следующего сохранения этой заметки.').style.gridColumn = '1 / -1'
      dialog.showModal()
      return
    }
    const kb = store.size(path)
    about.textContent = [
      `создана ${stamp(history.created)}`,
      entry ? `изменена ${stamp(entry.mtime)}` : history.deleted ? `удалена ${stamp(history.deleted)}` : '',
      `версий: ${history.versions.length}`,
      kb ? `история занимает ${kb < 1024 ? `${kb} Б` : `${(kb / 1024).toFixed(1)} КБ`}` : '',
    ]
      .filter(Boolean)
      .join(' · ')

    const list = el(body, 'div', 'history-list')
    const view = el(body, 'div', 'history-view')
    let chosen = history.versions.length - 1
    /** What the chosen version is compared with: the note as it is now, or the version before it. */
    let against: 'now' | 'before' = 'before'

    const draw = () => {
      list.replaceChildren()
      history.versions
        .map((version, index) => ({ version, index }))
        .reverse()
        .forEach(({ version, index }) => {
          const row = el(list, 'button', index === chosen ? 'history-version on' : 'history-version')
          el(row, 'span', '', stamp(version.t))
          const note = el(row, 'small')
          note.append(index === 0 ? 'начало истории' : version.by === 'here' ? 'здесь' : 'другой программой')
          if (index > 0) {
            note.append(' · ')
            el(note, 'span', 'history-plus', `+${version.plus}`)
            note.append(' ')
            el(note, 'span', 'history-minus', `−${version.minus}`)
          }
          row.onclick = () => {
            chosen = index
            draw()
          }
        })
      for (const rename of history.renames ?? []) el(list, 'small', 'history-gap', `${stamp(rename.t)}: «${paths.stripExt(paths.basename(rename.from))}» → «${paths.stripExt(paths.basename(rename.to))}»`)

      view.replaceChildren()
      const text = textAt(history, chosen)
      const tools = el(view, 'div', 'history-tools')
      const mode = el(tools, 'select')
      mode.add(new Option('Что изменилось в этой версии', 'before'))
      if (exists) mode.add(new Option('Чем отличается от заметки сейчас', 'now'))
      mode.value = exists ? against : 'before'
      mode.onchange = () => {
        against = mode.value as typeof against
        draw()
      }
      el(tools, 'span', 'grow')
      const copy = el(tools, 'button', '', 'Скопировать текст версии')
      copy.onclick = () => void navigator.clipboard.writeText(text).then(() => app.notice('Скопировано'))
      const restore = el(tools, 'button', 'primary', exists ? 'Вернуть эту версию' : 'Восстановить заметку')
      restore.disabled = exists && text === current.replace(/\r\n/g, '\n')
      restore.onclick = async () => {
        if (exists && !confirm('Заменить текст заметки этой версией? Нынешний текст останется в истории.')) return
        try {
          await app.workspace.flushAll()
          await app.vault.write(path, text)
          dialog.close()
          app.workspace.openFile(path)
          app.notice(exists ? 'Версия возвращена' : 'Заметка восстановлена')
        } catch (err) {
          app.notice(`Не удалось: ${errorMessage(err)}`)
        }
      }
      const diff = el(view, 'pre', 'history-diff')
      const rows = mode.value === 'now' ? compare(text, current) : compare(chosen > 0 ? textAt(history, chosen - 1) : '', text)
      // Long runs of unchanged lines are folded to three lines around each change.
      const near = rows.map((_, i) => rows.slice(Math.max(0, i - 3), i + 4).some((row) => row.kind !== 'same'))
      const whole = !rows.some((row) => row.kind !== 'same') || chosen === 0
      let skipped = 0
      const gap = () => {
        if (skipped) el(diff, 'div', 'history-gap', `⋯ ${skipped} строк без изменений`)
        skipped = 0
      }
      rows.forEach((row, i) => {
        if (!whole && !near[i]) return void skipped++
        gap()
        el(diff, 'div', row.kind === 'same' ? 'history-line' : `history-line ${row.kind}`, `${row.kind === 'new' ? '+ ' : row.kind === 'gone' ? '− ' : '  '}${row.text}`)
      })
      gap()
    }
    draw()
    dialog.showModal()
  }
}
