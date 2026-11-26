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

/** A track with a handle: a slide to the end confirms, anything less goes back. Arrow keys work too, in five steps. */
function slider(label, done) {
  const track = make('div', 'slide')
  track.setAttribute('role', 'slider')
  track.setAttribute('aria-label', label)
  track.setAttribute('aria-valuemin', '0')
  track.setAttribute('aria-valuemax', '100')
  track.setAttribute('aria-valuenow', '0')
  track.tabIndex = 0
  const fill = make('div', 'fill')
  const text = make('div', 'label', label)
  const handle = make('div', 'handle', '›')
  track.append(fill, text, handle)
  let value = 0
  let start = 0
  let dragging = false
  const room = () => Math.max(1, track.clientWidth - 38)
  const set = (next) => {
    value = Math.max(0, Math.min(1, next))
    track.style.setProperty('--slide', String(value))
    track.setAttribute('aria-valuenow', String(Math.round(value * 100)))
  }
  const finish = () => {
    if (value >= 0.95) return done()
    track.classList.add('back')
    set(0)
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
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
    if (event.key === 'ArrowRight') set(value + 0.2)
    else if (event.key === 'ArrowLeft') set(value - 0.2)
    else if (event.key === 'Escape') set(0)
    else return
    event.preventDefault()
    if (value >= 1) done()
  })
  return track
}

/** Replaces `host`'s content with a question that only a slide answers, and a way back. */
function confirm(host, question, label, done, back) {
  const box = make('div', 'confirm')
  box.append(make('div', 'ask', question))
  const row = make('div', 'row')
  row.append(slider(label, done), button('Нет', '', back))
  box.append(row)
  host.replaceChildren(box)
}

function render(model) {
  for (const [name, value] of Object.entries(model.theme || {})) if (value) document.documentElement.style.setProperty(name, value)
  document.getElementById('title').textContent = model.items.length > 1 ? `Напоминания: ${model.items.length}` : 'Напоминание'
  list.replaceChildren()
  for (const item of model.items) {
    const block = make('div', 'item')
    const text = make('div', 'text')
    text.append(clean(item.html))
    const when = make('div', 'when')
    when.append(`${item.time} · `)
    const source = button(item.source, '', () => bridge.act({ type: 'open', key: item.key }))
    source.title = 'Открыть заметку'
    source.style.cssText = 'padding:0 4px;border:0;font-size:12px;color:var(--accent)'
    when.append(source)
    const status = make('div', 'status')
    status.append(clean(item.statusHtml))
    const actions = make('div', 'actions')
    const slot = make('div')
    // Done is a slide too: a reminder is not ticked off by a stray click.
    const done = slider(item.plain ? 'Проведите — готово' : 'Проведите — выполнено', () => bridge.act({ type: 'done', key: item.key }))
    const later = button('Напомнить позже ▾', '', () => {
      if (slot.firstChild) return slot.replaceChildren()
      const choices = make('div', 'choices')
      model.later.forEach((label, option) => {
        choices.append(
          button(label, '', () => {
            const go = () => bridge.act({ type: 'later', key: item.key, option })
            if (!item.urgent) return go()
            confirm(slot, 'Это важная задача. Отложить?', 'Проведите, чтобы отложить', go, () => slot.replaceChildren())
          }),
        )
      })
      slot.replaceChildren(choices)
    })
    actions.append(done, later)
    block.append(text, when, status, actions, slot)
    list.append(block)
  }
  footer.hidden = model.items.length < 2
  footer.replaceChildren()
  if (model.items.length > 1) {
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
  requestAnimationFrame(() => bridge.size(document.getElementById('card').offsetHeight + 2))
}

bridge.onModel(render)
bridge.ready()
