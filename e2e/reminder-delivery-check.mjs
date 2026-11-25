// When the reminders window is on the screen, without a window manager or a window.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ReminderPresenter } from '../desktop/reminders.ts'

function setup() {
  const calls = []
  let changed = () => {}
  const surface = { show: () => calls.push('show'), hide: () => calls.push('hide') }
  const presenter = new ReminderPresenter(surface, (callback) => {
    changed = callback
    return () => calls.push('stop')
  })
  return { presenter, calls, fullscreen: (value) => changed(value) }
}
const item = (key = 'one') => ({ key, title: 'Напоминание', body: key })

test('a reminder waits for the fullscreen check, then the window is shown', () => {
  const t = setup()
  t.presenter.update({ items: [item()] })
  assert.equal(t.calls.at(-1), 'hide')
  t.fullscreen(false)
  assert.equal(t.calls.at(-1), 'show')
})

test('another program going fullscreen puts the window away until it ends', () => {
  const t = setup()
  t.presenter.update({ items: [item()] })
  t.fullscreen(false)
  t.fullscreen(true)
  assert.equal(t.calls.at(-1), 'hide')
  t.fullscreen(false)
  assert.equal(t.calls.at(-1), 'show')
})

test('a fresh reminder brings the window forward again', () => {
  const t = setup()
  t.presenter.update({ items: [item()] })
  t.fullscreen(false)
  t.presenter.update({ items: [item(), item('two')] })
  assert.deepEqual(t.calls.slice(-2), ['show', 'show'])
})

test('nothing left: the window goes and the watcher stops', () => {
  const t = setup()
  t.presenter.update({ items: [item()] })
  t.fullscreen(false)
  t.presenter.update({ items: [] })
  assert.deepEqual(t.calls.slice(-2), ['stop', 'hide'])
  t.fullscreen(false)
  assert.equal(t.calls.at(-1), 'hide')
})

test('clearing (the page reloads) puts the window away', () => {
  const t = setup()
  t.presenter.update({ items: [item()] })
  t.fullscreen(false)
  t.presenter.clear()
  assert.equal(t.calls.at(-1), 'hide')
})
