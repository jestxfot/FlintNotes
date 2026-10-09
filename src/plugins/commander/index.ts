import { errorMessage, pickLook, Plugin, type MenuItem, type ToolbarPlace, type VaultEntry } from '../../api'
import { dropBuiltIn, emptyData, importData, PLACE_NAMES, PLACES, type CommanderData, type Macro, type Pair, type Place } from './data'
import './style.css'

const FILE = '.flint/commander.json'
const TOOLBARS: Partial<Record<Place, ToolbarPlace>> = { leftRibbon: 'left-ribbon', rightRibbon: 'right-ribbon', titleBar: 'tab-bar', pageHeader: 'page-header', explorer: 'explorer' }
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
  private redrawSettings: (() => void) | null = null

  async onload() {
    const { app } = this
    await this.read()
    this.place()
    // Buttons of commands whose plugin is off are not shown; they return with the plugin.
    this.register(app.commands.on('change', () => this.schedule()))
    this.register(() => this.clear())

    this.registerMenu('toolbar', (target: { place: ToolbarPlace; button?: string }, add) => {
      const place = PLACE_OF[target.place]
      if (!place) return
      const index = target.button ? this.data[place].findIndex((pair) => this.buttonId(place, pair) === target.button) : -1
      if (index >= 0) for (const item of this.pairMenu(place, index)) add(item)
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
        desc: 'Правый щелчок по полосе или кнопке тоже открывает эти действия. Кнопка выключенного плагина скрыта, пока плагин не включат.',
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
        // A setup taken over earlier may still carry an item the menu has of its own.
        if (dropBuiltIn(this.data)) await this.save()
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
        { id: 'calendar:today', icon: 'lucide-calendar-days', name: 'Заметка дня', mode: 'any' },
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

  private buttonId = (place: Place, pair: Pair) => `commander:${place}:${this.data[place].indexOf(pair)}`
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
    for (const [place, toolbar] of Object.entries(TOOLBARS) as [Place, ToolbarPlace][]) {
      for (const pair of this.live(place)) {
        this.placed.push(app.toolbars.add(toolbar, { id: this.buttonId(place, pair), icon: pair.icon, title: pair.name, color: pair.color, onClick: () => this.run(pair) }))
      }
    }
    if (this.live('statusBar').length) {
      const item = app.statusBar.addItem()
      item.classList.add('commander-status')
      for (const pair of this.live('statusBar')) {
        const button = item.appendChild(document.createElement('button'))
        button.title = pair.name
        button.setAttribute('aria-label', pair.name)
        button.style.color = app.icons.css(pair.color)
        button.append(app.icons.draw(pair.icon))
        button.onclick = () => this.run(pair)
      }
      this.placed.push(() => item.remove())
    }
    this.placing = false
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

  private pairMenu(place: Place, index: number): MenuItem[] {
    const list = this.data[place]
    const pair = list[index]
    const move = (by: number) => {
      list.splice(index, 1)
      list.splice(index + by, 0, pair)
      void this.save()
    }
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
      { section: 'edit', icon: 'arrow-left', title: 'Сдвинуть к началу', disabled: index === 0, onClick: () => move(-1) },
      { section: 'edit', icon: 'arrow-right', title: 'Сдвинуть к концу', disabled: index === list.length - 1, onClick: () => move(1) },
      {
        section: 'danger',
        icon: 'trash',
        title: 'Убрать кнопку',
        danger: true,
        onClick: () => {
          list.splice(index, 1)
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
      this.data[place].forEach((pair, i) => {
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
        for (const item of this.pairMenu(place, i)) tool(row, item.icon!, item.title, () => item.onClick?.(), item.disabled)
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
