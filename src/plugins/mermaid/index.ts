import { errorMessage, Plugin } from '../../api'
import './style.css'

type Mermaid = typeof import('mermaid').default

/**
 * ```mermaid
 * graph TD
 *   A[Idea] --> B{Worth it?}
 *   B -- yes --> C[Do it]
 * ```
 * The diagram is drawn by the Mermaid library, the same one Obsidian uses, so a
 * block written in either app looks the same in the other. The library is
 * large and is fetched only when the first diagram is shown.
 */
export default class MermaidDiagrams extends Plugin {
  private library: Promise<Mermaid> | null = null
  private theme = ''
  private count = 0

  onload() {
    this.registerCodeBlockProcessor('mermaid', (source, el) => {
      el.classList.add('mermaid-block')
      let current = source
      let alive = true
      const draw = async () => {
        const text = current
        try {
          const mermaid = await this.load()
          // The library draws off the page under an id of its own and gives the picture back as text.
          const { svg, bindFunctions } = await mermaid.render(`flint-mermaid-${++this.count}`, text)
          if (!alive || text !== current) return
          el.classList.remove('mermaid-error')
          el.innerHTML = svg
          bindFunctions?.(el)
        } catch (err) {
          if (!alive || text !== current) return
          el.classList.add('mermaid-error')
          el.textContent = `Диаграмма: ${errorMessage(err)}`
          // A failed drawing leaves its scratch element behind.
          document.querySelectorAll('[id^="dflint-mermaid-"]').forEach((node) => node.remove())
        }
      }
      void draw()
      // The diagram follows the app's light or dark look.
      const observer = new MutationObserver(() => void draw())
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      return {
        update: (next) => {
          current = next
          void draw()
        },
        destroy: () => {
          alive = false
          observer.disconnect()
        },
      }
    })
    this.addInsertCommand('insert', 'Вставить диаграмму Mermaid', '```mermaid\ngraph TD\n  A[|] --> B\n```\n', 'workflow')
  }

  /** The library, set up for the look the app has now. */
  private async load(): Promise<Mermaid> {
    const mermaid = await (this.library ??= import('mermaid').then((module) => module.default))
    const dark = (document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'
    const theme = dark ? 'dark' : 'default'
    if (theme !== this.theme) {
      this.theme = theme
      // "strict" keeps the diagram's text from carrying scripts or links that run code.
      mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: 'inherit' })
    }
    return mermaid
  }
}
