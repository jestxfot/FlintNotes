import { cm, errorMessage, expandVariables, path as paths, Plugin, type Draft, type Moment, type VaultEntry } from '../../api'
import { prompt } from './dialogs'
import { execute, TemplateError } from './engine'
import { obsidianApp } from './obsidian'
import { lines, parseRules, templateFor } from './rules'
import './style.css'
import { templateSyntax } from './syntax'
import { buildTp, type Run } from './tp'

/** What other plugins get from `app.services.get('templates')`. */
export interface TemplatesService {
  /** Paths of the available templates. */
  list(): string[]
  /** Finds a template by path or by name, with or without `.md`. */
  resolve(name: string): string | null
  /**
   * Fills in a template for a note that is about to be created. Returns the
   * text and the note's path (a template may rename it); call `done` once the
   * note has been written.
   */
  render(template: string, target: string, options?: { date?: Moment }): Promise<{ text: string; target: string; done(): Promise<void> }>
}

const CURSOR = /<%\s*tp\.file\.cursor\(\s*(-?\d*\.?\d*)\s*\)\s*%>/g

export default class Templates extends Plugin {
  private obsidian = obsidianApp(this.app)
  /** How many templates are running, and the global `app` to put back when the last one ends. */
  private running = 0
  private ownApp: unknown
  /** Notes this plugin is creating itself; the "new note" rule must not fire for them. */
  private creating = new Set<string>()
  private scriptCache = new Map<string, { mtime: number; value: unknown }>()

  async onload() {
    const { app } = this
    this.addCommand({
      id: 'system-commands',
      name: 'Системные команды шаблонов',
      callback: async () => {
        const { file, vault, commands } = await app.vault.systemCommands()
        const example = JSON.stringify({ systemCommands: { [vault]: { commands: { hello: 'echo Hello, %name%' }, timeout: 5 } } }, null, 2)
        // Shown in a text field so that the example can be copied.
        void prompt(
          `Разрешено сейчас: ${commands.join(', ') || 'ничего'}. Команды вписываются вручную в файл ${file} — так заметка или скрипт из хранилища не может разрешить запуск программы сама. В шаблоне: <% await tp.user.hello({ name: "мир" }) %>`,
          example,
          true,
        )
      },
    })
    this.registerMarkdownSyntax(templateSyntax)
    this.showCommands()
    this.addSettings([
      { key: 'folder', name: 'Папка с шаблонами', type: 'text', default: 'Шаблоны' },
      {
        key: 'onCreate',
        name: 'Применять шаблон к новым заметкам',
        desc: 'Новая пустая заметка заполняется по первому подходящему правилу',
        type: 'toggle',
        default: true,
      },
      {
        key: 'ask',
        name: 'Спрашивать шаблон для новой заметки',
        desc: 'Новая заметка (кнопка «+», команда, переход по ссылке на несуществующую заметку) открывает список шаблонов; первым стоит шаблон по правилам. Esc оставляет заметку пустой',
        type: 'toggle',
        default: true,
      },
      {
        key: 'rules',
        name: 'Правила для новых заметок',
        desc: 'По правилу в строке: «папка = шаблон». Чем выше правило, тем оно главнее. «/» значит любая заметка (общий шаблон, ставьте его последним), «re:выражение» проверяет путь регулярным выражением',
        type: 'lines',
        default: '',
        placeholder: 'Проекты/Клиенты = Клиент\nПроекты = Проект\nre:^Встречи/\\d{4} = Встреча\n/ = Заметка',
      },
      { key: 'excluded', name: 'Папки без шаблонов', desc: 'По папке в строке; новые заметки в них не заполняются', type: 'lines', default: '' },
      {
        key: 'autoJump',
        name: 'Ставить курсор на метку',
        desc: 'После вставки шаблона курсор переходит на место <% tp.file.cursor() %>',
        type: 'toggle',
        default: true,
      },
      {
        key: 'scripts',
        name: 'Папка со скриптами',
        desc: 'Файлы .js из неё доступны в шаблонах как tp.user.имя_файла(...)',
        type: 'text',
        default: '',
      },
      { key: 'startup', name: 'Шаблоны при запуске', desc: 'По шаблону в строке; выполняются при старте, их текст никуда не вставляется', type: 'lines', default: '' },
      {
        key: 'hotkeys',
        name: 'Шаблоны с командами',
        desc: 'По строке «шаблон» или «шаблон = Mod+Alt+1»: для него появится команда вставки. Изменения действуют после повторного включения плагина',
        type: 'lines',
        default: '',
      },
    ])
    await this.importFromObsidian(false)

    // Cursor marks with the same number become several cursors at once.
    this.registerEditorExtension(cm.state.EditorState.allowMultipleSelections.of(true))

    const service: TemplatesService = {
      list: () => this.list(),
      resolve: (name) => this.resolve(name),
      render: async (template, target, options) => {
        const path = this.resolve(template)
        if (!path) throw new TemplateError(`шаблон «${template}» не найден`)
        const hooks: Run['hooks'] = []
        const result = await this.run(await app.vault.read(path), { template: path, target, mode: 'CreateNewFromTemplate', date: options?.date, hooks })
        this.creating.add(result.target)
        return { ...result, done: () => this.finish(hooks) }
      },
    }
    this.provide('templates', service)

    this.addCommand({ id: 'insert', name: 'Вставить шаблон', scope: 'note', icon: 'layout-template', hotkey: 'Alt+E', callback: () => this.pick((path) => this.insert(path)) })
    this.addCommand({ id: 'create', name: 'Создать заметку из шаблона', scope: 'vault', icon: 'file-plus-2', hotkey: 'Mod+Alt+N', callback: () => this.pick((path) => this.createFrom(path)) })
    this.addCommand({ id: 'replace', name: 'Выполнить команды шаблона в этой заметке', scope: 'note', icon: 'layout-template', hotkey: 'Mod+Alt+R', callback: () => void this.replaceInActive() })
    this.addCommand({
      id: 'next-cursor',
      name: 'Перейти к следующей метке курсора',
      hotkey: 'Alt+J',
      callback: () => {
        const editor = app.workspace.activeEditor
        if (!editor || !jumpToCursor(editor)) app.notice('Меток курсора больше нет')
      },
    })
    this.addCommand({ id: 'import', name: 'Взять настройки шаблонов из Obsidian', callback: () => void this.importFromObsidian(true) })

    for (const line of lines(this.getSetting<string>('hotkeys'))) {
      const [name, hotkey] = line.split('=').map((part) => part.trim())
      const path = this.resolve(name)
      if (!path) continue
      const title = paths.stripExt(paths.basename(path))
      this.addCommand({ id: `insert:${path}`, name: `Вставить шаблон «${title}»`, hotkey: hotkey || undefined, callback: () => void this.insert(path) })
    }

    this.register(app.vault.on('created-here', (entry) => void this.onCreated(entry)))
    app.creation.prepare = (path) => this.prepare(path)
    this.register(() => (app.creation.prepare = null))

    for (const name of lines(this.getSetting<string>('startup'))) {
      const path = this.resolve(name)
      if (!path) continue
      const hooks: Run['hooks'] = []
      this.guard(name, async () => {
        await this.run(await app.vault.read(path), { template: path, target: app.workspace.active?.path ?? '', mode: 'StartupTemplate', hooks })
        await this.finish(hooks)
      })
    }
  }

  // ---- finding templates ----

  private get folder(): string {
    return paths.normalize(this.getSetting<string>('folder'))
  }

  private list(): string[] {
    const prefix = `${this.folder}/`
    return this.app.vault
      .files()
      .filter((file) => file.path.startsWith(prefix) && paths.extname(file.path) === 'md')
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  private resolve(name: string): string | null {
    const { vault, metadata } = this.app
    const wanted = paths.normalize(name)
    for (const candidate of [wanted, `${wanted}.md`, `${this.folder}/${wanted}`, `${this.folder}/${wanted}.md`]) {
      if (vault.get(candidate)?.kind === 'file') return candidate
    }
    return metadata.resolve(wanted, `${this.folder}/x.md`)
  }

  private pick(use: (path: string) => unknown): void {
    const templates = this.list()
    if (!templates.length) {
      this.app.notice(`В папке «${this.folder}» нет шаблонов. Папка задаётся в настройках плагина «Шаблоны»`)
      return
    }
    const label = (path: string) => paths.stripExt(path.slice(this.folder.length + 1))
    this.app.suggest<string>({
      placeholder: 'Шаблон…',
      items: (query) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean)
        return templates.filter((path) => words.every((word) => label(path).toLowerCase().includes(word)))
      },
      label,
      onChoose: (path) => void use(path),
    })
  }

  // ---- running ----

  /** Functions from the scripts folder, for `tp.user`. A file exports a function or an object of functions. */
  private async scripts(): Promise<Record<string, unknown>> {
    const folder = paths.normalize(this.getSetting<string>('scripts'))
    const result: Record<string, unknown> = {}
    // Programs the user allowed (Templater's "system command user functions"): `tp.user.name({ key: value })`
    // runs the program with the values as environment variables and gives back what it printed.
    const allowed = await this.app.vault.systemCommands().catch(() => ({ commands: [] as string[] }))
    for (const name of allowed.commands) result[name] = (args: Record<string, unknown> = {}) => this.app.vault.exec(name, args)
    if (!folder) return result
    for (const file of this.app.vault.files()) {
      if (!file.path.startsWith(`${folder}/`) || paths.extname(file.path) !== 'js') continue
      let cached = this.scriptCache.get(file.path)
      if (cached?.mtime !== file.mtime) {
        const module = { exports: {} as unknown }
        try {
          // A CommonJS module, as Templater's user scripts are.
          new Function('module', 'exports', 'app', 'moment', await this.app.vault.read(file.path))(module, module.exports, this.obsidian, (globalThis as any).moment)
        } catch (err) {
          this.app.notice(`Скрипт «${file.path}»: ${errorMessage(err)}`)
          continue
        }
        this.scriptCache.set(file.path, (cached = { mtime: file.mtime, value: module.exports }))
      }
      result[paths.stripExt(paths.basename(file.path))] = cached.value
    }
    return result
  }

  /**
   * In the editor, template code is set apart from the text, and a dynamic
   * command, `<%+ tp.date.now() %>`, shows its value, worked out each time the
   * note is drawn (the code appears when the cursor is in it).
   */
  private showCommands(): void {
    const plugin = this
    class DynamicValue extends cm.view.WidgetType {
      constructor(
        readonly source: string,
        readonly path: string,
      ) {
        super()
      }
      eq(other: DynamicValue) {
        return other.source === this.source && other.path === this.path
      }
      toDOM() {
        const el = document.createElement('span')
        el.className = 'lp-template-value'
        el.title = this.source
        plugin.run(this.source, { template: null, target: this.path, mode: 'DynamicProcessor', hooks: [] }).then(
          (made) => (el.textContent = made.text),
          (err) => {
            el.classList.add('error')
            el.textContent = `Шаблон: ${errorMessage(err)}`
          },
        )
        return el
      }
    }
    this.registerPreviewRenderer({
      name: 'template-commands',
      nodes: ['TemplateCommand', 'TemplateBlock'],
      render: (node, ctx) => {
        if (node.name === 'TemplateBlock') {
          ctx.lines(node.from, node.to, (line) => ctx.line(line.from, 'lp-template-line'))
          return false
        }
        const text = ctx.text(node.from, node.to)
        // In a template itself the command is what is being written, so it stays as code there.
        const folder = this.getSetting<string>('folder').replace(/^\/+|\/+$/g, '')
        const isTemplate = !!folder && ctx.path.startsWith(`${folder}/`)
        if (text.startsWith('<%+') && !isTemplate && !ctx.isActive(node.from, node.to)) ctx.replace(node.from, node.to, new DynamicValue(`<%${text.slice(3)}`, ctx.path))
        else ctx.mark(node.from, node.to, { class: 'lp-template' })
        return false
      },
    })
  }

  /** Fills in template text for a note. */
  private async run(
    text: string,
    options: Pick<Run, 'template' | 'target' | 'mode' | 'hooks'> & Partial<Pick<Run, 'content' | 'selection' | 'date' | 'depth' | 'scripts'>>,
  ): Promise<{ text: string; target: string }> {
    const { app } = this
    const run: Run = {
      app,
      obsidian: this.obsidian,
      content: '',
      selection: '',
      depth: 0,
      scripts: options.scripts ?? (await this.scripts()),
      ...options,
      include: async (included, template) =>
        (await this.run(included, { ...options, template, target: run.target, depth: run.depth + 1, scripts: run.scripts, hooks: run.hooks })).text,
      createNew: async (template, body, name, folder, open) => {
        const target = app.vault.uniquePath(folder, name.replace(/\.md$/i, ''), 'md')
        const made = await this.run(body, { template, target, mode: 'CreateNewFromTemplate', depth: run.depth + 1, scripts: run.scripts, hooks: run.hooks })
        this.creating.add(made.target)
        await app.vault.create(made.target, made.text)
        if (open) app.workspace.openFile(made.target)
        return made.target
      },
    }
    const title = paths.stripExt(paths.basename(run.target))
    const expanded = expandVariables(text, title, run.date)
    if (!expanded.includes('<%')) return { text: expanded, target: run.target }
    const moment = (globalThis as any).moment
    // Code a template builds itself (`new Function(code)`, the way long scripts are run) sees only the
    // global `app`, so while templates run that name too stands for Obsidian's app, as it does in Obsidian.
    const scope = globalThis as { app?: unknown }
    if (!this.running++) {
      this.ownApp = scope.app
      scope.app = this.obsidian
    }
    try {
      const out = await execute(expanded, { tp: buildTp(run), app: this.obsidian, moment })
      return { text: out, target: run.target }
    } finally {
      if (!--this.running) scope.app = this.ownApp
    }
  }

  /** Runs what templates asked to be run after everything has been written. */
  private async finish(hooks: Run['hooks']): Promise<void> {
    for (const hook of hooks.splice(0)) {
      try {
        await hook()
      } catch (err) {
        this.app.notice(`Шаблон: ${errorMessage(err)}`)
      }
    }
  }

  /** Reports a template's failure instead of letting it break the action that started it. */
  private guard(template: string, action: () => Promise<void>): void {
    action().catch((err) => {
      if (!(err instanceof TemplateError) || err.message !== 'отменено') console.error(err)
      this.app.notice(`Шаблон «${paths.stripExt(paths.basename(template))}»: ${errorMessage(err)}`, 8000)
    })
  }

  private autoJump(): void {
    if (!this.getSetting<boolean>('autoJump')) return
    // The editor may still be loading the text that was just written.
    let tries = 0
    const attempt = () => {
      const editor = this.app.workspace.activeEditor
      if (editor && jumpToCursor(editor)) return
      if (++tries < 10) setTimeout(attempt, 100)
    }
    attempt()
  }

  // ---- the ways a template gets used ----

  /** Inserts a template at the cursor of the open note. */
  private insert(template: string): void {
    const { app } = this
    const editor = app.workspace.activeEditor
    const target = app.workspace.active?.path
    if (!editor || !target) {
      app.notice('Откройте заметку, чтобы вставить в неё шаблон')
      return
    }
    this.guard(template, async () => {
      const hooks: Run['hooks'] = []
      const selection = editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to)
      const { text } = await this.run(await app.vault.read(template), {
        template,
        target,
        mode: 'AppendActiveFile',
        content: editor.state.doc.toString(),
        selection,
        hooks,
      })
      editor.dispatch(editor.state.replaceSelection(text))
      editor.focus()
      this.autoJump()
      await this.finish(hooks)
    })
  }

  /** Creates a note from a template, next to the open note. */
  private createFrom(template: string): void {
    const { app } = this
    this.guard(template, async () => {
      const hooks: Run['hooks'] = []
      const active = app.workspace.active?.path
      const folder = active && app.vault.get(active) ? paths.dirname(active) : ''
      // Next to the open note, unless a plugin chooses another place for new notes.
      const target = await app.creation.place({ origin: 'template', name: 'Без названия', folder, explicit: false })
      // The user backed out of the question of where.
      if (!target) return
      const made = await this.run(await app.vault.read(template), {
        template,
        target,
        mode: 'CreateNewFromTemplate',
        hooks,
      })
      this.creating.add(made.target)
      await app.vault.create(made.target, made.text)
      app.workspace.openFile(made.target)
      this.autoJump()
      await this.finish(hooks)
    })
  }

  /** Runs the template commands written in the open note itself. */
  private async replaceInActive(): Promise<void> {
    const { app } = this
    const target = app.workspace.active?.path
    if (!target || paths.extname(target) !== 'md') return
    this.guard(target, async () => {
      await app.workspace.flushAll()
      const content = await app.vault.read(target)
      const hooks: Run['hooks'] = []
      const made = await this.run(content, { template: null, target, mode: 'OverwriteActiveFile', content, hooks })
      if (made.text !== content) await app.vault.write(made.target, made.text)
      this.autoJump()
      await this.finish(hooks)
    })
  }

  /** The template the rules name for a note at this path, and whether templates apply there at all. */
  private ruled(path: string): { applies: boolean; template: string | null } {
    const inFolder = (folder: string) => !!folder && `${path}/`.startsWith(`${folder}/`)
    if (!this.getSetting<boolean>('onCreate') || paths.extname(path) !== 'md') return { applies: false, template: null }
    if (inFolder(this.folder) || lines(this.getSetting<string>('excluded')).map(paths.normalize).some(inFolder)) return { applies: false, template: null }
    const name = templateFor(parseRules(this.getSetting<string>('rules')), path)
    const template = name ? this.resolve(name) : null
    if (name && !template) this.app.notice(`Шаблон «${name}» из правил не найден`)
    return { applies: true, template }
  }

  /**
   * A note is about to be created: the user chooses its template, the template
   * asks what it needs, and only then is there a note. Backing out of the
   * choice or of a question, or a mistake in the template, leaves nothing behind.
   */
  private async prepare(path: string): Promise<Draft | null> {
    const { app } = this
    const empty: Draft = { path, text: '' }
    const { applies, template: ruled } = this.ruled(path)
    if (!applies) return empty
    const all = this.list()
    let template: string | null | undefined = ruled
    if (this.getSetting<boolean>('ask') && all.length) {
      // The template the rules name comes first, so Enter is "as usual".
      const choices: (string | null)[] = [...(ruled ? [ruled] : []), ...all.filter((one) => one !== ruled), null]
      const label = (one: string | null) => (one === null ? 'Без шаблона' : paths.stripExt(one.slice(this.folder.length + 1)))
      template = await new Promise<string | null | undefined>((resolve) => {
        app.suggest<string | null>({
          placeholder: `Шаблон для «${paths.stripExt(paths.basename(path))}»…`,
          items: (query) => choices.filter((one) => label(one).toLowerCase().includes(query.trim().toLowerCase())),
          label,
          detail: (one) => (one !== null && one === ruled ? 'по правилам' : undefined),
          icon: (one) => (one ? app.icons.look('file', one) : undefined),
          onChoose: (one) => resolve(one),
          // Closed without a choice: no note.
          onCancel: () => resolve(undefined),
        })
      })
      if (template === undefined) return null
    }
    if (!template) return empty
    const hooks: Run['hooks'] = []
    const from = template
    try {
      const made = await this.run(await app.vault.read(from), { template: from, target: path, mode: 'CreateNewFromTemplate', hooks })
      const target = app.vault.get(made.target) ? app.vault.uniquePath(paths.dirname(made.target), paths.stripExt(paths.basename(made.target)), 'md') : made.target
      this.creating.add(target)
      return {
        path: target,
        text: made.text,
        after: async (entry) => {
          // A note made from a template that has an icon wears that icon, whatever the rules for its folder say.
          const look = app.icons.own?.('file', from)
          if (look) await app.icons.assign?.('file', entry.path, look)
          setTimeout(() => app.workspace.active?.path === entry.path && this.autoJump(), 300)
          await this.finish(hooks)
        },
      }
    } catch (err) {
      // Backing out of a template's question is a decision, not a failure: nothing is said about it.
      if (!(err instanceof TemplateError && err.message === 'отменено')) app.notice(`Шаблон «${paths.stripExt(paths.basename(from))}»: ${errorMessage(err)}. Заметка не создана`, 8000)
      return null
    }
  }

  /** A note created by something else here (not through the app's "new note"): an empty one is filled in by the rule that fits. */
  private async onCreated(entry: VaultEntry): Promise<void> {
    if (this.creating.delete(entry.path) || entry.size > 0) return
    const { template } = this.ruled(entry.path)
    if (template) this.fill(entry, template)
  }

  /** Fills a note that has just been created from a template. */
  private fill(entry: VaultEntry, template: string): void {
    const { app } = this
    this.guard(template, async () => {
      const hooks: Run['hooks'] = []
      const made = await this.run(await app.vault.read(template), { template, target: entry.path, mode: 'CreateNewFromTemplate', hooks })
      // The note may have been renamed, or typed into, while the template was asking questions.
      const target = app.vault.get(made.target) ? made.target : null
      if (!target || (await app.vault.read(target)).trim()) return
      await app.workspace.flushAll()
      await app.vault.write(target, made.text)
      const look = app.icons.own?.('file', template)
      if (look) await app.icons.assign?.('file', target, look)
      if (app.workspace.active?.path === target) this.autoJump()
      await this.finish(hooks)
    })
  }

  /**
   * Copies Templater's (or Obsidian's own templates') settings from the vault,
   * so the same templates and rules work in both apps. Done once by itself on
   * first use; the command repeats it on request.
   */
  private async importFromObsidian(asked: boolean): Promise<void> {
    const { app } = this
    if (!asked && this.getSetting<boolean>('imported')) return
    this.setSetting('imported', true)
    const config = app.obsidianConfig
    const read = async (file: string) => {
      try {
        return JSON.parse((await app.vault.readOptional(`${config}/${file}`)) ?? 'null')
      } catch {
        return null
      }
    }
    const templater = config ? await read('plugins/templater-obsidian/data.json') : null
    const core = config ? await read('templates.json') : null
    if (!templater && !core?.folder) {
      if (asked) app.notice('В хранилище не найдены настройки шаблонов Obsidian')
      return
    }
    this.setSetting('folder', templater?.templates_folder || core?.folder || this.folder)
    if (templater) {
      // Templater picks the deepest matching folder; here the first rule wins, so deeper folders go first.
      const depth = (folder: string) => paths.normalize(folder).split('/').filter(Boolean).length
      const folders = [...(templater.folder_templates ?? [])]
        .filter((rule: any) => rule.folder && rule.template)
        .sort((a: any, b: any) => depth(b.folder) - depth(a.folder))
        .map((rule: any) => `${paths.normalize(rule.folder) || '/'} = ${rule.template}`)
      const patterns = (templater.file_templates ?? []).filter((rule: any) => rule.regex && rule.template).map((rule: any) => `re:${rule.regex} = ${rule.template}`)
      const mode = templater.trigger_on_file_creation_mode
      this.setSetting('rules', (mode === 'regex' ? patterns : mode === 'folder' ? folders : [...patterns, ...folders]).join('\n'))
      this.setSetting('onCreate', templater.trigger_on_file_creation !== false && mode !== 'none')
      this.setSetting('excluded', (templater.ignore_folders_on_creation ?? []).join('\n'))
      this.setSetting('autoJump', !!templater.auto_jump_to_cursor)
      this.setSetting('scripts', templater.user_scripts_folder ?? '')
      this.setSetting('startup', (templater.startup_templates ?? []).filter(Boolean).join('\n'))
      this.setSetting('hotkeys', (templater.enabled_templates_hotkeys ?? []).filter(Boolean).join('\n'))
    }
    app.notice(`Настройки шаблонов взяты из Obsidian (${config})`)
  }
}

/**
 * Moves the cursor to the lowest-numbered `<% tp.file.cursor(n) %>` marks left
 * in the note and removes them. Returns whether there were any.
 */
function jumpToCursor(editor: InstanceType<typeof cm.view.EditorView>): boolean {
  const marks = [...editor.state.doc.toString().matchAll(CURSOR)].map((m) => ({ from: m.index, to: m.index + m[0].length, order: Number(m[1] || 0) }))
  if (!marks.length) return false
  const order = Math.min(...marks.map((mark) => mark.order))
  const chosen = marks.filter((mark) => mark.order === order)
  let removed = 0
  const cursors = chosen.map((mark) => {
    const at = mark.from - removed
    removed += mark.to - mark.from
    return cm.state.EditorSelection.cursor(at)
  })
  editor.dispatch({ changes: chosen.map(({ from, to }) => ({ from, to })), selection: cm.state.EditorSelection.create(cursors) })
  editor.focus()
  return true
}
