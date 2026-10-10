// A query written for Obsidian Tasks: dates formatted and told "from now" by its own functions.
import { day } from '../helpers.mjs'

export const vault = {
  plugins: ['tasks'],
  settings: { tasks: { remindDue: false } },
  files: {
    'ToDo/List.md': `- [ ] Pay tax 📅 ${day(3)}\n- [ ] Old bill 📅 ${day(-40)}\n- [ ] Someday\n- [x] Finished 📅 ${day(1)}\n`,
    'life/ToDo/Inner.md': `- [ ] Nested one 📅 ${day(3)}\n`,
    'Elsewhere.md': `- [ ] Not from the list 📅 ${day(3)}\n`,
    'Scripted.md':
      '# Scripted\n\n```tasks\nfilter by function task.file.folder === "ToDo/" || task.file.folder.endsWith("/ToDo/")\nfilter by function !task.isDone\ngroup by function task.due.format("YYYY %%MM%% MMMM DD", "Undated")\ngroup by function task.due.fromNow.groupText\n```\n\nend\n',
  },
}

export async function run(t) {
  const { page, ok, wait } = t
  await wait(1200)
  await t.open('Scripted')
  await wait(700)
  const shown = await t.flat(page.locator(`${t.leaf} .tasks-block`))
  ok('the folder is found at the root and under another folder', shown.includes('Pay tax') && shown.includes('Nested one') && !shown.includes('Not from the list') && !shown.includes('Finished'), shown)
  ok('task.due.format and task.due.fromNow group the tasks; no error is shown', shown.includes('Old bill') && shown.includes('Someday') && /undated/i.test(shown) && /через [23] дня/i.test(shown) && /месяц назад/i.test(shown) && !/is not a function|error|ошибк/i.test(shown), shown)
  ok('the hidden marks are not shown, and the past comes before the future', !shown.includes('%%') && shown.toLowerCase().indexOf('назад') < shown.toLowerCase().indexOf('через') && shown.includes(String(new Date().getFullYear())), shown)
}
