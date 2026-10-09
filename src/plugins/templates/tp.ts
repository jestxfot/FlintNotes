import { moment, parseIsoDuration, parseMarkdown, path as paths, type App, type Moment } from '../../api'
import { multiSuggest, prompt } from './dialogs'
import { TemplateError } from './engine'
import { toTFile, type ObsidianApp, type TFile } from './obsidian'

/** One run of a template: what it is filling in, and what it may call back into. */
export interface Run {
  app: App
  obsidian: ObsidianApp
  /** The template being run, or `null` for text that is not a template file. */
  template: string | null
  /** Path of the note being filled. A template may change it with `tp.file.rename` / `move`. */
  target: string
  /** The note's text when the run began. */
  content: string
  /** How the run was started, in Templater's terms. */
  mode: 'CreateNewFromTemplate' | 'AppendActiveFile' | 'OverwriteFile' | 'OverwriteActiveFile' | 'DynamicProcessor' | 'StartupTemplate'
  /** Text selected in the editor when the run began. */
  selection: string
  /** The day a periodic note is for; `{{date}}` and `tp.date.now` without arguments still mean now. */
  date?: Moment
  depth: number
  /** Callbacks registered with `tp.hooks.on_all_templates_executed`. */
  hooks: (() => unknown)[]
  /** Functions from the user's scripts folder, as `tp.user`. */
  scripts: Record<string, unknown>
  /** Renders another template into the same note (for `tp.file.include`). */
  include(text: string, template: string | null): Promise<string>
  /** Creates a note from a template or from plain text (for `tp.file.create_new`). */
  createNew(template: string | null, text: string, name: string, folder: string, open: boolean): Promise<string>
}

const QUOTES = [
  ['Дорогу осилит идущий.', 'Сенека'],
  ['Делай что должен, и будь что будет.', 'Марк Аврелий'],
  ['Сначала мы создаём привычки, затем привычки создают нас.', 'Джон Драйден'],
  ['Лучший способ предсказать будущее — создать его.', 'Алан Кей'],
  ['Простота — предельная степень изощрённости.', 'Леонардо да Винчи'],
  ['Кто хочет — ищет возможности, кто не хочет — ищет причины.', 'Сократ'],
  ['Знание — сила.', 'Фрэнсис Бэкон'],
]

/** The lines of a note under one heading, up to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const headings = parseMarkdown(text).headings
  const index = headings.findIndex((h) => h.text.toLowerCase() === heading.toLowerCase())
  if (index < 0) return text
  const lines = text.split('\n')
  const next = headings.slice(index + 1).find((h) => h.level <= headings[index].level)
  return lines.slice(headings[index].line, next?.line).join('\n').trimEnd()
}

/**
 * Builds `tp`, the object templates call, with Templater's modules:
 * `tp.date`, `tp.file`, `tp.frontmatter`, `tp.system`, `tp.config`, `tp.hooks`,
 * `tp.web`, `tp.user`, `tp.app`.
 */
export function buildTp(run: Run) {
  const { app, obsidian } = run
  const { vault, metadata } = app
  const entry = () => vault.get(run.target)
  const tfile = (path: string): TFile | null => obsidian.vault.getFileByPath(path)
  const stamp = (time: number | undefined, format: string) => moment(time ?? Date.now()).format(format)

  /** A date shifted by days or by an ISO 8601 duration ("P1M"), optionally counted from another date. */
  const shifted = (offset?: number | string, reference?: string, referenceFormat?: string): Moment => {
    const date = reference ? moment(reference, referenceFormat) : moment()
    if (!date.isValid()) throw new TemplateError(`не удалось прочитать дату «${reference}»`)
    if (typeof offset === 'number') return date.add(offset, 'day')
    if (typeof offset === 'string' && offset) {
      const duration = parseIsoDuration(offset)
      if (!duration) throw new TemplateError(`непонятный сдвиг даты «${offset}», нужен вид P1D, P-1M, P1Y`)
      return date.add(duration)
    }
    return date
  }

  const date = {
    now: (format = 'YYYY-MM-DD', offset?: number | string, reference?: string, referenceFormat?: string) =>
      shifted(offset, reference, referenceFormat).format(format),
    tomorrow: (format = 'YYYY-MM-DD') => moment().add(1, 'day').format(format),
    yesterday: (format = 'YYYY-MM-DD') => moment().subtract(1, 'day').format(format),
    /** `weekday`: 0 is this week's Monday, 7 next Monday, -7 last Monday. */
    weekday: (format = 'YYYY-MM-DD', weekday = 0, reference?: string, referenceFormat?: string) =>
      shifted(undefined, reference, referenceFormat).startOf('isoWeek').add(weekday, 'day').format(format),
  }

  const file = {
    get content() {
      return run.content
    },
    get title() {
      return paths.stripExt(paths.basename(run.target))
    },
    get tags() {
      return (metadata.get(run.target)?.tags ?? parseMarkdown(run.content).tags).map((tag) => `#${tag}`)
    },
    /** `relative: true` gives the path inside the vault; otherwise the full path on disk. */
    path: (relative = false) => (relative ? run.target : `${vault.path.replace(/\\/g, '/')}/${run.target}`),
    /** `absolute: true` gives the folder's path inside the vault (`/` for the top), otherwise just its name. */
    folder: (absolute = false) => {
      const dir = paths.dirname(run.target)
      return absolute ? dir || '/' : paths.basename(dir)
    },
    creation_date: (format = 'YYYY-MM-DD HH:mm') => stamp(entry()?.ctime, format),
    last_modified_date: (format = 'YYYY-MM-DD HH:mm') => stamp(entry()?.mtime, format),
    exists: async (path: string) => obsidian.vault.adapter.exists(path),
    find_tfile: (name: string) => {
      const dest = metadata.resolve(name, run.target)
      return dest ? tfile(dest) : null
    },
    selection: () => run.selection,
    /** A place for the cursor after the template is inserted; equal numbers make several cursors. */
    cursor: (order?: number) => `<% tp.file.cursor(${order ?? ''}) %>`,
    cursor_append: (content: string) => {
      const editor = app.workspace.activeEditor
      editor?.dispatch(editor.state.replaceSelection(String(content)))
      return ''
    },
    /** Inserts another note (or one section, `[[Note#Heading]]`), running the templates in it. */
    include: async (link: string | TFile) => {
      if (run.depth >= 10) throw new TemplateError('шаблоны включают друг друга слишком глубоко')
      const target = typeof link === 'string' ? link.replace(/^!?\[\[|\]\]$/g, '').split('|')[0] : link.path
      const [name, heading] = target.split('#')
      const dest = typeof link === 'string' ? metadata.resolve(name, run.target) : link.path
      if (!dest) throw new TemplateError(`не найден файл для включения: ${target}`)
      const text = await vault.read(dest)
      return run.include(heading ? section(text, heading) : text, dest)
    },
    /** Creates a note from a template file or from text; returns the new file. */
    create_new: async (template: TFile | string, filename = 'Без названия', openNew = false, folder?: { path: string } | string) => {
      const dir = folder === undefined ? paths.dirname(run.target) : paths.normalize(typeof folder === 'string' ? folder : folder.path)
      const isFile = typeof template !== 'string'
      const text = isFile ? await vault.read(template.path) : template
      const created = await run.createNew(isFile ? template.path : null, text, filename, dir, openNew)
      return tfile(created)
    },
    /** Moves the note; `newPath` is a vault path without the extension. */
    move: async (newPath: string, fileToMove?: TFile) => {
      const from = fileToMove?.path ?? run.target
      const to = `${paths.normalize(newPath)}.${paths.extname(from) || 'md'}`
      if (to !== from && vault.get(from)) await vault.rename(from, to)
      if (from === run.target) run.target = to
      return ''
    },
    rename: async (newTitle: string) => {
      if (/[\\/:]/.test(newTitle)) throw new TemplateError('в имени файла не может быть \\ / :')
      return file.move(paths.join(paths.dirname(run.target), newTitle))
    },
  }

  const frontmatter = new Proxy({} as Record<string, unknown>, {
    get: (_, key) => (metadata.get(run.target)?.frontmatter ?? parseMarkdown(run.content).frontmatter ?? {})[String(key)],
    has: (_, key) => String(key) in (metadata.get(run.target)?.frontmatter ?? {}),
    ownKeys: () => Object.keys(metadata.get(run.target)?.frontmatter ?? {}),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  })

  const cancelled = <T>(value: T | null, throwOnCancel: boolean): T | null => {
    if (value === null && throwOnCancel) throw new TemplateError('отменено')
    return value
  }
  const labelsOf = <T>(texts: string[] | ((item: T) => string), items: T[]) =>
    typeof texts === 'function' ? items.map(texts) : texts.map(String)

  const system = {
    clipboard: async () => navigator.clipboard.readText().catch(() => ''),
    prompt: async (text = '', value = '', throwOnCancel = false, multiline = false, selectValue = false) =>
      cancelled(await prompt(text, value ?? '', multiline, selectValue), throwOnCancel),
    suggester: <T>(texts: string[] | ((item: T) => string), items: T[], throwOnCancel = false, placeholder = '', limit?: number) => {
      const labels = labelsOf(texts, items)
      const rows = items.map((item, i) => ({ item, label: labels[i] ?? String(item) }))
      return new Promise<T | null>((resolve, reject) => {
        const finish = (value: T | null) => {
          try {
            resolve(cancelled(value, throwOnCancel))
          } catch (err) {
            reject(err)
          }
        }
        app.suggest({
          placeholder,
          items: (query) => {
            const words = query.toLowerCase().split(/\s+/).filter(Boolean)
            const found = rows.filter((row) => words.every((word) => row.label.toLowerCase().includes(word)))
            return limit ? found.slice(0, limit) : found
          },
          label: (row) => row.label,
          onChoose: (row) => finish(row.item),
          onCancel: () => finish(null),
        })
      })
    },
    multi_suggester: async <T>(texts: string[] | ((item: T) => string), items: T[], throwOnCancel = false, title = '', _limit?: number, defaults?: T[]) =>
      cancelled(await multiSuggest(labelsOf(texts, items), items, title, defaults), throwOnCancel),
  }

  const web = {
    /** Fetches a URL; with `path` ("data.0.title") returns that part of the JSON answer. */
    request: async (url: string, path?: string) => {
      const response = await fetch(url)
      if (!response.ok) throw new TemplateError(`запрос ${url} вернул ${response.status}`)
      const text = await response.text()
      if (!path) return text
      return path.split('.').reduce<any>((value, key) => value?.[key], JSON.parse(text))
    },
    daily_quote: () => {
      const [quote, author] = QUOTES[moment().dayOfYear() % QUOTES.length]
      return `> [!quote] ${quote}\n> — ${author}`
    },
    random_picture: (size = '1600x900', _query?: string, includeSize = false) => {
      const [width, height = width] = size.split('x')
      const url = `https://picsum.photos/seed/${Date.now()}/${width}/${height}`
      return includeSize ? `![photo|${size}](${url})` : `![photo](${url})`
    },
  }

  return {
    date,
    file,
    frontmatter,
    system,
    web,
    user: run.scripts,
    app: obsidian,
    config: {
      get template_file() {
        return run.template ? tfile(run.template) : null
      },
      get target_file() {
        const found = entry()
        return found ? toTFile(found) : null
      },
      get active_file() {
        return obsidian.workspace.getActiveFile()
      },
      run_mode: run.mode,
    },
    hooks: {
      on_all_templates_executed: (callback: () => unknown) => void run.hooks.push(callback),
    },
    // What templates most often take from Obsidian's own module.
    obsidian: {
      moment,
      normalizePath: paths.normalize,
      /** Obsidian's request that is not held back by the browser's cross-site rules: this app's server makes it. */
      requestUrl: async (request: string | { url: string; method?: string; headers?: Record<string, string>; body?: string; contentType?: string; throw?: boolean }) => {
        const options = typeof request === 'string' ? { url: request } : request
        const answer = await app.vault.requestUrl(options)
        if (answer.status >= 400 && options.throw !== false) throw new Error(`Request failed, status ${answer.status}`)
        return {
          status: answer.status,
          headers: answer.headers,
          text: answer.text,
          get json() {
            return JSON.parse(answer.text)
          },
          get arrayBuffer() {
            return new TextEncoder().encode(answer.text).buffer
          },
        }
      },
      /** Tags of a note from `getFileCache`: those in the text and those in its properties. */
      getAllTags: (cache: { tags?: { tag: string }[] } | null) => (cache ? (cache.tags ?? []).map((t) => t.tag) : null),
      Notice: class {
        constructor(message: string) {
          app.notice(String(message))
        }
      },
    },
  }
}
