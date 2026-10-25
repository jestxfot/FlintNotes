// Each base may have a template for its new records, kept in FlintNotes' settings: the base's YAML stays as Obsidian reads it.
const base = '```base\nfilters:\n  and:\n    - file.inFolder("Food")\n    - file.hasTag("breakfast")\nviews:\n  - type: cards\n    name: Breakfast\n```'

export const vault = {
  plugins: ['bases', 'templates'],
  settings: { templates: { folder: 'Templates', ask: false, onCreate: false } },
  files: {
    'Menu.md': `# Меню\n\n${base}\n\nend\n`,
    'Food/Каша.md': '---\ntags: [breakfast]\n---\n\nКаша\n',
    'Templates/Еда.md': '---\nstar: 0\ntags: [food]\n---\n\n## Состав\n\n## Рецепт\n',
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  await t.open('Menu')
  await wait(800)
  const toolbar = page.locator(`${t.leaf} .base-toolbar`)
  ok('beside «Создать» is the choice of a template', (await toolbar.locator('.base-create-more').count()) === 1)
  await toolbar.locator('.base-create-more').click()
  await wait(200)
  await page.locator('.menu button', { hasText: 'Выбрать шаблон новых записей' }).click()
  await page.locator('dialog [role=option]', { hasText: 'Еда' }).first().click()
  await wait(900)
  const kept = () => JSON.parse(t.read('.flint/settings.json')).bases?.recordTemplates ?? {}
  ok('the template is kept in FlintNotes\' settings, by the note and the base\'s view', kept()['Menu.md|Breakfast'] === 'Templates/Еда.md', JSON.stringify(kept()))
  ok('the base\'s own text is left as Obsidian reads it', !t.read('Menu.md').includes('Еда') && !t.read('Menu.md').includes('template'))
  ok('«Создать» says which template it uses', /Еда/.test((await toolbar.locator('.base-create .base-tool').first().getAttribute('title')) ?? ''))

  await toolbar.locator('.base-create .base-tool').first().click()
  await wait(1200)
  const made = await page.evaluate(() => app.vault.files().map((file) => file.path).filter((path) => path.startsWith('Food/') && path !== 'Food/Каша.md'))
  const text = made[0] ? t.read(made[0]) : ''
  ok('a new record is made from the template, in the base\'s folder', made.length === 1 && text.includes('## Рецепт') && /star: 0/.test(text), `${made} ${text}`)
  ok('with what the base asks for added to the template\'s properties', /food/.test(text) && /breakfast/.test(text), text)

  // Renamed, the note keeps its base's template.
  await page.evaluate(() => app.vault.rename('Menu.md', 'Завтраки.md'))
  await wait(900)
  ok('a renamed note keeps the template of its base', kept()['Завтраки.md|Breakfast'] === 'Templates/Еда.md' && !kept()['Menu.md|Breakfast'], JSON.stringify(kept()))
  await t.open('Завтраки')
  await wait(800)
  await page.locator(`${t.leaf} .base-create .base-tool`).first().click({ button: 'right' })
  await wait(200)
  await page.locator('.menu button', { hasText: 'Без шаблона' }).click()
  await wait(900)
  ok('and «Без шаблона» lets it go', !kept()['Завтраки.md|Breakfast'], JSON.stringify(kept()))
}
