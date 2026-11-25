// The desktop delivery queue without a window manager or an OS notification service.
// node --import tsx --test e2e/reminder-delivery-check.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ReminderPresenter } from '../desktop/reminders.ts'

const item = (key = 'one') => ({ key, title: 'Reminder', body: key })
function setup({ focused = false } = {}) {
  const calls = []
  let changed
  const window = {
    fullscreen: false,
    minimized: true,
    top: false,
    isDestroyed: () => false,
    isFullScreen() { return this.fullscreen },
    isFocused: () => focused,
    isMinimized() { return this.minimized },
    isAlwaysOnTop() { return this.top },
    restore() { this.minimized = false; calls.push('restore') },
    showInactive: () => calls.push('show'),
    setAlwaysOnTop(value) { this.top = value; calls.push(value ? 'raise' : 'lower') },
  }
  const presenter = new ReminderPresenter(window, (callback) => {
    changed = callback
    return () => calls.push('stop')
  })
  return { presenter, calls, window, fullscreen: (value) => changed(value) }
}

test('a reminder waits for fullscreen detection, then restores and raises the hidden app once', () => {
  const t = setup()
  t.presenter.update({ items: [item()] })
  assert.deepEqual(t.calls, [])
  t.fullscreen(true)
  assert.deepEqual(t.calls, [])
  t.fullscreen(false)
  assert.deepEqual(t.calls, ['restore', 'show', 'raise'])
  t.fullscreen(false)
  t.presenter.update({ items: [item()] })
  assert.equal(t.calls.filter((one) => one === 'show').length, 1)
  t.presenter.clear()
  assert.equal(t.calls.at(-1), 'lower')
})

test('a new fullscreen session removes topmost and defers raising until it ends', () => {
  const t = setup()
  t.presenter.update({ items: [item()] })
  t.fullscreen(false)
  t.fullscreen(true)
  assert.equal(t.calls.at(-1), 'lower')
  t.presenter.update({ items: [item(), item('two')] })
  assert.equal(t.calls.at(-1), 'lower')
  t.fullscreen(false)
  assert.equal(t.calls.filter((one) => one === 'show').length, 2)
})

test('manual hiding does not reopen old reminders, but a fresh reminder still shows', () => {
  const t = setup()
  t.presenter.update({ items: [item()] })
  t.fullscreen(false)
  t.presenter.hidden()
  t.fullscreen(false)
  assert.equal(t.calls.at(-1), 'lower')
  t.presenter.update({ items: [item(), item('two')] })
  assert.equal(t.calls.at(-1), 'raise')
})

test('the app itself in fullscreen also blocks automatic delivery', () => {
  const t = setup()
  t.window.fullscreen = true
  t.presenter.update({ items: [item()] })
  t.fullscreen(false)
  assert.deepEqual(t.calls, [])
  t.window.fullscreen = false
  t.fullscreen(false)
  assert.equal(t.calls.at(-1), 'raise')
})

test('a window manager resetting topmost after mapping is corrected without reopening the window', () => {
  const t = setup()
  t.presenter.update({ items: [item()] })
  t.fullscreen(false)
  t.window.top = false
  t.fullscreen(false)
  assert.equal(t.window.top, true)
  assert.equal(t.calls.filter((one) => one === 'show').length, 1)
  t.presenter.hidden()
  t.fullscreen(false)
  assert.equal(t.window.top, false)
})
