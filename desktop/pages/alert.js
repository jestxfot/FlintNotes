// The reminders window: draws what the notes page sends and sends back what was chosen. It does nothing by itself.
const bridge = window.flintAlert
const list = document.getElementById('list')
const footer = document.getElementById('footer')

/** The text of a task comes from the notes page as markup; scripts and handlers are taken out all the same. */
function clean(html) {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('script,iframe,object,embed,style,link,meta,form').forEach((node) => node.remove())
  for (const el of template.content.querySelectorAll('*')) {
    for (const attribute of [...el.attributes]) {
      if (/^on/i.test(attribute.name) || (/^(href|src|xlink:href)$/i.test(attribute.name) && /^\s*javascript:/i.test(attribute.value))) el.removeAttribute(attribute.name)
    }
  }
  return template.content
}

document.addEventListener('click', (event) => event.target.closest?.('a') && event.preventDefault())

const make = (tag, className, text) => {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text) el.textContent = text
  return el
}
const button = (label, className, action) => {
  const el = make('button', className, label)
  el.onclick = action
  return el
}
const ICONS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/>',
  chev: '<path d="m7 7 5 5-5 5M13 7l5 5-5 5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
}
/** A small line icon (the same family as the notes page's). */
const icon = (name, className) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', className ? `i ${className}` : 'i')
  svg.innerHTML = ICONS[name]
  return svg
}

/** A track with a handle: a slide to the end confirms, anything less goes back. Arrow keys work too, in five steps. */
function slider(label, done, tone) {
  const track = make('div', tone ? `slide ${tone}` : 'slide')
  track.setAttribute('role', 'slider')
  track.setAttribute('aria-label', label)
  track.setAttribute('aria-valuemin', '0')
  track.setAttribute('aria-valuemax', '100')
  track.setAttribute('aria-valuenow', '0')
  track.tabIndex = 0
  const fill = make('div', 'fill')
  const text = make('div', 'label', label)
  const handle = make('div', 'handle')
  handle.append(icon('chev', 'chev'), icon('check', 'check'))
  track.append(fill, text, handle)
  let value = 0
  let start = 0
  let dragging = false
  // The handle is 28 px wide and sits 2 px in from each end.
  const room = () => Math.max(1, track.clientWidth - 32)
  let fired = false
  const set = (next) => {
    value = Math.max(0, Math.min(1, next))
    track.style.setProperty('--slide', String(value))
    track.setAttribute('aria-valuenow', String(Math.round(value * 100)))
    track.classList.toggle('full', value >= 0.95)
  }
  // Once is enough: a second release or key press while the answer is on its way must not act twice.
  const fire = () => {
    if (fired) return
    fired = true
    set(1)
    done()
  }
  const finish = () => {
    if (value >= 0.95) return fire()
    track.classList.add('back')
    set(0)
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || fired) return
    dragging = true
    track.classList.remove('back')
    start = event.clientX - value * room()
    handle.setPointerCapture(event.pointerId)
  })
  handle.addEventListener('pointermove', (event) => dragging && set((event.clientX - start) / room()))
  for (const type of ['pointerup', 'pointercancel']) {
    handle.addEventListener(type, () => {
      if (!dragging) return
      dragging = false
      finish()
    })
  }
  track.addEventListener('keydown', (event) => {
    if (fired) return
    if (event.key === 'ArrowRight') set(value + 0.2)
    else if (event.key === 'ArrowLeft') set(value - 0.2)
    else if (event.key === 'Escape') set(0)
    else return
    event.preventDefault()
    if (value >= 1) fire()
  })
  return track
}

/** Replaces `host`'s content with a question that only a slide answers, and a way back. */
function confirm(host, question, label, done, back) {
  const box = make('div', 'confirm')
  const ask = make('div', 'ask')
  ask.append(icon('warn'), question)
  box.append(ask)
  const row = make('div', 'row')
  row.append(slider(label, done, 'warn'), button('Нет', '', back))
  box.append(row)
  host.replaceChildren(box)
}

let shown = ''

function render(model) {
  // The notes page repeats the list on every check; redrawing an unchanged one would drop a slide in progress or an open choice.
  const snapshot = JSON.stringify(model)
  if (snapshot === shown) return
  shown = snapshot
  for (const [name, value] of Object.entries(model.theme || {})) if (value) document.documentElement.style.setProperty(name, value)
  const count = model.items.length
  document.getElementById('title').textContent = count > 1 ? 'Напоминания' : 'Напоминание'
  const badge = document.getElementById('count')
  badge.hidden = count < 2
  badge.textContent = String(count)
  list.replaceChildren()
  for (const item of model.items) {
    const block = make('div', 'item')
    const text = make('div', 'text')
    text.append(clean(item.html))
    const meta = make('div', 'meta')
    const when = make('span', 'when')
    when.append(icon('clock'), item.time)
    const source = make('button', 'source')
    source.append(icon('note'), make('span', '', item.source))
    source.onclick = () => bridge.act({ type: 'open', key: item.key })
    source.title = 'Открыть заметку'
    const status = clean(item.statusHtml)
    meta.append(when, source, status)
    if (meta.querySelector('.overdue')) block.classList.add('overdue')
    else if (meta.querySelector('.soon')) block.classList.add('soon')
    const actions = make('div', 'actions')
    const slot = make('div')
    // Done is a slide too: a reminder is not ticked off by a stray click.
    const done = slider(item.plain ? 'Проведите — готово' : 'Проведите — выполнено', () => bridge.act({ type: 'done', key: item.key }), 'ok')
    const later = make('button', 'later')
    later.setAttribute('aria-expanded', 'false')
    // Short on the button so that the slide gets the room; the full words are for the tooltip and the screen reader.
    later.title = later.ariaLabel = 'Напомнить позже'
    later.append(icon('clock'), 'Позже', icon('down'))
    later.onclick = () => {
      if (slot.firstChild) {
        later.setAttribute('aria-expanded', 'false')
        return slot.replaceChildren()
      }
      later.setAttribute('aria-expanded', 'true')
      const choices = make('div', 'choices')
      model.later.forEach((label, option) => {
        choices.append(
          button(label, '', () => {
            const go = () => bridge.act({ type: 'later', key: item.key, option })
            if (!item.urgent) return go()
            confirm(slot, 'Это важная задача. Отложить?', 'Проведите, чтобы отложить', go, () => {
              later.setAttribute('aria-expanded', 'false')
              slot.replaceChildren()
            })
          }),
        )
      })
      slot.replaceChildren(choices)
    }
    actions.append(done, later)
    block.append(text, meta, actions, slot)
    list.append(block)
  }
  footer.hidden = count < 2
  footer.replaceChildren()
  if (count > 1) {
    const slot = make('div')
    footer.append(
      button('Отложить все на 10 минут', '', () => {
        const go = () => bridge.act({ type: 'all-later' })
        if (!model.items.some((item) => item.urgent)) return go()
        confirm(slot, 'Среди них есть важные задачи. Отложить все?', 'Проведите, чтобы отложить', go, () => slot.replaceChildren())
      }),
      slot,
    )
  }
}

// The card grows when a choice or a question opens inside it; the window follows its height, whatever the cause.
const card = document.getElementById('card')
new ResizeObserver(() => bridge.size(card.offsetHeight + 2)).observe(card)

bridge.onModel(render)
bridge.ready()
