import { errorMessage, formatHotkey, pickLook, Plugin, type MenuItem, type ToolbarPlace, type VaultEntry } from '../../api'
import { dropBuiltIn, emptyData, importData, PLACE_NAMES, PLACES, renameMoved, type CommanderData, type Macro, type Pair, type Place } from './data'
import './style.css'

const FILE = '.flint/commander.json'
const TOOLBARS: Partial<Record<Place, ToolbarPlace>> = {
  leftRibbon: 'left-ribbon',
  leftRibbonEnd: 'left-ribbon-end',
  rightRibbon: 'right-ribbon',
  rightRibbonEnd: 'right-ribbon-end',
  titleBar: 'tab-bar',
  pageHeader: 'page-header',
  explorer: 'explorer',
  statusBar: 'status-bar',
  keyboardBar: 'keyboard',
}
const PLACE_OF = Object.fromEntries(Object.entries(TOOLBARS).map(([place, toolbar]) => [toolbar, place])) as Record<ToolbarPlace, Place>

/**
 * Buttons of the user's own for any command, in any place of the app's frame,
 * and macros that run several commands in a row. Every command of the core and
 * of every plugin can be bound: the plugin knows nothing about them but their ids.
 */
export default class Commander extends Plugin {
  private data: CommanderData = emptyData()
  /** Undoes everything that was put into the frame for the current data. */
  private placed: (() => void)[] = []
  /** The buttons in the frame now, by their ids there. */
  private shown = new Map<string, { place: Place; pair: Pair }>()
  /** The id of each button in the frame; it stays when the button moves, so the place the user gave it holds. */
  private ids = new Map<Pair, string>()
  private redrawSettings: (() => void) | null = null

  async onload() {
    const { app } = this
    await this.read()
    this.place()
    // Buttons of commands whose plugin is off are not shown; they return with the plugin.
    this.register(app.commands.on('change', () => this.schedule()))
    this.register(() => this.clear())
    // The user moved a button (dragged it, or from its menu): the lists follow, so they say where each button is.
    this.register(app.toolbars.on('move', (id) => this.shown.has(id) && this.follow()))

    this.registerMenu('toolbar', (target: { place: ToolbarPlace; button?: string }, add) => {
      const place = PLACE_OF[target.place]
      if (!place) return
      // Moving a button is offered by the core, for every button.
      const mine = target.button ? this.shown.get(target.button) : undefined
      if (mine) for (const item of this.pairMenu(mine.place, mine.pair, false)) add(item)
      add({ section: 'new', icon: 'plus', title: 'Добавить команду…', onClick: () => this.add(place) })
    })
    this.registerMenu('file', (entry: VaultEntry | null, add) => {
      for (const pair of this.live('fileMenu')) add({ icon: pair.icon, title: pair.name, onClick: () => this.run(pair, entry) })
    })
    this.registerMenu('editor', (_view, add) => {
      for (const pair of this.live('editorMenu')) add({ icon: pair.icon, title: pair.name, onClick: () => this.run(pair) })
    })

    for (const place of PLACES) this.addCommand({ id: `add-${place}`, name: `Добавить кнопку: ${PLACE_NAMES[place].toLowerCase()}`, icon: 'plus', callback: () => this.add(place) })
    this.addCommand({ id: 'new-macro', name: 'Создать макрос из команд', icon: 'list-video', callback: () => this.newMacro() })
    this.addCommand({ id: 'import', name: 'Взять кнопки из Commander (Obsidian)', callback: () => void this.importFromObsidian(true) })

    this.addSettings([
      {
        key: 'buttons',
        name: 'Кнопки',
        desc: 'Кнопки перетаскиваются по полосам мышью; правый щелчок по кнопке — переместить, сменить значок или убрать. Кнопка выключенного плагина скрыта, пока плагин не включат',
        type: 'custom',
        render: (el) => {
          this.redrawSettings = () => this.drawSettings(el)
          this.drawSettings(el)
          return () => (this.redrawSettings = null)
        },
      },
    ])
  }

  // ---- data

  private async read(): Promise<void> {
    try {
      const text = await this.app.vault.readOptional(FILE)
      if (text) {
        this.data = { ...emptyData(), ...JSON.parse(text) }
        // A setup taken over earlier may still carry an item the menu has of its own, or a command under an id it had before.
        const dropped = dropBuiltIn(this.data)
        if (renameMoved(this.data) || dropped) await this.save()
      } else await this.importFromObsidian(false)
    } catch (err) {
      this.app.notice(`Быстрые кнопки: не удалось прочитать ${FILE}: ${errorMessage(err)}`)
    }
  }

  /** The first time, the setup of Obsidian's Commander is taken over; with none, a few useful buttons. */
  private async importFromObsidian(asked: boolean): Promise<void> {
    const { app } = this
    const config = app.obsidianConfig
    const text = config ? await app.vault.readOptional(`${config}/plugins/cmdr/data.json`).catch(() => null) : null
    if (text) {
      const { data, skipped } = importData(JSON.parse(text))
      this.data = data
      if (asked || skipped) app.notice(`Кнопки взяты из Commander${skipped ? `; пропущено команд, которых здесь нет: ${skipped}` : ''}`)
    } else if (asked) return app.notice('В этом хранилище нет настроек Commander')
    if (!PLACES.some((place) => this.data[place].length)) {
      this.data.leftRibbon = [
        { id: 'quick-switcher:open', icon: 'lucide-file-search', name: 'Быстрый переход', mode: 'any' },
        { id: 'graph:open', icon: 'lucide-git-fork', name: 'Граф связей', mode: 'any' },
        { id: 'daily-notes:today', icon: 'lucide-calendar-days', name: 'Заметка дня', mode: 'any' },
        { id: 'templates:insert', icon: 'lucide-files', name: 'Вставить шаблон', mode: 'any' },
        { id: 'core:command-palette', icon: 'lucide-terminal', name: 'Палитра команд', mode: 'any' },
      ]
    }
    await this.save()
  }

  private async save(): Promise<void> {
    try {
      await this.app.vault.write(FILE, JSON.stringify(this.data, null, 2))
    } catch (err) {
      this.app.notice(`Быстрые кнопки: не удалось сохранить: ${errorMessage(err)}`)
    }
    this.place()
    this.redrawSettings?.()
  }

  // ---- showing

  /** Buttons whose command exists right now. */
  private live = (place: Place) => this.data[place].filter((pair) => this.app.commands.get(pair.id))

  private timer: ReturnType<typeof setTimeout> | undefined
  private placing = false
  private schedule(): void {
    // Placing registers the macros as commands, which is itself a change of the commands.
    if (this.placing) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.place())
  }

  private clear(): void {
    const was = this.placing
    this.placing = true
    clearTimeout(this.timer)
    this.placed.splice(0).forEach((off) => off())
    this.placing = was
  }

  private run(pair: Pair, entry?: VaultEntry | null): void {
    // From a file's menu the command is meant for that file, so the file is opened first.
    if (entry?.kind === 'file') this.app.workspace.openFile(entry.path)
    if (!this.app.commands.run(pair.id)) this.app.notice(`Команда «${pair.name}» сейчас недоступна`)
  }

  /** Puts the buttons and macros of the current data into the app. */
  private place(): void {
    const { app } = this
    this.placing = true
    this.clear()
    // Macros first: a button may run one.
    this.data.macros.forEach((macro, i) => {
      this.placed.push(app.commands.add({ id: `commander:macro-${i}`, name: `Макрос: ${macro.name}`, icon: macro.icon, callback: () => void this.runMacro(macro) }))
    })
    // A button is known by its command, not by its place or number, so it is the same button wherever it is moved.
    this.shown.clear()
    this.ids.clear()
    const seen = new Map<string, number>()
    for (const [place, toolbar] of Object.entries(TOOLBARS) as [Place, ToolbarPlace][]) {
      for (const pair of this.data[place]) {
        const n = (seen.get(pair.id) ?? 0) + 1
        seen.set(pair.id, n)
        const id = `commander:${pair.id}${n > 1 ? `:${n}` : ''}`
        this.ids.set(pair, id)
        if (!app.commands.get(pair.id)) continue
        this.shown.set(id, { place, pair })
        const command = app.commands.get(pair.id)!
        const hotkey = app.commands.hotkeyOf(command)
        this.placed.push(app.toolbars.add(toolbar, { id, icon: pair.icon, title: pair.name, hint: hotkey ? `${pair.name} (${formatHotkey(hotkey)})` : undefined, color: pair.color, onClick: () => this.run(pair) }))
      }
    }
    this.placing = false
  }

  /** Makes the lists say where the buttons are now and in what order; buttons of commands that are away stay at the end of their list. */
  private follow(): void {
    const next = {} as Record<Place, Pair[]>
    for (const [place, toolbar] of Object.entries(TOOLBARS) as [Place, ToolbarPlace][]) {
      next[place] = this.app.toolbars.list(toolbar).flatMap((button) => this.shown.get(button.id)?.pair ?? [])
    }
    for (const place of Object.keys(TOOLBARS) as Place[]) for (const pair of this.data[place]) if (!this.app.commands.get(pair.id)) next[place].push(pair)
    Object.assign(this.data, next)
    void this.save()
  }

  private async runMacro(macro: Macro): Promise<void> {
    for (const step of macro.macro) {
      if (step.action === 1) await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, Math.max(0, step.delay))))
      else if (!this.app.commands.run(step.commandId)) return this.app.notice(`Макрос «${macro.name}»: команда «${step.commandId}» недоступна`)
    }
  }

  // ---- editing

  /** Lets the user pick any command of the app. */
  private chooseCommand(placeholder: string, onChoose: (id: string, name: string, icon?: string) => void): void {
    const all = this.app.commands.list().sort((a, b) => a.name.localeCompare(b.name))
    this.app.suggest({
      placeholder,
      items: (query) => all.filter((command) => command.name.toLowerCase().includes(query.toLowerCase())),
      label: (command) => command.name,
      detail: (command) => command.id,
      onChoose: (command) => onChoose(command.id, command.name, command.icon),
    })
  }

  private add(place: Place): void {
    this.chooseCommand(`Команда для кнопки (${PLACE_NAMES[place].toLowerCase()})…`, async (id, name, icon) => {
      // A menu item needs no icon of the user's choosing; a button does.
      const look = place.endsWith('Menu') ? { icon: icon ?? 'lucide-chevron-right' } : await pickLook(this.app, name, { icon: icon ? `lucide-${icon.replace(/^lucide-/, '')}` : undefined })
      if (!look) return
      this.data[place].push({ id, icon: look.icon || 'lucide-circle', name, mode: 'any', ...(look.color ? { color: look.color } : {}) })
      await this.save()
    })
  }

  /** What can be done with a button; `moves` adds moving it along its place. */
  private pairMenu(place: Place, pair: Pair, moves: boolean): MenuItem[] {
    const list = this.data[place]
    const index = list.indexOf(pair)
    const toolbar = TOOLBARS[place]
    const id = this.ids.get(pair)
    // In the frame the order is the core's, where the buttons of others are too; a menu's is the list's own.
    const shown = toolbar ? this.app.toolbars.list(toolbar).map((button) => button.id) : []
    const at = toolbar ? shown.indexOf(id ?? '') : index
    const last = toolbar ? shown.length - 1 : list.length - 1
    const move = (by: number) => {
      if (toolbar) return id && this.app.toolbars.shift(id, by)
      list.splice(index, 1)
      list.splice(index + by, 0, pair)
      void this.save()
    }
    const moving: MenuItem[] = [
      { section: 'edit', icon: 'arrow-left', title: 'Сдвинуть к началу', disabled: at <= 0, onClick: () => move(-1) },
      { section: 'edit', icon: 'arrow-right', title: 'Сдвинуть к концу', disabled: at < 0 || at === last, onClick: () => move(1) },
    ]
    return [
      {
        section: 'edit',
        icon: 'image-plus',
        title: 'Значок и цвет…',
        onClick: async () => {
          const look = await pickLook(this.app, pair.name, { icon: pair.icon, color: pair.color })
          if (!look) return
          pair.icon = look.icon || pair.icon
          if (look.color) pair.color = look.color
          else delete pair.color
          await this.save()
        },
      },
      ...(moves ? moving : []),
      {
        section: 'danger',
        icon: 'trash',
        title: 'Убрать кнопку',
        danger: true,
        onClick: () => {
          list.splice(list.indexOf(pair), 1)
          if (id) this.app.toolbars.forget(id)
          void this.save()
        },
      },
    ]
  }

  private newMacro(): void {
    const macro: Macro = { name: `Макрос ${this.data.macros.length + 1}`, icon: 'lucide-list-video', macro: [] }
    this.chooseCommand('Первая команда макроса…', (id) => {
      macro.macro.push({ action: 0, commandId: id })
      this.data.macros.push(macro)
      void this.save().then(() => this.app.notice(`«${macro.name}» создан; шаги добавляются в настройках плагина`))
    })
  }

  /** The plugin's page of the settings screen: every place with its buttons, then the macros. */
  private drawSettings(root: HTMLElement): void {
    const { app } = this
    const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = '') => {
      const node = parent.appendChild(document.createElement(tag))
      if (className) node.className = className
      if (text) node.textContent = text
      return node
    }
    const tool = (parent: HTMLElement, icon: string, title: string, action: () => void, disabled = false) => {
      const button = el(parent, 'button', 'commander-tool')
      button.title = title
      button.setAttribute('aria-label', title)
      button.disabled = disabled
      button.append(app.icons.draw(icon))
      button.onclick = action
    }
    root.replaceChildren()
    root.className = 'commander-settings'

    for (const place of PLACES) {
      const box = el(root, 'div', 'commander-place')
      box.dataset.place = place
      const head = el(box, 'div', 'commander-head')
      el(head, 'b', '', PLACE_NAMES[place])
      el(head, 'button', 'commander-add', '+ Добавить команду').onclick = () => this.add(place)
      this.data[place].forEach((pair) => {
        const row = el(box, 'div', app.commands.get(pair.id) ? 'commander-row' : 'commander-row missing')
        const icon = el(row, 'span', 'commander-icon')
        icon.style.color = app.icons.css(pair.color)
        icon.append(app.icons.draw(pair.icon))
        const name = el(row, 'input')
        name.value = pair.name
        name.title = app.commands.get(pair.id) ? pair.id : `${pair.id} — команда недоступна (плагин выключен?)`
        name.onchange = () => {
          pair.name = name.value.trim() || pair.name
          void this.save()
        }
        for (const item of this.pairMenu(place, pair, true)) tool(row, item.icon!, item.title, () => item.onClick?.(), item.disabled)
      })
      if (!this.data[place].length) el(box, 'div', 'commander-none', 'Пусто')
    }

    const macros = el(root, 'div', 'commander-place')
    const head = el(macros, 'div', 'commander-head')
    el(head, 'b', '', 'Макросы')
    el(head, 'button', 'commander-add', '+ Создать макрос').onclick = () => this.newMacro()
    this.data.macros.forEach((macro, m) => {
      const row = el(macros, 'div', 'commander-row')
      const name = el(row, 'input')
      name.value = macro.name
      name.onchange = () => {
        macro.name = name.value.trim() || macro.name
        void this.save()
      }
      tool(row, 'plus', 'Добавить команду', () =>
        this.chooseCommand('Следующая команда макроса…', (id) => {
          macro.macro.push({ action: 0, commandId: id })
          void this.save()
        }),
      )
      tool(row, 'timer', 'Добавить паузу в полсекунды', () => {
        macro.macro.push({ action: 1, delay: 500 })
        void this.save()
      })
      tool(row, 'trash', 'Удалить макрос', () => {
        this.data.macros.splice(m, 1)
        void this.save()
      })
      const steps = el(macros, 'ol', 'commander-steps')
      macro.macro.forEach((step, s) => {
        const item = el(steps, 'li')
        if (step.action === 1) {
          item.append('пауза ')
          const delay = el(item, 'input')
          delay.type = 'number'
          delay.min = '0'
          delay.step = '100'
          delay.value = String(step.delay)
          delay.onchange = () => {
            step.delay = Number(delay.value) || 0
            void this.save()
          }
          item.append(' мс')
        } else item.append(app.commands.get(step.commandId)?.name ?? `${step.commandId} (недоступна)`)
        tool(item, 'x', 'Убрать шаг', () => {
          macro.macro.splice(s, 1)
          void this.save()
        })
      })
    })
    if (!this.data.macros.length) el(macros, 'div', 'commander-none', 'Макрос запускает несколько команд подряд и сам становится командой.')
  }
}
