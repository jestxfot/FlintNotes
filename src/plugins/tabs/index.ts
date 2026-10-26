import { createPreview, Plugin, type CodeBlockProcessor, type Preview } from '../../api'
import './style.css'

interface Tab {
  title: string
  text: string
}

/** Splits a block into tabs: a line `tab: Title` starts a tab, the lines after it are its text. */
function parseTabs(source: string, split: string): Tab[] {
  const tabs: Tab[] = []
  for (const line of source.split('\n')) {
    if (line.startsWith(split)) tabs.push({ title: line.slice(split.length).trim(), text: '' })
    else if (tabs.length) tabs[tabs.length - 1].text += (tabs[tabs.length - 1].text ? '\n' : '') + line
    // Text before the first tab would be lost in Obsidian too; it gets a tab of its own instead.
    else if (line.trim()) tabs.push({ title: '…', text: line })
  }
  return tabs
}

const format = (tabs: Tab[], split: string) => tabs.map((tab) => `${split} ${tab.title}\n${tab.text}`).join('\n')

/**
 * ````tabs
 * tab: First
 * Any Markdown, other blocks included.
 * tab: Second
 * …
 * ````
 */
export default class Tabs extends Plugin {
  onload() {
    const { app } = this
    this.addSettings([{ key: 'split', name: 'Начало вкладки', desc: 'Строка, с которой начинается вкладка в блоке ```tabs, например «tab: Первая»', type: 'text', default: 'tab:' }])

    const processor: CodeBlockProcessor = (source, el, { path, setSource }) => {
      el.classList.add('tabs-block')
      const split = this.getSetting<string>('split').trim() || 'tab:'
      const strip = el.appendChild(document.createElement('div'))
      strip.className = 'tabs-strip'
      strip.setAttribute('role', 'tablist')
      const body = el.appendChild(document.createElement('div'))
      body.className = 'tabs-body'

      let tabs: Tab[] = []
      let active = 0
      // Each tab's text is drawn once, when the tab is first opened, and kept after that.
      let panes: { el: HTMLElement; preview: Preview }[] = []

      const show = () => {
        ;[...strip.children].forEach((button, i) => {
          button.classList.toggle('active', i === active)
          button.setAttribute('aria-selected', String(i === active))
        })
        const tab = tabs[active]
        if (tab && !panes[active]) {
          const pane = body.appendChild(document.createElement('div'))
          pane.className = 'tabs-pane'
          const index = active
          // Ticking a checkbox or editing a rendered block inside a tab changes the note.
          const preview = createPreview(app, pane, tab.text, path, {
            depth: 1,
            onEdit: (text) => {
              tabs[index].text = text
              setSource(format(tabs, split))
            },
          })
          panes[active] = { el: pane, preview }
        }
        panes.forEach((pane, i) => pane && (pane.el.hidden = i !== active))
      }

      const draw = (text: string) => {
        const next = parseTabs(text, split)
        const sameTabs = next.length === tabs.length && next.every((tab, i) => tab.title === tabs[i].title)
        tabs = next
        if (sameTabs) {
          panes.forEach((pane, i) => pane?.preview.update(tabs[i].text))
          return
        }
        panes.forEach((pane) => pane?.preview.destroy())
        panes = []
        body.replaceChildren()
        strip.replaceChildren()
        active = Math.min(active, Math.max(0, tabs.length - 1))
        tabs.forEach((tab, i) => {
          const button = strip.appendChild(document.createElement('button'))
          button.className = 'tabs-tab'
          button.setAttribute('role', 'tab')
          button.textContent = tab.title || `Вкладка ${i + 1}`
          button.onclick = () => {
            active = i
            show()
          }
        })
        if (!tabs.length) body.textContent = `Добавьте вкладку строкой «${split} Название»`
        show()
      }
      draw(source)
      return { update: draw, destroy: () => panes.forEach((pane) => pane?.preview.destroy()) }
    }
    this.registerCodeBlockProcessor('tabs', processor)
    this.addInsertCommand('insert', 'Вставить блок вкладок', '````tabs\ntab: |\n\ntab: \n\n````\n', 'panel-top')
  }
}
