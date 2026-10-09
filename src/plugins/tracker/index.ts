import { Chart, registerables } from 'chart.js'
import { parse } from 'yaml'
import { errorMessage, moment, Plugin, renderInline, type CodeBlockProcessor } from '../../api'
import { collect, days, stats, type Dataset, type TrackerSpec } from './collect'
import './style.css'

Chart.register(...registerables)

const PALETTE = ['purple', 'blue', 'green', 'orange', 'red', 'cyan', 'pink', 'yellow']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/**
 * ```tracker
 * searchType: dvField          # frontmatter, tag, wiki, text, task, task.done, task.notdone, fileMeta
 * searchTarget: weight
 * folder: Calendar
 * line:                        # or bar:, summary:, month:
 *   title: Вес
 * ```
 */
export default class Tracker extends Plugin {
  onload() {
    const { app } = this
    const color = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    const section = (spec: TrackerSpec, key: string) => (spec[key] && typeof spec[key] === 'object' ? (spec[key] as Record<string, unknown>) : {})

    const chart = (el: HTMLElement, spec: TrackerSpec, kind: 'line' | 'bar', datasets: Dataset[], range: string[]): Chart => {
      const options = section(spec, kind)
      Chart.defaults.color = color('--text-muted')
      Chart.defaults.borderColor = color('--border')
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily
      const box = el.appendChild(document.createElement('div'))
      box.className = 'tracker-chart'
      return new Chart(box.appendChild(document.createElement('canvas')), {
        type: kind,
        data: {
          labels: range.map((day) => moment(day).format('D MMM')),
          datasets: datasets.map((dataset, i) => {
            const tint = color(`--color-${PALETTE[i % PALETTE.length]}`)
            return {
              label: dataset.name,
              // A day without a value is a gap in a line and an empty place among bars.
              data: range.map((day) => dataset.values.get(day) ?? null),
              borderColor: tint,
              backgroundColor: `color-mix(in srgb, ${tint} ${kind === 'bar' ? 65 : 20}%, transparent)`,
              borderWidth: 2,
              tension: 0.25,
              pointRadius: range.length > 60 ? 0 : 3,
              spanGaps: options.fillGap === true,
            }
          }),
        },
        options: {
          responsive: true,
          animation: false,
          plugins: { title: { display: !!options.title, text: String(options.title ?? '') }, legend: { display: datasets.length > 1 || options.showLegend === true } },
          scales: { y: { beginAtZero: kind === 'bar', title: { display: !!options.yAxisLabel, text: String(options.yAxisLabel ?? '') } }, x: { ticks: { maxTicksLimit: 12 } } },
        },
      })
    }

    const summary = (el: HTMLElement, spec: TrackerSpec, datasets: Dataset[], range: string[], path: string) => {
      const template = String(section(spec, 'summary').template ?? 'Сумма: {{sum()}}')
      // `{{sum(dataset(1))}}` names a dataset; `{{average()::0.0}}` asks for one decimal.
      const text = template.replace(/\{\{\s*(\w+)\(\s*(?:dataset\((\d+)\))?\s*\)(?:::([^}]*))?\s*\}\}/g, (all, name: string, index: string | undefined, format: string | undefined) => {
        const dataset = datasets[Number(index ?? 0)]
        const values = dataset ? stats(dataset, range) : {}
        if (!Object.hasOwn(values, name)) return all
        const value = values[name]
        if (typeof value === 'string') return value ? moment(value).format(format?.trim() || 'D MMMM YYYY') : '—'
        const decimals = format?.includes('.') ? format.trim().split('.')[1].length : Number.isInteger(value) ? 0 : 2
        return value.toFixed(decimals)
      })
      const box = el.appendChild(document.createElement('div'))
      box.className = 'tracker-summary'
      for (const line of text.split('\n')) {
        const row = box.appendChild(document.createElement('div'))
        const item = /^\s*[-*]\s+(.*)$/.exec(line)
        if (item) row.className = 'tracker-item'
        row.append(renderInline(app, item ? item[1] : line, path))
      }
    }

    const month = (el: HTMLElement, spec: TrackerSpec, datasets: Dataset[], state: { month?: string }) => {
      const options = section(spec, 'month')
      const dataset = datasets[0]
      const all = [...dataset.values.keys()].sort()
      // The month the block's folder points at if it holds one month, else the current one.
      state.month ??= String(options.initMonth ?? (all.length && all[0].slice(0, 7) === all[all.length - 1].slice(0, 7) ? all[0].slice(0, 7) : moment().format('YYYY-MM')))
      const first = moment(`${state.month}-01`)
      const sunday = String(options.startWeekOn ?? 'Mon').toLowerCase().startsWith('sun')
      const threshold = Number(options.threshold ?? 0)
      const annotation = options.mode === 'annotation' ? String(options.annotation ?? '✓') : null
      const draw = () => {
        el.replaceChildren()
        month(el, spec, datasets, state)
      }
      const box = el.appendChild(document.createElement('div'))
      box.className = 'tracker-month'
      const head = box.appendChild(document.createElement('div'))
      head.className = 'tracker-month-head'
      const step = (label: string, by: number) => {
        const button = head.appendChild(document.createElement('button'))
        button.textContent = label
        button.onclick = () => {
          state.month = first.clone().add(by, 'month').format('YYYY-MM')
          draw()
        }
      }
      step('‹', -1)
      const name = first.format('MMMM YYYY')
      const title = head.appendChild(document.createElement('span'))
      title.textContent = name[0].toUpperCase() + name.slice(1)
      step('›', 1)
      const grid = box.appendChild(document.createElement('div'))
      grid.className = 'tracker-month-grid'
      for (const day of sunday ? ['Вс', ...WEEKDAYS.slice(0, 6)] : WEEKDAYS) {
        const cell = grid.appendChild(document.createElement('span'))
        cell.className = 'tracker-weekday'
        cell.textContent = day
      }
      const offset = sunday ? first.day() : first.isoWeekday() - 1
      for (let i = 0; i < offset; i++) grid.appendChild(document.createElement('span'))
      let hits = 0
      for (let date = first.clone(); date.format('YYYY-MM') === state.month; date = date.clone().add(1, 'day')) {
        const key = date.format('YYYY-MM-DD')
        const value = dataset.values.get(key) ?? 0
        const on = value > threshold
        if (on) hits++
        const cell = grid.appendChild(document.createElement('div'))
        cell.className = 'tracker-day'
        cell.classList.toggle('on', on && !annotation)
        cell.classList.toggle('today', key === moment().format('YYYY-MM-DD'))
        cell.title = `${date.format('D MMMM')}: ${value}`
        cell.append(String(date.date()))
        if (on && annotation) {
          const mark = cell.appendChild(document.createElement('span'))
          mark.className = 'tracker-mark'
          mark.textContent = annotation
        }
      }
      const foot = box.appendChild(document.createElement('div'))
      foot.className = 'tracker-month-foot'
      foot.textContent = `${dataset.name}: ${hits} из ${first.daysInMonth()} дней`
    }

    const processor: CodeBlockProcessor = (source, el, { path }) => {
      el.classList.add('tracker-block')
      let current = source
      let charts: Chart[] = []
      let drawn = ''
      const state: { month?: string } = {}
      const draw = () => {
        try {
          const spec = (parse(current) ?? {}) as TrackerSpec
          const datasets = collect(app, spec)
          const range = days(datasets, spec)
          // Most changes in the vault leave a tracker's numbers as they were; then nothing is redrawn.
          const signature = JSON.stringify([current, datasets.map((dataset) => [...dataset.values]), moment().format('YYYY-MM-DD')])
          if (signature === drawn) return
          drawn = signature
          charts.forEach((made) => made.destroy())
          charts = []
          el.replaceChildren()
          // `type: bar` is accepted along with Tracker's own `bar:` section.
          const alias = typeof spec.type === 'string' ? spec.type.toLowerCase() : ''
          const kinds = ['line', 'bar', 'summary', 'month'].filter((kind) => kind in spec || kind === alias)
          if (!kinds.length) kinds.push('line')
          if (!range.length && !kinds.includes('month')) {
            el.appendChild(document.createElement('div')).className = 'tracker-none'
            el.firstElementChild!.textContent = 'Трекер: в заметках этой папки ничего не найдено'
            return
          }
          for (const kind of kinds) {
            if (kind === 'summary') summary(el, spec, datasets, range, path)
            else if (kind === 'month') month(el, spec, datasets, state)
            else charts.push(chart(el, spec, kind as 'line' | 'bar', datasets, range))
          }
        } catch (err) {
          drawn = ''
          el.replaceChildren()
          const error = el.appendChild(document.createElement('div'))
          error.className = 'tracker-error'
          error.textContent = `tracker: ${errorMessage(err)}`
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const later = () => {
        clearTimeout(timer)
        timer = setTimeout(draw, 400)
      }
      const offs = [app.metadata.on('changed', later), app.metadata.on('resolved', later)]
      requestAnimationFrame(draw)
      return {
        update(next) {
          current = next
          state.month = undefined
          draw()
        },
        destroy() {
          clearTimeout(timer)
          offs.forEach((off) => off())
          charts.forEach((made) => made.destroy())
        },
      }
    }
    this.registerCodeBlockProcessor('tracker', processor)

    this.addInsertCommand('insert-line', 'Вставить трекер: график', '```tracker\nsearchType: dvField\nsearchTarget: |\nfolder: /\nline:\n  title: \n```\n', 'chart-line')
    this.addInsertCommand('insert-summary', 'Вставить трекер: сводка', '```tracker\nsearchType: task.done\nsearchTarget: |\nfolder: /\nsummary:\n  template: "Всего: {{sum()}}, серия: {{currentStreak()}}, лучшая: {{maxStreak()}}"\n```\n', 'sigma')
    this.addInsertCommand('insert-month', 'Вставить трекер: месяц', '```tracker\nsearchType: task.done\nsearchTarget: |\nfolder: /\nmonth:\n  startWeekOn: Mon\n```\n', 'calendar-check')
  }
}
