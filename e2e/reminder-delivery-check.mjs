// The desktop delivery queue without a window manager or an OS notification service.
// node --import tsx --test e2e/reminder-delivery-check.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ReminderPresenter } from '../desktop/reminders.ts'

const item = (key = 'one') => ({ key, title: 'Reminder', body: key })
function setup({ focused = false, supported = true } = {}) {
  const calls = []
  const notifications = new Map()
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
  }, (notice, failed) => {
    if (!supported) return false
    notifications.set(notice.key, failed)
    calls.push(`notify:${notice.key}`)
    return true
  }, (keep) => {
    for (const key of notifications.keys()) if (!keep.has(key)) notifications.delete(key)
  })
  return { presenter, calls, notifications, window, fullscreen: (value) => changed(value) }
}

test('a reminder waits for fullscreen detection, then restores and raises the hidden app once', () => {
  const t = setup()
  t.presenter.update({ system: false, items: [item()] })
  assert.deepEqual(t.calls, [])
  t.fullscreen(true)
  assert.deepEqual(t.calls, [])
  t.fullscreen(false)
  assert.deepEqual(t.calls, ['restore', 'show', 'raise'])
  t.fullscreen(false)
  t.presenter.update({ system: false, items: [item()] })
  assert.equal(t.calls.filter((one) => one === 'show').length, 1)
  t.presenter.clear()
  assert.equal(t.calls.at(-1), 'lower')
})

test('a new fullscreen session removes topmost and defers raising until it ends', () => {
  const t = setup()
  t.presenter.update({ system: false, items: [item()] })
  t.fullscreen(false)
  t.fullscreen(true)
  assert.equal(t.calls.at(-1), 'lower')
  t.presenter.update({ system: false, items: [item(), item('two')] })
  assert.equal(t.calls.at(-1), 'lower')
  t.fullscreen(false)
  assert.equal(t.calls.filter((one) => one === 'show').length, 2)
})

test('dismissing or muting cancels deferred reminders and stops the fullscreen watcher', () => {
  const t = setup()
  t.presenter.update({ system: true, items: [item()] })
  t.fullscreen(true)
  t.presenter.update({ system: true, items: [] })
  t.fullscreen(false)
  assert.deepEqual(t.calls, ['stop'])
})

test('system notifications wait for fullscreen to end and do not raise the app', () => {
  const t = setup()
  t.presenter.update({ system: true, items: [item()] })
  t.fullscreen(true)
  assert.equal(t.notifications.size, 0)
  t.fullscreen(false)
  assert.deepEqual(t.calls, ['notify:one'])
  t.presenter.update({ system: true, items: [item(), item('two')] })
  assert.deepEqual(t.calls, ['notify:one', 'notify:two'])
  t.presenter.update({ system: true, items: [item('two')] })
  assert.deepEqual([...t.notifications.keys()], ['two'])
})

test('native failure falls back to the app, respecting a fullscreen session that started meanwhile', () => {
  const t = setup()
  t.presenter.update({ system: true, items: [item()] })
  t.fullscreen(false)
  t.fullscreen(true)
  t.notifications.get('one')()
  assert.deepEqual(t.calls, ['notify:one'])
  t.fullscreen(false)
  assert.deepEqual(t.calls, ['notify:one', 'restore', 'show', 'raise'])
})

test('unavailable system notifications fall back, and a stale failure cannot reopen a dismissed reminder', () => {
  const unsupported = setup({ supported: false })
  unsupported.presenter.update({ system: true, items: [item()] })
  unsupported.fullscreen(false)
  assert.deepEqual(unsupported.calls, ['restore', 'show', 'raise'])

  const t = setup()
  t.presenter.update({ system: true, items: [item()] })
  t.fullscreen(false)
  const fail = t.notifications.get('one')
  t.presenter.update({ system: true, items: [] })
  fail()
  assert.deepEqual(t.calls, ['notify:one', 'stop'])
})

test('switching delivery mode applies to an outstanding reminder immediately', () => {
  const t = setup()
  t.presenter.update({ system: false, items: [item()] })
  t.fullscreen(false)
  t.presenter.update({ system: true, items: [item()] })
  assert.deepEqual(t.calls.slice(-2), ['lower', 'notify:one'])
  t.presenter.update({ system: false, items: [item()] })
  assert.deepEqual(t.calls.slice(-2), ['show', 'raise'])
  assert.equal(t.notifications.size, 0)
})

test('manual hiding does not reopen old reminders, but a fresh reminder still shows', () => {
  const t = setup()
  t.presenter.update({ system: false, items: [item()] })
  t.fullscreen(false)
  t.presenter.hidden()
  t.fullscreen(false)
  assert.equal(t.calls.at(-1), 'lower')
  t.presenter.update({ system: false, items: [item(), item('two')] })
  assert.equal(t.calls.at(-1), 'raise')
})

test('the app itself in fullscreen also blocks automatic delivery', () => {
  const t = setup()
  t.window.fullscreen = true
  t.presenter.update({ system: false, items: [item()] })
  t.fullscreen(false)
  assert.deepEqual(t.calls, [])
  t.window.fullscreen = false
  t.fullscreen(false)
  assert.equal(t.calls.at(-1), 'raise')
})

test('a focused app uses its existing dialog instead of duplicating a system notification', () => {
  const t = setup({ focused: true })
  t.presenter.update({ system: true, items: [item()] })
  t.fullscreen(false)
  assert.deepEqual(t.calls, [])
})

test('a window manager resetting topmost after mapping is corrected without reopening the window', () => {
  const t = setup()
  t.presenter.update({ system: false, items: [item()] })
  t.fullscreen(false)
  t.window.top = false
  t.fullscreen(false)
  assert.equal(t.window.top, true)
  assert.equal(t.calls.filter((one) => one === 'show').length, 1)
  t.presenter.hidden()
  t.fullscreen(false)
  assert.equal(t.window.top, false)
})
