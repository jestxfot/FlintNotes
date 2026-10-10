import { pickLook, type App, type Look } from '../../api'
import { ruleLook, type Condition, type IconicData, type NoteFacts, type Rule } from './data'

/** What a condition may look at, among what this app checks. Iconic has more (tags, dates); those stay as written. */
const SOURCES: [value: string, label: string][] = [
  ['tree', 'Папка и всё в ней'],
  ['name', 'Имя'],
  ['filename', 'Имя с расширением'],
  ['extension', 'Расширение'],
  ['path', 'Путь'],
  ['tags', 'Теги заметки'],
  ['links', 'Ссылки в заметке'],
]
/** Operators for the sources that are lists. */
const LIST_OPERATORS: [value: string, label: string][] = [
  ['includes', 'есть элемент'],
  ['!includes', 'нет элемента'],
  ['anyContain', 'какой-то содержит'],
  ['anyStartWith', 'какой-то начинается с'],
  ['anyMatch', 'какой-то подходит под выражение'],
  ['noneContain', 'ни один не содержит'],
  ['allAre', 'все равны'],
  ['countIsMore', 'их больше чем'],
]
const isList = (source: string) => source === 'tags' || source === 'links'
const OPERATORS: [value: string, label: string][] = [
  ['is', 'равно'],
  ['!is', 'не равно'],
  ['contains', 'содержит'],
  ['!contains', 'не содержит'],
  ['startsWith', 'начинается с'],
  ['endsWith', 'заканчивается на'],
  ['matches', 'подходит под выражение'],
]
const MATCH: [value: Rule['match'], label: string][] = [
  ['any', 'любое условие'],
  ['all', 'все условия'],
  ['none', 'ни одно условие'],
]

const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = '') => {
  const node = parent.appendChild(document.createElement(tag))
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function select<T extends string>(parent: HTMLElement, options: [T, string][], value: T, change: (value: T) => void): HTMLSelectElement {
  const node = el(parent, 'select', 'iconic-rule-select')
  for (const [key, label] of options) node.add(new Option(label, key))
  // A value this app does not know (one of Iconic's other sources) is shown as it is and kept.
  if (!options.some(([key]) => key === value)) node.add(new Option(`${value} (только в Obsidian)`, value))
  node.value = value
  node.onchange = () => change(node.value as T)
  return node
}

/** An id like the ones Iconic gives its rules: five letters and digits. */
const newId = () => Array.from({ length: 5 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('')

/**
 * The rulebook, as in Iconic's settings: rules that give an icon and a colour
 * to every file or folder that fits their conditions. The first rule that fits
 * wins; an icon given to an item itself is stronger than any rule.
 */
export function drawRules(root: HTMLElement, app: App, data: () => IconicData, save: () => Promise<void>, facts?: (path: string) => NoteFacts | undefined): void {
  const changed = () => void save().then(() => draw())
  const draw = () => {
    root.replaceChildren()
    root.className = 'iconic-rules'
    for (const [kind, key, title] of [
      ['file', 'fileRules', 'Правила для файлов'],
      ['folder', 'folderRules', 'Правила для папок'],
    ] as const) {
      const rules = (data()[key] ??= [])
      const section = el(root, 'div', 'iconic-rule-section')
      const head = el(section, 'div', 'iconic-rule-head')
      el(head, 'h4', '', title)
      const add = el(head, 'button', 'iconic-rule-add', '+ Правило')
      add.onclick = () => {
        rules.push({ id: newId(), name: '', match: 'any', conditions: [{ source: 'tree', operator: 'is', value: '' }], enabled: true, icon: kind === 'file' ? 'lucide-file' : 'lucide-folder' })
        changed()
      }
      if (!rules.length) el(section, 'div', 'iconic-rule-none', kind === 'file' ? 'Правил для файлов нет' : 'Правил для папок нет')
      const all = app.vault.all().filter((entry) => entry.kind === kind)
      rules.forEach((rule, index) => {
        const card = el(section, 'div', rule.enabled ? 'iconic-rule' : 'iconic-rule off')
        const line = el(card, 'div', 'iconic-rule-line')
        const on = el(line, 'input', 'iconic-rule-on')
        on.type = 'checkbox'
        on.checked = rule.enabled
        on.title = 'Правило действует'
        on.onchange = () => ((rule.enabled = on.checked), changed())
        const look = el(line, 'button', 'iconic-rule-look')
        look.title = 'Значок и цвет'
        look.append(app.icons.draw(rule.icon ?? 'lucide-circle-dashed', rule.color))
        look.onclick = async () => {
          const chosen: Look | null = await pickLook(app, rule.name || 'Правило', { icon: rule.icon, color: rule.color })
          if (!chosen) return
          delete rule.icon
          delete rule.color
          if (chosen.icon) rule.icon = chosen.icon
          if (chosen.color) rule.color = chosen.color
          changed()
        }
        const name = el(line, 'input', 'iconic-rule-name')
        name.placeholder = 'Название правила'
        name.value = rule.name ?? ''
        name.onchange = () => ((rule.name = name.value.trim()), changed())
        el(line, 'span', 'iconic-rule-word', 'если верно')
        select(line, MATCH, rule.match ?? 'any', (value) => ((rule.match = value), changed()))
        // How many items the rule gives its look to right now.
        const one = { ...data(), [key]: [{ ...rule, enabled: true }] } as IconicData
        const count = all.filter((entry) => ruleLook(one, kind, entry.path, facts)).length
        el(line, 'span', 'iconic-rule-count', String(count)).title = 'Сколько подходит сейчас'
        const move = (by: number, label: string, text: string) => {
          const button = el(line, 'button', 'iconic-rule-tool', text)
          button.title = label
          button.disabled = index + by < 0 || index + by >= rules.length
          button.onclick = () => {
            rules.splice(index + by, 0, ...rules.splice(index, 1))
            changed()
          }
        }
        move(-1, 'Выше: правило выше по списку сильнее', '↑')
        move(1, 'Ниже', '↓')
        const remove = el(line, 'button', 'iconic-rule-tool', '×')
        remove.title = 'Удалить правило'
        remove.onclick = () => {
          rules.splice(index, 1)
          changed()
        }

        const conditions = (rule.conditions ??= [])
        conditions.forEach((condition: Condition, at) => {
          const row = el(card, 'div', 'iconic-condition')
          // Tags and links are asked about only of files; a folder has neither.
          select(row, kind === 'file' ? SOURCES : SOURCES.filter(([value]) => !isList(value)), condition.source, (value) => {
            // A list and a text are asked different questions.
            if (isList(value) !== isList(condition.source)) condition.operator = isList(value) ? 'includes' : 'is'
            condition.source = value
            changed()
          })
          select(row, isList(condition.source) ? LIST_OPERATORS : OPERATORS, condition.operator, (value) => ((condition.operator = value), changed()))
          const value = el(row, 'input', 'iconic-rule-value')
          value.placeholder = condition.source === 'tree' ? 'life/Calendar' : condition.operator === 'matches' ? '/^\\d{4}-\\d{2}/' : 'значение'
          value.value = condition.value ?? ''
          value.onchange = () => ((condition.value = value.value.trim()), changed())
          const drop = el(row, 'button', 'iconic-rule-tool', '×')
          drop.title = 'Убрать условие'
          drop.onclick = () => {
            conditions.splice(at, 1)
            changed()
          }
        })
        const more = el(card, 'button', 'iconic-condition-add', '+ Условие')
        more.onclick = () => {
          conditions.push({ source: 'name', operator: 'contains', value: '' })
          changed()
        }
      })
    }
  }
  draw()
}
