import { parse } from 'yaml'

const field = (key, label, type, defaultValue = '', more = {}) => ({ id: key, key, label, type, defaultValue, options: '', required: false, property: true, hidden: false, ...more })
const template = {
  id: 'standalone', name: 'Моя запись', description: 'Все типы полей', category: 'Личное',
  folder: 'Записи', filename: '{{title}}', tags: 'личное', body: '# {{title}}\n\n{{notes}}\n\nТеги: {{tags}}',
  fields: [
    field('status', 'Статус', 'select', 'Идея', { options: 'Идея\nГотово', required: true }),
    field('approved', 'Проверено', 'checkbox', 'false'),
    field('related', 'Связанная заметка', 'link'),
    field('topics', 'Темы', 'tags'),
    field('notes', 'Текст', 'textarea', '', { property: false }),
    field('caption', 'Автоматический заголовок', 'text', '{{title}}', { hidden: true }),
  ],
}
export const phone = true
export const viewport = { width: 420, height: 900 }
export const vault = {
  plugins: ['new-note'],
  settings: { 'new-note': { library: { version: 1, templates: [template] } } },
  files: { 'Связи/Главная.md': 'Связанная заметка\n' },
}

export async function run(t) {
  const { page, ok, wait, exists, read } = t
  const run = (id) => page.evaluate((id) => { app.commands.run(id) }, id)
  await page.waitForFunction(() => window.app?.commands.list().some((c) => c.id === 'new-note:builder'))
  await run('core:settings')
  const settings = page.locator('dialog[aria-label="Настройки"]')
  await settings.getByRole('button', { name: 'Новая заметка', exact: true }).click()
  const builder = settings.locator('.nn-builder')
  await builder.getByLabel('Название шаблона', { exact: true }).fill('Несохранённое имя')
  await builder.getByRole('button', { name: '+ Шаблон', exact: true }).click()
  ok('embedded builder protects unsaved changes', await builder.locator('.nn-confirm').count() === 1)
  await builder.getByRole('button', { name: 'Остаться', exact: true }).click()
  await builder.getByRole('button', { name: '+ Шаблон', exact: true }).click()
  await builder.getByRole('button', { name: 'Перейти без сохранения', exact: true }).click()
  await builder.getByLabel('Редактируемый шаблон').selectOption('standalone')
  ok('discard restores the stored template rather than a mutated editor object', await builder.getByLabel('Название шаблона', { exact: true }).inputValue() === 'Моя запись')
  await builder.getByRole('button', { name: 'Копия', exact: true }).click()
  await builder.getByLabel('Название шаблона', { exact: true }).fill('Копия моей записи')
  await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
  await wait(450)
  const copyId = await page.evaluate(() => app.settings.get('new-note', 'library').templates.find((t) => t.name === 'Копия моей записи')?.id)
  ok('copy creates an independent template with its own command', copyId && copyId !== 'standalone' && await page.evaluate((id) => app.commands.list().some((c) => c.id === `new-note:template:${id}`), copyId))
  await builder.getByRole('button', { name: 'Удалить', exact: true }).click()
  await builder.getByRole('button', { name: 'Удалить шаблон', exact: true }).click()
  ok('deletion removes just the selected template and its command', await page.evaluate((id) => app.settings.get('new-note', 'library').templates.length === 1 && !app.commands.list().some((c) => c.id === `new-note:template:${id}`), copyId))
  await settings.locator('.body .phone-done').click()
  await run('new-note:template:standalone')
  const form = page.locator('.nn-create')
  await form.waitFor()
  await form.getByLabel('Название заметки', { exact: false }).fill('Мобильная запись')
  await form.getByLabel('Статус', { exact: false }).selectOption('Готово')
  await form.getByLabel('Проверено', { exact: false }).check()
  await form.getByLabel('Связанная заметка', { exact: false }).fill('Связи/Главная')
  await form.getByLabel('Темы', { exact: true }).fill('#рецепты, обед, #рецепты')
  await form.getByLabel('Текст', { exact: true }).fill('Без скриптов')
  ok('mobile dialog fits the viewport without horizontal overflow', await form.evaluate((el) => el.getBoundingClientRect().width <= innerWidth && el.scrollWidth <= el.clientWidth))
  ok('mobile submit button remains visible while the fields scroll', await form.getByRole('button', { name: 'Создать заметку', exact: true }).evaluate((el) => { const box = el.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight }))
  await form.getByRole('button', { name: 'Создать заметку', exact: true }).click()
  await wait(800)
  const text = exists('Записи/Мобильная запись.md') ? read('Записи/Мобильная запись.md') : ''
  const properties = parse(text.split('---')[1] ?? '')
  ok('standalone plugin writes select, boolean, note links, lists, and title-based automatic values', properties?.status === 'Готово' && properties?.approved === true && properties?.related === '[[Связи/Главная]]' && JSON.stringify(properties?.topics) === JSON.stringify(['рецепты', 'обед']) && properties?.caption === 'Мобильная запись' && text.includes('Без скриптов') && text.includes('Теги: личное'), text)

  // The folder selected explicitly in the file tree is retained in the form.
  await page.evaluate(() => { const create = async () => { const path = await app.creation.place({ origin: 'tree', name: 'Без названия', folder: 'Связи', explicit: true }); if (path) await app.creation.create(path) }; void create() })
  await form.waitFor()
  await form.getByRole('button', { name: 'Моя запись', exact: false }).click()
  ok('an explicitly chosen folder takes priority over the template folder', await form.getByLabel('Папка', { exact: true }).inputValue() === 'Связи')
  await page.keyboard.press('Escape')

  // Deactivating interception leaves the explicit creation command available.
  await page.evaluate(() => app.settings.set('new-note', 'intercept', false))
  await run('core:new-note')
  await wait(700)
  ok('interception can be disabled independently of the plugin', await form.count() === 0 && (await page.evaluate(() => app.vault.files().map((f) => f.path))).some((p) => p.endsWith('Без названия.md')))
  await run('new-note:create')
  await form.waitFor()
  ok('explicit command still opens the form with interception disabled', await form.isVisible())
  await page.keyboard.press('Escape')
}
