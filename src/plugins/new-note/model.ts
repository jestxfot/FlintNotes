import { stringify } from 'yaml'
import { path, type Moment } from '../../api'

export const FIELD_TYPES = [
  ['text', 'Текст'], ['textarea', 'Многострочный текст'], ['url', 'Ссылка URL'],
  ['link', 'Ссылка на заметку'], ['number', 'Число'], ['date', 'Дата'],
  ['select', 'Выбор из списка'], ['checkbox', 'Флажок'], ['tags', 'Список тегов'],
] as const
export type FieldType = typeof FIELD_TYPES[number][0]
export interface NoteField {
  id: string
  key: string
  label: string
  type: FieldType
  required: boolean
  property: boolean
  hidden: boolean
  defaultValue: string
  options: string
}
export interface NoteTemplate {
  id: string
  name: string
  category: string
  description: string
  folder: string
  filename: string
  tags: string
  body: string
  fields: NoteField[]
}
export type Values = Record<string, string | boolean>
export const newId = () => globalThis.crypto?.randomUUID?.() ?? `nn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
export const splitTags = (text: string): string[] => [...new Set(text.split(/[,;\s]+/).map((s) => s.replace(/^#+/, '').trim()).filter(Boolean))]
export const optionsOf = (field: NoteField) => field.options.split('\n').map((s) => s.trim()).filter(Boolean)

export function newField(key = 'field'): NoteField {
  return { id: newId(), key, label: 'Новое поле', type: 'text', required: false, property: true, hidden: false, defaultValue: '', options: '' }
}
export function newTemplate(): NoteTemplate {
  return { id: newId(), name: 'Новый шаблон', category: 'Мои шаблоны', description: '', folder: '', filename: '{{title}}', tags: '', body: '# {{title}}\n\n', fields: [] }
}
export const blankTemplate = (): NoteTemplate => ({ ...newTemplate(), id: '', name: 'Обычная заметка', category: '', body: '' })

/** Interpolation is deliberately declarative: no evaluation of JavaScript or template scripts. */
export function expand(text: string, title: string, values: Values, date: Moment, source: string): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, key: string) => {
    if (key === 'title') return title
    if (key === 'source') return path.stripExt(path.basename(source))
    if (key === 'sourceFolder') return path.dirname(source)
    if (key === 'date' || key.startsWith('date:')) return date.format(key.slice(5) || 'YYYY-MM-DD')
    if (key === 'time' || key.startsWith('time:')) return date.format(key.slice(5) || 'HH:mm')
    return Object.hasOwn(values, key) ? String(values[key]) : token
  })
}

export function initialValues(template: NoteTemplate, date: Moment, source: string, title = ''): Values {
  return Object.fromEntries(template.fields.map((field) => [field.key, field.type === 'checkbox' ? field.defaultValue === 'true' : expand(field.defaultValue, title, {}, date, source)]))
}

export function templateErrors(template: NoteTemplate): string[] {
  const errors: string[] = []
  if (!template.name.trim()) errors.push('Укажите название шаблона')
  if (!template.filename.trim()) errors.push('Укажите правило имени файла')
  const keys = new Set(['title', 'date', 'time', 'source', 'sourceFolder', 'tags'])
  for (const field of template.fields) {
    if (!/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(field.key) || keys.has(field.key)) errors.push(`Ключ «${field.key}» занят или недопустим`)
    keys.add(field.key)
    if (!field.label.trim()) errors.push('Укажите подпись каждого поля')
    if (field.type === 'select' && !optionsOf(field).length) errors.push(`Добавьте варианты для «${field.label}»`)
  }
  const check = (text: string) => {
    for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const key = match[1]
      if (!keys.has(key) && !/^(date|time):.+$/.test(key)) errors.push(`Неизвестная переменная {{${key}}}`)
    }
  }
  for (const text of [template.folder, template.filename, template.tags, template.body, ...template.fields.map((f) => f.defaultValue)]) check(text)
  return [...new Set(errors)]
}

function typed(field: NoteField, value: string | boolean): unknown {
  if (field.type === 'checkbox') return value === true
  if (field.type === 'number') return Number(value)
  if (field.type === 'tags') return splitTags(String(value))
  if (field.type === 'link') return `[[${String(value).replace(/^\[\[|\]\]$/g, '')}]]`
  return String(value)
}

const safeSegment = (text: string) => text.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim()

export interface RenderInput {
  template: NoteTemplate
  title: string
  values: Values
  tags: string
  folder: string
  date: Moment
  source: string
  uniquePath: (folder: string, name: string, ext: string) => string
}
export function renderNote(input: RenderInput): { path: string; text: string; errors: string[] } {
  const { template, title, values, date, source } = input
  const errors = templateErrors(template)
  if (!title.trim()) errors.push('Введите название заметки')
  const resolved: Values = { ...values }
  // Automatic fields are resolved for this title, too. Values are substituted once, never executed.
  for (const field of template.fields) if (field.hidden) resolved[field.key] = field.type === 'checkbox' ? field.defaultValue === 'true' : expand(field.defaultValue, title, values, date, source)
  const properties: Record<string, unknown> = Object.create(null)
  for (const field of template.fields) {
    const value = resolved[field.key] ?? ''
    const empty = value === '' || (typeof value === 'string' && !value.trim())
    if (field.required && (empty || (field.type === 'checkbox' && value !== true))) errors.push(`Заполните поле «${field.label}»`)
    if (!empty && field.type === 'number' && !Number.isFinite(Number(value))) errors.push(`«${field.label}»: введите число`)
    if (!empty && field.type === 'url' && !/^https?:\/\/\S+$/i.test(String(value))) errors.push(`«${field.label}»: нужна ссылка http:// или https://`)
    if (!empty && field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) errors.push(`«${field.label}»: нужна дата ГГГГ-ММ-ДД`)
    if (!empty && field.type === 'select' && !optionsOf(field).includes(String(value))) errors.push(`«${field.label}»: выберите значение из списка`)
    if (field.property && !empty) properties[field.key] = typed(field, value)
  }
  const substitute = (s: string) => expand(s, title.trim(), resolved, date, source)
  const tags = splitTags(substitute(input.tags))
  resolved.tags = tags.join(', ')
  if (tags.length) properties.tags = tags
  // Keep path separators from user-entered values from creating unintended folders.
  const folderValues = Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, safeSegment(String(v))]))
  const folder = path.normalize(expand(input.folder.replace(/\\/g, '/'), safeSegment(title.trim()), folderValues, date, source).split('/').map(safeSegment).join('/'))
  if (folder.split('/').some((s) => s.startsWith('.'))) errors.push('Выберите папку заметок вне служебных папок')
  const filename = safeSegment(substitute(template.filename).replace(/\.md$/i, ''))
  if (!filename) errors.push('Правило имени даёт пустое название файла')
  const target = input.uniquePath(folder, filename || 'Без названия', 'md')
  const frontmatter = Object.keys(properties).length ? `---\n${stringify(properties)}---\n\n` : ''
  return { path: target, text: frontmatter + substitute(template.body), errors: [...new Set(errors)] }
}

export function starterTemplates(): NoteTemplate[] {
  const field = (key: string, label: string, type: FieldType = 'text', required = false, defaultValue = ''): NoteField => ({ ...newField(key), label, type, required, defaultValue })
  const video: NoteTemplate = { ...newTemplate(), id: 'youtube', name: 'Видео на YouTube', category: 'Медиа', description: 'Ссылка, автор и основные мысли из видео', folder: 'Медиа/YouTube/{{date:YYYY}}', tags: 'youtube, видео', fields: [field('url', 'Ссылка на видео', 'url', true), field('author', 'Автор / канал'), { ...field('created', 'Дата создания', 'date', false, '{{date}}'), hidden: true }], body: '# {{title}}\n\nВидео: {{url}}\nАвтор: {{author}}\n\n## Основные мысли\n\n## Что применить\n\n' }
  return [video,
    { ...video, id: 'reaction', name: 'Реакция на YouTube', description: 'Сохранить источник, впечатления и выводы', tags: 'youtube, реакция', fields: [...video.fields.map((f) => ({ ...f, id: newId() })), { ...field('reaction', 'Моя реакция', 'textarea', true), property: false }], body: '# {{title}}\n\nИсточник: {{url}}\n\n## Моя реакция\n{{reaction}}\n\n## С чем согласен\n\n## Что проверить\n\n' },
    { ...newTemplate(), id: 'food', name: 'Еда / рецепт', category: 'Личное', description: 'Ингредиенты, источник и способ приготовления', folder: 'Еда', tags: 'еда, рецепт', fields: [field('url', 'Источник рецепта', 'url'), { ...field('ingredients', 'Ингредиенты', 'textarea', true), property: false }, field('servings', 'Количество порций', 'number', false, '2'), { ...field('meal', 'Приём пищи', 'select'), options: 'Завтрак\nОбед\nУжин\nПерекус' }], body: '# {{title}}\n\nИсточник: {{url}}\n\n## Ингредиенты\n{{ingredients}}\n\n## Приготовление\n\n## Заметки\n\n' },
  ]
}
