// Tracker blocks: values per day from fields, properties, tags and tasks; chart, summary, month.
import { day } from '../helpers.mjs'

const f = '```'
const note = (offset, body) => [`life/Calendar/${day(offset).slice(0, 7)}/${day(offset)}.md`, body]
export const vault = {
  plugins: ['tracker'],
  files: Object.fromEntries([
    note(0, '---\nmood: 7\n---\nweight:: 71.5\n- [x] 🧹 23:40 Brush teeth\n#walk\n'),
    note(-1, '---\nmood: 5\n---\nweight:: 72\ndinner:: [[Soup]]\n- [x] 🧹 23:40 Brush teeth\n#walk #walk\n'),
    note(-2, '---\nmood: 6\n---\n- [ ] 🧹 23:40 Brush teeth\n'),
    note(-3, 'weight:: 73\n- [x] 🧹 23:40 Brush teeth\n'),
    ['life/Calendar/Not a day.md', 'weight:: 999\n'],
    ['T.md', [
      `${f}tracker`, 'searchType: dvField', 'searchTarget: weight', 'folder: Calendar', 'line:', '  title: Weight', f, '',
      `${f}tracker`, 'searchType: task.done', "searchTarget: '🧹 23:40 Brush teeth'", "folder: 'Calendar'", 'summary:', '  template: "- Done: {{sum()}} times\\n- Streak: {{currentStreak()}} days\\n- Best: {{maxStreak()}} days\\n- Avg: {{average()::0.0}}"', f, '',
      `${f}tracker`, 'searchType: task.done', "searchTarget: '🧹 23:40 Brush teeth'", `folder: 'life\\Calendar'`, 'month:', '  mode: annotation', "  annotation: '🧹'", "  startWeekOn: 'Mon'", f, '',
      `${f}tracker`, 'searchType: frontmatter', 'searchTarget: mood', 'folder: life/Calendar', 'type: bar', f, '',
      `${f}tracker`, 'searchType: tag', 'searchTarget: walk', 'folder: life/Calendar', 'summary:', '  template: "walks={{sum()}} days={{numDaysHavingData()}}"', f, '',
      `${f}tracker`, 'searchType: nonsense', 'searchTarget: x', f, '', 'end', '',
    ].join('\n')],
  ]),
}

export async function run(t) {
  const { page, ok, wait, leaf } = t
  await t.open('T')
  await wait(1200)
  const blocks = page.locator(`${leaf} .tracker-block`)
  ok('every tracker block is drawn', (await blocks.count()) === 6, await blocks.count())

  const points = (n) => blocks.nth(n).locator('canvas').evaluate((canvas) => {
    const chart = Object.values(window.Chart?.instances ?? {}).find((c) => c.canvas === canvas)
    return chart ? chart.data.datasets[0].data : null
  })
  const painted = await blocks.nth(0).locator('canvas').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let n = 0
    for (let i = 3; i < data.length; i += 4) if (data[i]) n++
    return n
  })
  ok('a line chart of a field is drawn; the folder is found by its name', painted > 1500, painted)

  let s = await t.flat(blocks.nth(1))
  ok('summary: sum, streaks and a formatted average', s === 'Done: 3 times Streak: 2 days Best: 2 days Avg: 1.0' && (await blocks.nth(1).locator('.tracker-item').count()) === 4, s)

  const month = blocks.nth(2)
  ok('month: days with a done task carry the mark', (await month.locator('.tracker-mark').count()) >= 2 && (await month.locator('.tracker-day.today .tracker-mark').count()) === 1, await month.locator('.tracker-mark').count())
  ok('month: weeks start on Monday', (await month.locator('.tracker-weekday').first().innerText()) === 'Пн')
  const title = await month.locator('.tracker-month-head span').innerText()
  await month.locator('.tracker-month-head button').first().click()
  ok('month: the month can be turned', (await month.locator('.tracker-month-head span').innerText()) !== title)

  ok('"type: bar" draws a bar chart of a property', (await blocks.nth(3).locator('canvas').count()) === 1)
  s = await t.flat(blocks.nth(4))
  ok('tags are counted, each occurrence', s === 'walks=3 days=2', s)
  s = await t.flat(blocks.nth(5))
  ok('a mistake is explained', s.includes('nonsense') && s.includes('не поддерживается'), s)

  // A new day's note changes the numbers without reopening anything.
  t.write(`life/Calendar/${day(-4).slice(0, 7)}/${day(-4)}.md`, '#walk\n')
  await wait(3000)
  s = await t.flat(blocks.nth(4))
  ok('trackers follow the vault', s === 'walks=4 days=3', s)
  void points
}
