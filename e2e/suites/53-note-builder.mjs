import { parse } from 'yaml'
import { day } from '../helpers.mjs'

export const vault = {
  plugins: ['new-note', 'templates', 'new-note-place'],
  settings: {
    templates: { folder: 'Templates', ask: true, onCreate: true, rules: '/ = Legacy' },
    'new-note-place': { all: 'source' },
  },
  files: {
    'Home.md': 'Начало #проверить\n',
    'Projects/Existing.md': 'Проект\n',
    'Templates/Legacy.md': 'LEGACY TEMPLATE\n',
  },
}

export async function run(t) {
  const { page, ok, wait, exists, read } = t
  await t.open('Home')
  const form = page.locator('.nn-create')
  const builder = page.locator('.nn-builder-dialog')
  const run = (id) => page.evaluate((id) => { app.commands.run(id) }, id)
  const files = () => page.evaluate(() => app.vault.files().map((f) => f.path))
  const library = () => JSON.parse(read('.flint/settings.json'))['new-note'].library.templates

  await page.keyboard.press('Alt+n')
  await form.waitFor()
  ok('Alt+N opens the native form alongside the legacy plugins', (await form.getByRole('button', { name: 'Видео на YouTube', exact: false }).count()) === 1 && await page.locator('.tpl-dialog').count() === 0)
  const before = (await files()).length
  await form.getByRole('button', { name: 'Видео на YouTube', exact: false }).click()
  await form.getByLabel('Название заметки', { exact: false }).fill('Разбор: видео')
  await form.getByRole('button', { name: 'Создать заметку', exact: true }).click()
  ok('required fields prevent writing any file', (await files()).length === before && await form.isVisible())
  await form.getByLabel('Ссылка на видео', { exact: false }).fill('https://www.youtube.com/watch?v=example')
  await form.getByLabel('Автор / канал').fill('Автор: «пример»')
  await form.getByRole('button', { name: '#проверить', exact: true }).click()
  await form.getByRole('button', { name: 'Предпросмотр заметки', exact: true }).click()
  ok('preview shows rendered fields, tags, and the final path', (await form.locator('.nn-preview').innerText()).includes('Автор: «пример»') && (await form.locator('.nn-path').innerText()).includes(`Медиа/YouTube/${day().slice(0, 4)}/Разбор- видео.md`))
  await form.getByRole('button', { name: 'Создать заметку', exact: true }).click()
  await form.waitFor({ state: 'detached' })
  await wait(800)
  const videoPath = `Медиа/YouTube/${day().slice(0, 4)}/Разбор- видео.md`
  const video = exists(videoPath) ? read(videoPath) : ''
  const props = parse(video.split('---')[1] ?? '')
  ok('video writes safe YAML with source, automatic date, and tags', props?.author === 'Автор: «пример»' && props?.created === day() && props?.tags.includes('проверить') && video.includes('## Основные мысли'), video)
  ok('legacy templates never run over a form-created note', !video.includes('LEGACY') && await page.locator('dialog[open]').count() === 0)

  await page.keyboard.press('Alt+n')
  await form.waitFor()
  const beforeCancel = (await files()).length
  await form.getByRole('button', { name: 'Реакция на YouTube', exact: false }).click()
  await page.keyboard.press('Escape')
  await form.waitFor({ state: 'detached' })
  ok('Escape cancels without creating an empty file', (await files()).length === beforeCancel)

  // All configuration below is done through the actual constructor UI.
  await run('new-note:builder')
  await builder.waitFor()
  await builder.getByRole('button', { name: '+ Шаблон', exact: true }).click()
  await builder.getByLabel('Название шаблона', { exact: true }).fill('Моя тема')
  await builder.getByLabel('Категория шаблона').fill('Работа')
  await builder.getByLabel('Папка шаблона').fill('Входящие/{{date:YYYY}}')
  await builder.getByLabel('Имя файла', { exact: true }).fill('{{date}} — {{title}}')
  await builder.getByLabel('Теги шаблона').fill('моя-тема, #проверить')
  await builder.getByRole('button', { name: '+ Добавить поле', exact: true }).click()
  await builder.getByLabel('Подпись поля 1', { exact: true }).fill('Источник')
  await builder.getByLabel('Ключ поля 1', { exact: true }).fill('url')
  await builder.getByLabel('Тип поля 1', { exact: true }).selectOption('url')
  await builder.locator('.nn-field-card').nth(0).getByLabel('Обязательное', { exact: true }).check()
  await builder.getByRole('button', { name: '+ Добавить поле', exact: true }).click()
  await builder.getByLabel('Подпись поля 2', { exact: true }).fill('Мои мысли')
  await builder.getByLabel('Ключ поля 2', { exact: true }).fill('thoughts')
  await builder.getByLabel('Тип поля 2', { exact: true }).selectOption('textarea')
  await builder.locator('.nn-field-card').nth(1).getByLabel('Записать в свойства', { exact: true }).uncheck()
  await builder.getByRole('button', { name: '+ Добавить поле', exact: true }).click()
  await builder.getByLabel('Подпись поля 3', { exact: true }).fill('Оценка')
  await builder.getByLabel('Ключ поля 3', { exact: true }).fill('score')
  await builder.getByLabel('Тип поля 3', { exact: true }).selectOption('number')
  await builder.getByLabel('Значение поля 3', { exact: true }).fill('3.5')
  await builder.getByRole('button', { name: '+ Добавить поле', exact: true }).click()
  await builder.getByLabel('Подпись поля 4', { exact: true }).fill('Добавлено')
  await builder.getByLabel('Ключ поля 4', { exact: true }).fill('created')
  await builder.getByLabel('Тип поля 4', { exact: true }).selectOption('date')
  await builder.getByLabel('Автозаполнение поля 4', { exact: true }).selectOption('{{date}}')
  await builder.locator('.nn-field-card').nth(3).getByLabel('Автоматическое', { exact: true }).check()
  await builder.getByLabel('Содержание шаблона').fill('# {{title}}\n\nИсточник: {{url}}\n\n')
  await builder.getByRole('button', { name: 'Мои мысли', exact: true }).click()
  await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
  await wait(450)
  const saved = library().find((t) => t.name === 'Моя тема')
  ok('constructor persists fields, automatic values, path rules, and inserted variables', saved?.fields.length === 4 && saved.body.includes('{{thoughts}}') && saved.fields[3].hidden && saved.filename === '{{date}} — {{title}}', JSON.stringify(saved))
  ok('saving immediately registers a per-template command', await page.evaluate((id) => app.commands.list().some((c) => c.id === `new-note:template:${id}`), saved.id))
  // Invalid keys are reported in the UI and cannot replace the saved template.
  await builder.getByLabel('Ключ поля 2', { exact: true }).fill('url')
  await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
  ok('duplicate property keys are rejected without changing storage', (await builder.locator('.nn-errors').innerText()).includes('занят') && library().find((t) => t.id === saved.id).fields[1].key === 'thoughts')
  await builder.getByLabel('Ключ поля 2', { exact: true }).fill('thoughts')
  await builder.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
  await builder.getByRole('button', { name: 'Закрыть конструктор', exact: true }).click()

  const customPath = `Входящие/${day().slice(0, 4)}/${day()} — Проверка.md`
  await run(`new-note:template:${saved.id}`)
  await form.waitFor()
  ok('template command preselects the template and hides automatic fields', await form.getByLabel('Источник', { exact: false }).count() === 1 && await form.getByLabel('Добавлено', { exact: false }).count() === 0)
  await form.getByLabel('Название заметки', { exact: false }).fill('Проверка')
  await form.getByLabel('Источник', { exact: false }).fill('https://example.com/a?x=1&y=2')
  await form.getByLabel('Мои мысли', { exact: false }).fill('Мысли: «важное»\nВторая строка')
  await form.getByRole('button', { name: 'Создать заметку', exact: true }).click()
  await wait(900)
  const custom = exists(customPath) ? read(customPath) : ''
  const customProps = parse(custom.split('---')[1] ?? '')
  ok('custom form writes typed properties and body-only fields', customProps?.score === 3.5 && customProps?.created === day() && !Object.hasOwn(customProps, 'thoughts') && custom.includes('Мысли: «важное»\nВторая строка'), custom)

  // Existing names stay intact and plain notes bypass the old engine as well.
  await run('new-note:create')
  await form.waitFor()
  await form.getByLabel('Название заметки', { exact: false }).fill('Проверка')
  await form.getByLabel('Папка', { exact: true }).fill(`Входящие/${day().slice(0, 4)}`)
  await form.getByLabel('Текст заметки', { exact: true }).fill('Свободный текст с {{переменной}} и {{date}}')
  await form.getByRole('button', { name: 'Создать заметку', exact: true }).click()
  await wait(700)
  ok('plain note body is saved literally without interpreting template syntax', exists(`Входящие/${day().slice(0, 4)}/Проверка.md`) && read(`Входящие/${day().slice(0, 4)}/Проверка.md`) === 'Свободный текст с {{переменной}} и {{date}}')
  await run('new-note:create')
  await form.waitFor()
  await form.getByLabel('Название заметки', { exact: false }).fill('Проверка')
  await form.getByLabel('Папка', { exact: true }).fill(`Входящие/${day().slice(0, 4)}`)
  await form.getByRole('button', { name: 'Создать заметку', exact: true }).click()
  await wait(700)
  ok('collision adds a suffix and an empty note stays empty despite legacy rules', exists(`Входящие/${day().slice(0, 4)}/Проверка 1.md`) && read(`Входящие/${day().slice(0, 4)}/Проверка 1.md`) === '')

  await page.reload()
  await page.waitForFunction((id) => window.app?.commands.list().some((c) => c.id === `new-note:template:${id}`), saved.id)
  await run(`new-note:template:${saved.id}`)
  await form.waitFor()
  ok('templates and custom forms survive restart', await form.getByLabel('Мои мысли', { exact: false }).count() === 1)
  const beforeDisable = (await files()).length
  await page.evaluate(() => app.plugins.disable('new-note'))
  await form.waitFor({ state: 'detached' })
  ok('disabling cancels a pending form and removes its commands', (await files()).length === beforeDisable && await page.evaluate(() => !app.commands.list().some((c) => c.id.startsWith('new-note:'))))
  await page.evaluate(() => { app.settings.set('templates', 'ask', false); app.settings.set('core', 'newNoteLocation', 'root') })
  await page.keyboard.press('Alt+n')
  await wait(900)
  const restored = (await files()).find((file) => file.endsWith('/Без названия.md') || file === 'Без названия.md')
  ok('disabling restores the legacy creation pipeline', restored && read(restored).includes('LEGACY TEMPLATE'), restored)
}
