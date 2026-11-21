import { mount, unmount } from 'svelte'
import { cm, errorMessage, path, Plugin, setProperties, whenQuiet, type Off } from '../../api'
import { objectCompletion } from './complete'
import { objectLinkColors, objectsChanged } from './links'
import { fileName, LIFE_FIELDS, type TypeDef } from './model'
import MyLife from './MyLife.svelte'
import NewTypeDialog from './NewTypeDialog.svelte'
import ObjectPanel from './ObjectPanel.svelte'
import { Registry, type ObjectSettings } from './registry'
import './style.css'

const LIFE_VIEW = 'objects-my-life'

/**
 * Notes as objects (Tana, Anytype; ICOR's My Life). A type is a note of the types folder with its icon, colour,
 * folder and fields; an object is a note whose `type` links to it. `@` in a note links objects and makes them,
 * links to objects are drawn in their type's look, the panel shows a note as an object with its connections, and
 * the «My Life» tab is the map of Key Elements, Projects, Topics and Habits with what has no place on it yet.
 */
export default class Objects extends Plugin {
  private registry = new Registry(this.app, () => this.options())
  private dialogs = new Set<() => void>()
  private typeCommands: Off[] = []
  private typeCommandsFor = ''

  private options(): ObjectSettings {
    return {
      typesFolder: this.getSetting<string>('typesFolder') || 'Типы',
      innerFolder: path.normalize(this.getSetting<string>('innerFolder') ?? ''),
      outerFolder: path.normalize(this.getSetting<string>('outerFolder') ?? ''),
      starters: this.getSetting<boolean>('starters') !== false,
    }
  }

  onload() {
    const { app, registry } = this
    this.addSettings([
      { key: 'typesFolder', name: 'Папка типов', desc: 'Каждый тип — заметка в этой папке: её свойства говорят, какой у типа значок, цвет, папка и поля', type: 'text', default: 'Типы' },
      { key: 'innerFolder', name: 'Папка внутреннего мира', desc: 'Ваше собственное: заметки, цели, проекты, темы. Новые типы этого мира кладут объекты сюда', type: 'text', default: 'Внутренний мир' },
      { key: 'outerFolder', name: 'Папка внешнего мира', desc: 'Созданное другими: люди, источники, компании, инструменты', type: 'text', default: 'Внешний мир' },
      { key: 'starters', name: 'Стартовые типы', desc: 'Предлагать после @ типы «Моей жизни» и обычные объекты (человек, источник, компания), пока их заметок ещё нет', type: 'toggle', default: true },
      { key: 'at', name: 'Ссылки через @', desc: '@ в заметке предлагает типы, @тип/ — объекты этого типа, Enter вставляет ссылку или создаёт объект', type: 'toggle', default: true },
      { key: 'colorLinks', name: 'Цвет ссылок на объекты', desc: 'Ссылка на объект окрашена в цвет его типа', type: 'toggle', default: true },
    ])
    this.onSettingChange(() => {
      registry.reset()
      this.changed()
    })

    // A note that is an object looks like its type wherever files are drawn: the file list, tabs, links, suggestions.
    this.register(
      app.icons.provide((kind, id) => {
        if (kind !== 'file' || !id.endsWith('.md')) return undefined
        const type = registry.typeOf(id) ?? registry.typeAt(id)
        return type ? { icon: type.icon, color: type.color } : undefined
      }),
    )
    // When objects come, go or change type, what shows them is drawn again; not on every keystroke.
    const recheck = whenQuiet(() => {
      const before = registry.signature
      void registry.types()
      if (registry.signature !== before) this.changed()
    })
    this.register(recheck.cancel)
    this.register(app.metadata.on('resolved', () => recheck()))

    this.registerCompletionSource((context) =>
      this.getSetting<boolean>('at') === false ? null : objectCompletion(app, registry, { newType: (name) => this.newType(name), pickType: (name) => this.pickType(`Новый «${name}» — какого типа?`) })(context),
    )
    this.registerEditorExtension(objectLinkColors(app, registry))

    this.addPanel({
      id: 'object',
      title: 'Объект',
      side: 'right',
      icon: 'M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9zM2.6 4.9L8 8l5.4-3.1M8 8v6.2',
      mount: (target) => {
        const panel = mount(ObjectPanel, { target, props: { app, registry, run: (id: string) => app.commands.run(`objects:${id}`) } })
        return () => void unmount(panel)
      },
    })

    this.registerView(
      LIFE_VIEW,
      ({ containerEl }) => {
        const view = mount(MyLife, {
          target: containerEl,
          props: { app, registry, place: (note: string) => void this.place(note), create: (type: TypeDef) => void this.askObject(type) },
        })
        return { destroy: () => void unmount(view) }
      },
      [],
    )

    this.addCommand({ id: 'my-life', name: 'Объекты: открыть «Мою жизнь»', icon: 'map', scope: 'vault', callback: () => app.workspace.openView(LIFE_VIEW, 'Моя жизнь') })
    this.addCommand({ id: 'new-type', name: 'Объекты: новый тип…', icon: 'shapes', scope: 'vault', callback: () => void this.newType('') })
    this.addCommand({
      id: 'new-object',
      name: 'Объекты: новый объект…',
      icon: 'plus',
      scope: 'vault',
      callback: () => void this.pickType('Какой объект создать?').then((type) => type && this.askObject(type)),
    })
    this.addCommand({
      id: 'new-object-here',
      name: 'Объекты: новый объект этого типа',
      icon: 'plus',
      callback: () => {
        const type = registry.typeAt(app.workspace.active?.path ?? '') ?? registry.typeOf(app.workspace.active?.path ?? '')
        if (type) void this.askObject(type)
        else app.commands.run('objects:new-object')
      },
    })
    this.addCommand({ id: 'open-type', name: 'Объекты: открыть тип…', icon: 'shapes', callback: () => void this.pickType('Какой тип открыть?').then((type) => type && this.openType(type)) })
    this.addCommand({
      id: 'set-type',
      name: 'Объекты: задать тип заметки…',
      icon: 'tag',
      scope: 'note',
      callback: () => {
        const note = this.activeNote()
        if (!note) return
        void this.pickType(`Тип для «${path.stripExt(path.basename(note))}»`).then(async (type) => {
          if (!type) return
          try {
            await registry.setType(note, type)
          } catch (err) {
            app.notice(`Не удалось задать тип: ${errorMessage(err)}`)
          }
        })
      },
    })
    this.addCommand({
      id: 'remove-type',
      name: 'Объекты: убрать тип заметки',
      icon: 'x',
      scope: 'note',
      callback: () => {
        const note = this.activeNote()
        if (note && registry.typeOf(note)) void registry.setType(note, null)
        else app.notice('Эта заметка — не объект')
      },
    })
    this.addCommand({ id: 'place', name: 'Объекты: разместить заметку в «Моей жизни»…', icon: 'map-pin', scope: 'note', callback: () => {
      const note = this.activeNote()
      if (note) void this.place(note)
    } })
    this.addCommand({
      id: 'insert',
      name: 'Объекты: вставить ссылку на объект',
      icon: 'at-sign',
      scope: 'insert',
      callback: () => {
        const editor = app.workspace.activeEditor
        if (!editor) return app.notice('Откройте заметку, чтобы вставить ссылку')
        const { from, to } = editor.state.selection.main
        const before = editor.state.sliceDoc(from - 1, from)
        const insert = before && !/\s/.test(before) ? ' @' : '@'
        editor.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } })
        editor.focus()
        cm.autocomplete.startCompletion(editor)
      },
    })
    this.addCommand({
      id: 'capture',
      name: 'Объекты: быстрая мысль',
      icon: 'lightbulb',
      scope: 'vault',
      callback: () => this.capture(),
    })
    this.addCommand({
      id: 'add-missing-fields',
      name: 'Объекты: дописать объектам поля их типа',
      icon: 'list-plus',
      callback: () => {
        const note = this.activeNote()
        const type = note ? (registry.typeAt(note) ?? registry.typeOf(note)) : undefined
        if (!type) return app.notice('Откройте тип или объект')
        void registry.addMissingFields(type).then((n) => app.notice(n ? `Поля дописаны: ${n}` : 'У всех объектов уже есть все поля'))
      },
    })
    this.addCommand({
      id: 'write-starters',
      name: 'Объекты: создать заметки стартовых типов',
      icon: 'shapes',
      callback: () => void registry.writeStarters().then((n) => app.notice(n ? `Создано типов: ${n}` : 'Все стартовые типы уже есть')),
    })

    // Other plugins (the properties form) ask which values a property can take: a relation field offers the objects of its type.
    this.provide('objects', {
      typeOf: (note: string) => registry.typeOf(note),
      types: () => registry.types(),
      suggestValues: (key: string, source: string): string[] => {
        const type = registry.relationOf(key)
        if (!type || key === 'type') return key === 'type' ? registry.types().filter((t) => t.path).map((t) => `[[${app.metadata.linkText(t.path, source)}]]`) : []
        return registry.objects(type).map((note) => `[[${app.metadata.linkText(note, source)}]]`)
      },
    })

    this.register(() => {
      for (const off of this.typeCommands) off()
      for (const close of [...this.dialogs]) close()
    })
    void app.metadata.ready.then(() => this.refreshTypeCommands())
  }

  /** Tells everything that draws objects that they changed. */
  private changed(): void {
    this.app.icons.refresh()
    this.app.editor.each((editor) => editor.dispatch({ effects: objectsChanged.of(null) }))
    this.refreshTypeCommands()
  }

  /** «New Person», «New Project», …: one command per type, so each can have its button. */
  private refreshTypeCommands(): void {
    const types = this.registry.types()
    const key = types.map((type) => `${type.name}:${type.icon}`).join('|')
    if (key === this.typeCommandsFor) return
    this.typeCommandsFor = key
    for (const off of this.typeCommands) off()
    this.typeCommands = types.map((type) =>
      this.app.commands.add({
        id: `objects:new:${type.name}`,
        name: `Объекты: новый объект «${type.name}»`,
        icon: type.icon,
        callback: () => {
          const current = this.registry.find(type.name)
          if (current) void this.askObject(current)
        },
      }),
    )
  }

  private activeNote(): string | null {
    const note = this.app.workspace.active?.path
    if (note && note.endsWith('.md') && this.app.vault.get(note)) return note
    this.app.notice('Откройте заметку')
    return null
  }

  /** Asks for a type; typing a name no type has makes a new one. */
  private pickType(placeholder: string): Promise<TypeDef | null> {
    return new Promise((resolve) => {
      this.app.suggest<TypeDef>({
        placeholder,
        items: (query) => this.registry.matching(query),
        label: (type) => type.name,
        detail: (type) => [type.aliases[0], type.path ? '' : 'ещё не создан'].filter(Boolean).join(' · ') || undefined,
        icon: (type) => ({ icon: type.icon, color: type.color }),
        onChoose: (type) => resolve(type),
        onCancel: () => resolve(null),
        onCreate: (name) => void this.newType(name).then(resolve),
        createLabel: (name) => `Новый тип «${name}»…`,
      })
    })
  }

  /** Opens the «new type» dialog; resolves with the type made, or `null`. */
  newType(name: string): Promise<TypeDef | null> {
    const { innerFolder, outerFolder } = this.options()
    return new Promise((resolve) => {
      const target = document.body.appendChild(document.createElement('div'))
      const close = (type: TypeDef | null) => {
        this.dialogs.delete(cancel)
        void unmount(dialog)
        target.remove()
        if (type) {
          this.app.notice(`Тип «${type.name}» создан: наберите @${type.name}/, чтобы связать объект`)
          this.changed()
        }
        resolve(type)
      }
      const cancel = () => close(null)
      const dialog = mount(NewTypeDialog, { target, props: { app: this.app, registry: this.registry, name, inner: innerFolder, outer: outerFolder, onclose: close } })
      this.dialogs.add(cancel)
    })
  }

  /** Asks for the name of a new object of the type: an existing one is opened, a new name is made and opened. */
  private askObject(type: TypeDef): void {
    this.app.suggest<string>({
      placeholder: `${type.name}: имя`,
      items: (query) => {
        const wanted = query.trim().toLowerCase()
        return this.registry.objects(type).filter((note) => !wanted || path.basename(note).toLowerCase().includes(wanted))
      },
      label: (note) => path.stripExt(path.basename(note)),
      icon: () => ({ icon: type.icon, color: type.color }),
      onChoose: (note) => this.app.workspace.openFile(note),
      onCreate: (name) =>
        void this.registry
          .createObject(type, name)
          .then((note) => this.app.workspace.openFile(note))
          .catch((err) => this.app.notice(`Не удалось создать «${name}»: ${errorMessage(err)}`)),
      createLabel: (name) => `Создать «${name}»`,
    })
  }

  private async openType(type: TypeDef): Promise<void> {
    try {
      const made = await this.registry.ensure(type)
      this.app.workspace.openFile(made.path)
    } catch (err) {
      this.app.notice(`Не удалось открыть тип: ${errorMessage(err)}`)
    }
  }

  /**
   * Gives a note its place on the map: links it to a Key Element, a Project or a Topic under the property of
   * that part (`project: [[Launch]]`). A note that is no object yet becomes a Note first.
   */
  private async place(note: string): Promise<void> {
    const parts = this.registry.types().filter((type) => type.lifePart && LIFE_FIELDS.includes(type.lifePart))
    const items = parts.flatMap((type) => this.registry.objects(type).map((target) => ({ type, target })))
    if (!items.length) return this.app.notice('На карте пока ничего нет: добавьте ключевой элемент, проект или тему в «Моей жизни»')
    this.app.suggest<{ type: TypeDef; target: string }>({
      placeholder: `Куда относится «${path.stripExt(path.basename(note))}»?`,
      items: (query) => {
        const wanted = query.trim().toLowerCase()
        return items.filter((item) => !wanted || path.basename(item.target).toLowerCase().includes(wanted))
      },
      label: (item) => path.stripExt(path.basename(item.target)),
      detail: (item) => item.type.name,
      icon: (item) => ({ icon: item.type.icon, color: item.type.color }),
      onChoose: async ({ type, target }) => {
        try {
          const field = type.lifePart!
          const frontmatter = this.app.metadata.get(note)?.frontmatter ?? {}
          const link = `[[${this.app.metadata.linkText(target, note)}]]`
          const had = frontmatter[field]
          const list = (Array.isArray(had) ? had : had ? [had] : []).map(String)
          if (list.includes(link)) return
          const changes: Record<string, unknown> = { [field]: list.length ? [...list, link] : link }
          if (!this.registry.typeOf(note)) {
            const plain = this.registry.find('Note') ?? this.registry.find('Заметка')
            if (plain) {
              await this.registry.setType(note, plain)
            }
          }
          await setProperties(this.app, note, changes)
        } catch (err) {
          this.app.notice(`Не удалось разместить: ${errorMessage(err)}`)
        }
      },
    })
  }

  /** A thought caught in a moment: a Note named by its first words, to be placed on the map later. */
  private capture(): void {
    const type = this.registry.find('Note') ?? this.registry.find('Заметка') ?? this.registry.types()[0]
    if (!type) return this.app.notice('Нет ни одного типа')
    this.app.suggest<never>({
      placeholder: 'Мысль: что пришло в голову?',
      items: () => [],
      label: () => '',
      onChoose: () => {},
      onCreate: (text) =>
        void (async () => {
          try {
            const name = fileName(text.length > 60 ? `${text.slice(0, 60).replace(/\s+\S*$/, '')}…` : text)
            const note = await this.registry.createObject(type, name)
            if (name !== text) {
              const written = await this.app.vault.read(note)
              await this.app.vault.write(note, `${written}${text}\n`)
            }
            this.app.notice(`Записано в «${type.name}»: ${name}`)
          } catch (err) {
            this.app.notice(`Не удалось записать: ${errorMessage(err)}`)
          }
        })(),
      createLabel: (text) => `Записать: «${text}»`,
    })
  }
}

