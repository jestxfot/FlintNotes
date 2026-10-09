import { Chart, registerables, type ChartConfiguration } from 'chart.js'
import { parse } from 'yaml'
import { errorMessage, Plugin, type CodeBlockProcessor } from '../../api'
import './style.css'

Chart.register(...registerables)

const PALETTE = ['red', 'blue', 'yellow', 'green', 'purple', 'orange', 'cyan', 'pink']
const TYPES = new Set(['bar', 'line', 'pie', 'doughnut', 'radar', 'polarArea'])

interface Series {
  title?: string
  data?: unknown[]
}

/**
 * ```chart
 * type: bar                       # line, pie, doughnut, radar, polarArea
 * labels: [Mon, Tue, Wed]
 * series:
 *   - title: Steps
 *     data: [4000, 7200, 5100]
 * tension: 0.2
 * width: 80%
 * beginAtZero: true
 * ```
 * and `window.renderChart(config, element)` with a Chart.js configuration.
 */
export default class Charts extends Plugin {
  onload() {
    const colors = () => {
      const style = getComputedStyle(document.documentElement)
      const read = (name: string) => style.getPropertyValue(name).trim()
      return { palette: PALETTE.map((name) => read(`--color-${name}`)), text: read('--text-muted'), grid: read('--border') }
    }
    const alpha = (color: string, opacity: number) => `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`

    /** Draws a Chart.js configuration into `el`, in the app's colours unless the configuration sets its own. */
    const render = (config: ChartConfiguration, el: HTMLElement): Chart => {
      const { text, grid } = colors()
      Chart.defaults.color = text
      Chart.defaults.borderColor = grid
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily
      const box = el.appendChild(document.createElement('div'))
      box.className = 'chart-box'
      return new Chart(box.appendChild(document.createElement('canvas')), { ...config, options: { responsive: true, maintainAspectRatio: true, animation: false, ...config.options } })
    }

    const fromBlock = (source: string): { config: ChartConfiguration; width?: string } => {
      const spec = (parse(source) ?? {}) as Record<string, unknown>
      const type = String(spec.type ?? 'bar')
      if (!TYPES.has(type)) throw new Error(`тип «${type}» не поддерживается; есть: ${[...TYPES].join(', ')}`)
      const series = (Array.isArray(spec.series) ? spec.series : []) as Series[]
      if (!series.length) throw new Error('нужен список series с полем data')
      const { palette } = colors()
      // Slices of a pie are coloured one by one; lines and bars, one colour per series.
      const perPoint = type === 'pie' || type === 'doughnut' || type === 'polarArea'
      const datasets = series.map((item, i) => ({
        label: String(item.title ?? ''),
        data: (item.data ?? []).map(Number),
        borderColor: perPoint ? undefined : palette[i % palette.length],
        backgroundColor: perPoint ? (item.data ?? []).map((_, n) => alpha(palette[n % palette.length], 0.75)) : alpha(palette[i % palette.length], type === 'line' || type === 'radar' ? 0.2 : 0.6),
        borderWidth: perPoint ? 0 : 2,
        tension: Number(spec.tension ?? 0),
        fill: !!spec.fill,
      }))
      const axes = type === 'bar' || type === 'line'
      const scale = { beginAtZero: !!spec.beginAtZero, stacked: !!spec.stacked }
      return {
        width: typeof spec.width === 'string' || typeof spec.width === 'number' ? String(spec.width) : undefined,
        config: {
          type: type as 'bar',
          data: { labels: (Array.isArray(spec.labels) ? spec.labels : []).map(String), datasets },
          options: {
            indexAxis: spec.indexAxis === 'y' ? 'y' : 'x',
            plugins: { legend: { display: spec.legend !== false, position: (spec.legendPosition as 'top') ?? 'top' } },
            ...(axes ? { scales: { x: scale, y: scale } } : {}),
          },
        } as ChartConfiguration,
      }
    }

    const block: CodeBlockProcessor = (source, el) => {
      el.classList.add('chart-block')
      let chart: Chart | undefined
      const draw = (text: string) => {
        chart?.destroy()
        chart = undefined
        el.replaceChildren()
        try {
          const { config, width } = fromBlock(text)
          el.style.setProperty('--chart-width', width ? (/^\d+$/.test(width) ? `${width}px` : width) : '')
          chart = render(config, el)
        } catch (err) {
          const error = el.appendChild(document.createElement('div'))
          error.className = 'chart-error'
          error.textContent = `chart: ${errorMessage(err)}`
        }
      }
      draw(source)
      return { update: draw, destroy: () => chart?.destroy() }
    }
    this.registerCodeBlockProcessor('chart', block)

    // Scripts written for Obsidian Charts call this.
    const scope = window as unknown as { renderChart?: unknown }
    scope.renderChart = (config: ChartConfiguration, el: HTMLElement) => render(config, el)
    this.register(() => delete scope.renderChart)
  }
}
