import { moment, path as paths, Plugin, type CreationOrigin, type Placement } from '../../api'

/** Where a new note goes. */
type Where = 'all' | 'keep' | 'core' | 'root' | 'source' | 'sub' | 'folder' | 'rules' | 'recent' | 'ask'

const WHERE: { value: Exclude<Where, 'all'>; label: string }[] = [
  { value: 'source', label: 'Рядом с заметкой, из которой создаётся (папка открытой заметки или заметки со ссылкой)' },
  { value: 'root', label: 'В корне хранилища' },
  { value: 'sub', label: 'В подпапке рядом с этой заметкой (имя ниже)' },
  { value: 'folder', label: 'В указанной папке (ниже)' },
  { value: 'rules', label: 'По правилам: своя папка для заметок из разных папок (ниже)' },
  { value: 'recent', label: 'Туда же, куда в прошлый раз' },
  { value: 'ask', label: 'Спрашивать каждый раз' },
  { value: 'core', label: 'Как в основных настройках («Место для новых заметок»)' },
  { value: 'keep', label: 'Не менять: как без этого плагина' },
]

/** The ways of creating a note, as they are named in the settings. */
const ORIGINS: { origin: CreationOrigin; name: string; desc: string }[] = [
  { origin: 'new', name: 'Новая заметка (Alt+N, «+»)', desc: 'Команда «Новая заметка» и кнопка «+» в полосе вкладок' },
  { origin: 'link', name: 'Щелчок по ссылке на несуществующую заметку', desc: 'Ссылка вида [[Название]], заметки с таким именем ещё нет' },
  { origin: 'switcher', name: 'Быстрый переключатель', desc: 'Имя, набранное в быстром переключателе, которого нет среди заметок' },
  { origin: 'tree', name: 'Список файлов', desc: 'Создание заметки в папке из меню списка файлов' },
  { origin: 'template', name: 'Заметка из шаблона', desc: 'Команда «Создать заметку из шаблона»' },
  { origin: 'base', name: 'Запись базы', desc: 'Кнопка «Новая запись» в базе' },
]

/** One rule: notes made from a note in `from` (and in the folders under it) go to `to`. */
interface Rule {
  from: string
  to: string
}

export default class NewNotePlace extends Plugin {
  /** The folder the last note was made in, for «как в прошлый раз» (kept between visits). */
  private last(): string | undefined {
    return this.getSetting<string | undefined>('last')
  }

  onload() {
    const { app } = this
    this.addSettings([
      {
        key: 'all',
        name: 'Куда класть новые заметки',
        desc: 'Для всех способов создания сразу; ниже для любого способа можно выбрать своё',
        type: 'select',
        default: 'source',
        options: WHERE.filter((one) => one.value !== 'keep').map(({ value, label }) => ({ value, label })),
      },
      ...ORIGINS.map(({ origin, name, desc }) => ({
        key: origin,
        name,
        desc,
        type: 'select' as const,
        default: 'all',
        options: [{ value: 'all', label: 'Как выше' }, ...WHERE.map(({ value, label }) => ({ value, label }))],
      })),
      {
        key: 'keepExplicit',
        name: 'Папка названа явно — не менять',
        desc: 'Папка, по которой щёлкнули в списке файлов, папка в ссылке ([[Папка/Заметка]]) или в имени, набранном в переключателе, и папка, которую просит база, остаются как есть. Выключите, чтобы и они подчинялись выбору выше',
        type: 'toggle',
        default: true,
      },
      {
        key: 'folder',
        name: 'Указанная папка',
        desc: 'Для варианта «В указанной папке». В имени можно писать {{date:YYYY/MM}} (дата создания), {{folder}} (папка заметки-источника), {{source}} (её название)',
        type: 'text',
        default: '',
        placeholder: 'Входящие/{{date:YYYY-MM}}',
      },
      {
        key: 'subfolder',
        name: 'Подпапка рядом с заметкой',
        desc: 'Для варианта «В подпапке рядом с этой заметкой»: папка внутри папки заметки-источника; создаётся, если её нет. Те же {{…}}, что выше',
        type: 'text',
        default: 'Заметки',
        placeholder: 'Заметки',
      },
      {
        key: 'rules',
        name: 'Правила',
        desc: 'Для варианта «По правилам». По строке: «папка заметки-источника → папка новой заметки». Подходит и источник в подпапке; побеждает самая глубокая папка; «*» — любая, «/» — корень. Те же {{…}}',
        type: 'lines',
        default: '',
        placeholder: 'Дневник → Дневник/Идеи\nПроекты → Проекты/Входящие\n* → Входящие',
      },
    ])

    app.creation.locate = (placement) => this.locate(placement)
    this.register(() => (app.creation.locate = null))

    // What was made last, for «как в прошлый раз»: whichever way it was made.
    this.register(
      app.vault.on('created-here', (entry) => {
        if (entry.kind !== 'file' || !/\.md$/i.test(entry.path)) return
        const folder = paths.dirname(entry.path)
        if (folder !== this.last()) this.setSetting('last', folder)
      }),
    )

    this.addCommand({
      id: 'choose',
      name: 'Куда класть новые заметки: выбрать…',
      icon: 'folder-input',
      callback: () =>
        app.suggest<(typeof WHERE)[number]>({
          placeholder: 'Куда класть новые заметки…',
          items: (query) => WHERE.filter((one) => one.value !== 'keep' && one.label.toLowerCase().includes(query.trim().toLowerCase())),
          label: (one) => one.label,
          icon: () => ({ icon: 'folder-input' }),
          onChoose: (one) => {
            this.setSetting('all', one.value)
            app.notice(`Новые заметки: ${one.label}`)
          },
        }),
    })
  }

  /** What `{{…}}` stands for in a folder name. */
  private expand(text: string, placement: Placement): string {
    const source = placement.source
    return paths.normalize(
      text
        .replace(/\{\{\s*date(?::([^}]*))?\}\}/gi, (_, format: string | undefined) => moment().format(format?.trim() || 'YYYY-MM-DD'))
        .replace(/\{\{\s*folder\s*\}\}/gi, source ? paths.dirname(source) : '')
        .replace(/\{\{\s*source\s*\}\}/gi, source ? paths.stripExt(paths.basename(source)) : '')
        .replace(/\{\{\s*name\s*\}\}/gi, placement.name),
    )
  }

  /** The rules, as written: one per line, `from → to`. */
  private rules(): Rule[] {
    const rules: Rule[] = []
    for (const line of (this.getSetting<string>('rules') ?? '').split('\n')) {
      const parts = line.trim().split(/\s*(?:→|->|=>)\s*/)
      if (parts.length !== 2 || !parts[1]) continue
      const clean = (text: string) => (/^[*/.]$/.test(text.trim()) ? text.trim() : paths.normalize(text.trim()))
      rules.push({ from: clean(parts[0]), to: clean(parts[1]) })
    }
    return rules
  }

  /** The folder the rules give for a note made from `source`: the deepest matching, then `*`. */
  private byRules(placement: Placement): string | undefined {
    const folder = placement.source ? paths.dirname(placement.source) : ''
    let best: { rule: Rule; depth: number } | undefined
    for (const rule of this.rules()) {
      const depth = rule.from === '*' ? 0 : rule.from === '/' || rule.from === '.' ? (folder === '' ? 1 : -1) : folder === rule.from || folder.startsWith(`${rule.from}/`) ? rule.from.split('/').length + 1 : -1
      if (depth >= 0 && (!best || depth > best.depth)) best = { rule, depth }
    }
    if (!best) return undefined
    return /^[/.]$/.test(best.rule.to) ? '' : this.expand(best.rule.to, placement)
  }

  /** The folder for a way of choosing, or `undefined` if it gives none (no rule fits). */
  private folderFor(where: Exclude<Where, 'all' | 'ask'>, placement: Placement): string | undefined {
    const source = placement.source ? paths.dirname(placement.source) : ''
    switch (where) {
      case 'keep':
        return placement.folder
      case 'core':
        return this.app.creation.defaultFolder()
      case 'root':
        return ''
      case 'source':
        return source
      case 'sub': {
        const name = this.expand(this.getSetting<string>('subfolder') || 'Заметки', placement)
        return paths.join(source, name)
      }
      case 'folder':
        return this.expand(this.getSetting<string>('folder') ?? '', placement)
      case 'rules':
        return this.byRules(placement)
      case 'recent':
        return this.last()
    }
  }

  private async locate(placement: Placement): Promise<string | null> {
    const chosen = this.getSetting<Where>(placement.origin) ?? 'all'
    const common = this.getSetting<Where>('all')
    // «Как выше» follows the common choice; the common choice itself is never «как выше».
    const where: Exclude<Where, 'all'> = chosen !== 'all' ? chosen : common && common !== 'all' ? common : 'source'
    // A folder the user named is theirs, unless the settings say otherwise.
    if (placement.explicit && this.getSetting<boolean>('keepExplicit') !== false) return placement.folder
    if (where === 'ask') return this.ask(placement)
    // No rule fits, or nothing was made yet: what the main settings say.
    return this.folderFor(where, placement) ?? this.app.creation.defaultFolder()
  }

  /**
   * Asks where the note goes: the places the settings name come first, then every folder of the vault, narrowing as
   * it is typed; a name no folder has makes a new one. Closing the question makes no note.
   */
  private ask(placement: Placement): Promise<string | null> {
    const { app } = this
    interface Choice {
      folder: string
      label: string
      detail?: string
    }
    const smart: Choice[] = []
    const offer = (folder: string | undefined, detail: string) => {
      if (folder === undefined || smart.some((one) => one.folder === folder)) return
      smart.push({ folder, label: folder || 'Корень хранилища', detail })
    }
    offer(placement.explicit ? placement.folder : undefined, 'как названо')
    if (placement.source) offer(this.folderFor('source', placement), 'рядом с заметкой')
    offer(this.folderFor('sub', placement), 'подпапка рядом с заметкой')
    if (this.getSetting<string>('folder')) offer(this.folderFor('folder', placement), 'указанная папка')
    offer(this.byRules(placement), 'по правилам')
    offer(this.last(), 'в прошлый раз')
    offer('', 'корень')
    const named = new Set(smart.map((one) => one.folder))
    return new Promise((resolve) => {
      app.suggest<Choice>({
        placeholder: `Куда положить «${placement.name}»…`,
        items: (query) => {
          const typed = query.trim().toLowerCase()
          const folders = app.vault
            .all()
            .filter((entry) => entry.kind === 'folder' && !entry.path.startsWith('.') && !named.has(entry.path))
            .map((entry): Choice => ({ folder: entry.path, label: entry.path }))
            .sort((a, b) => a.label.localeCompare(b.label))
          return [...smart, ...folders].filter((one) => !typed || one.label.toLowerCase().includes(typed)).slice(0, 80)
        },
        label: (one) => one.label,
        detail: (one) => one.detail,
        icon: () => ({ icon: 'folder' }),
        onChoose: (one) => resolve(one.folder),
        // A name that no folder has is a new folder.
        onCreate: (name) => resolve(this.expand(name, placement)),
        createLabel: (name) => `Создать папку «${paths.normalize(name)}»`,
        onCancel: () => resolve(null),
      })
    })
  }
}
