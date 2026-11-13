// What the server sends to the phone, and when (server/reminders.ts), with no network, no disk and a clock that is moved:
// a reminder is sent once when it is due, not for what was due before sending began, not in quiet hours (after them),
// not when it was closed, again when it was postponed and the time came; a failed send is tried again; a crowd is one message.
//   node e2e/phone-reminders-check.mjs
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './helpers.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-reminders-'))
const bundle = path.join(dir, 'reminders.mjs')
await build({ entryPoints: [path.join(ROOT, 'server', 'reminders.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' })
const { PhoneReminders, plainWords } = await import(bundle)
fs.rmSync(dir, { recursive: true, force: true })

const results = []
const ok = (name, passed, detail = '') => {
  results.push(passed)
  console.log(`${passed ? '✓' : '✗'} ${name}${passed ? '' : `\n    ${detail}`}`)
}

const at = (h, m = 0, day = 14) => new Date(2026, 10, day, h, m).getTime()
const stamp = (day, h, m) => `2026-11-${String(day).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

/** A world: notes by path, settings, a clock, and every message that was sent. */
function world(files, settings = {}) {
  const w = { files, settings, clock: at(8), sent: [], fail: false, mtime: 1, kept: undefined }
  w.env = {
    vaults: () => ['/v'],
    notes: async () => Object.keys(w.files).map((p) => ({ path: p, mtime: w.mtime })),
    read: async (_, p) => w.files[p],
    settings: async () => w.settings,
    send: async (m) => (w.fail ? false : (w.sent.push(m), true)),
    load: async () => w.kept,
    save: async (state) => (w.kept = JSON.parse(JSON.stringify(state))),
    now: () => w.clock,
    name: () => 'v',
  }
  w.reminders = new PhoneReminders(w.env)
  return w
}

// ---- sent once, when due
{
  const w = world({ 'Todo.md': `- [ ] call mom ⏰ ${stamp(14, 10, 0)}\n- [ ] later ⏰ ${stamp(14, 18, 0)}\n` })
  await w.reminders.tick()
  ok('nothing is sent before a reminder is due', w.sent.length === 0, JSON.stringify(w.sent))
  w.clock = at(10, 0, 14)
  await w.reminders.tick()
  ok('a reminder is sent when its time comes, with its words, its time and its note', w.sent.length === 1 && w.sent[0].body === 'call mom\n10:00 · Todo' && w.sent[0].title === 'Напоминание о задаче', JSON.stringify(w.sent))
  w.clock = at(10, 5)
  await w.reminders.tick()
  await w.reminders.tick()
  ok('and only once', w.sent.length === 1, JSON.stringify(w.sent))
  const again = new PhoneReminders(w.env)
  w.clock = at(10, 30)
  await again.tick()
  ok('also after the server was restarted (what was sent is kept)', w.sent.length === 1, JSON.stringify(w.sent))
  w.clock = at(18, 0)
  await again.tick()
  ok('the next one comes at its own time', w.sent.length === 2 && w.sent[1].body.startsWith('later'), JSON.stringify(w.sent))
}

// ---- what was due before sending began is not sent
{
  const w = world({ 'Old.md': `- [ ] forgotten ⏰ ${stamp(13, 10, 0)}\n- [ ] 17:00 - 17:10 vitamin ⏰ ${stamp(14, 7, 0)}\n` })
  w.clock = at(8, 0)
  await w.reminders.tick()
  w.clock = at(8, 1)
  await w.reminders.tick()
  ok('what was already overdue when sending began is not sent in a heap', w.sent.length === 0, JSON.stringify(w.sent))
}

// ---- written another way: a plain line, the day's plan, a due date with the default time
{
  const w = world({ 'Plain.md': `Buy bread (@${stamp(14, 12, 0)})\n`, 'Calendar/2026-11-14.md': '- [ ] 13:00 - 13:30 walk [[Park|the park]]\n', 'Due.md': '- [ ] report 📅 2026-11-14\n' })
  await w.reminders.tick()
  w.clock = at(14, 0)
  await w.reminders.tick()
  const bodies = w.sent.map((m) => m.body).sort()
  ok('a plain line with (@time), a line of the day plan and a due date at the default time are all sent', bodies.length === 3 && bodies.some((b) => b.startsWith('Buy bread\n12:00')) && bodies.some((b) => b.startsWith('13:00 - 13:30 walk the park')) && bodies.some((b) => b.startsWith('report\n09:00')), JSON.stringify(w.sent))
  ok('a plain line is «Напоминание», a task «Напоминание о задаче»', w.sent.some((m) => m.title === 'Напоминание') && w.sent.some((m) => m.title === 'Напоминание о задаче'), JSON.stringify(w.sent))
}

// ---- done tasks, closed and postponed ones
{
  const w = world({ 'T.md': `- [x] done ⏰ ${stamp(14, 10, 0)}\n- [ ] closed ⏰ ${stamp(14, 10, 0)}\n- [ ] postponed ⏰ ${stamp(14, 10, 0)}\n- [ ] open ⏰ ${stamp(14, 10, 0)}\n` })
  const key = (d) => `T.md|${d}|${at(10, 0)}`
  w.settings = { acknowledged: { [key('closed')]: at(9, 0) }, snoozed: { [key('postponed')]: at(11, 0) } }
  await w.reminders.tick()
  w.clock = at(10, 0)
  await w.reminders.tick()
  ok('a done task and one the person closed are not sent; a postponed one waits; an open one is sent', w.sent.length === 1 && w.sent[0].body.startsWith('open'), JSON.stringify(w.sent))
  w.clock = at(11, 0)
  await w.reminders.tick()
  ok('a postponed one is sent when the time it was postponed to comes', w.sent.length === 2 && w.sent[1].body.startsWith('postponed'), JSON.stringify(w.sent))
}

// ---- quiet hours, and "remind before"
{
  const w = world({ 'Q.md': `- [ ] night ⏰ ${stamp(14, 23, 30)}\n` }, { quietFrom: '23:00', quietTo: '07:00' })
  w.clock = at(22, 0)
  await w.reminders.tick()
  w.clock = at(23, 30)
  await w.reminders.tick()
  ok('in quiet hours nothing is sent', w.sent.length === 0, JSON.stringify(w.sent))
  w.clock = at(7, 0, 15)
  await w.reminders.tick()
  ok('and what was held back comes when they end', w.sent.length === 1 && w.sent[0].body.startsWith('night'), JSON.stringify(w.sent))
  const early = world({ 'E.md': `- [ ] meeting ⏰ ${stamp(14, 10, 0)}\n` }, { leadMinutes: 15 })
  await early.reminders.tick()
  early.clock = at(9, 44)
  await early.reminders.tick()
  const before = early.sent.length
  early.clock = at(9, 45)
  await early.reminders.tick()
  ok('«remind N minutes before» is honoured', before === 0 && early.sent.length === 1, JSON.stringify(early.sent))
}

// ---- a send that fails, a crowd, a note changed
{
  const w = world({ 'F.md': `- [ ] flaky ⏰ ${stamp(14, 10, 0)}\n` })
  await w.reminders.tick()
  w.clock = at(10, 0)
  w.fail = true
  await w.reminders.tick()
  w.fail = false
  w.clock = at(10, 1)
  await w.reminders.tick()
  ok('a message that did not go is sent at the next look', w.sent.length === 1, JSON.stringify(w.sent))

  const crowd = world({ 'C.md': Array.from({ length: 10 }, (_, i) => `- [ ] job ${i} ⏰ ${stamp(14, 10, i)}`).join('\n') })
  await crowd.reminders.tick()
  crowd.clock = at(11, 0)
  await crowd.reminders.tick()
  ok('ten at once are six messages and one that tells the rest', crowd.sent.length === 7 && /Ещё напоминаний: 4/.test(crowd.sent[6].title), JSON.stringify(crowd.sent.map((m) => m.title)))
  crowd.clock = at(11, 5)
  await crowd.reminders.tick()
  ok('and none of them again', crowd.sent.length === 7)

  const edit = world({ 'N.md': `- [ ] moved ⏰ ${stamp(14, 20, 0)}\n` })
  await edit.reminders.tick()
  edit.files['N.md'] = `- [ ] moved ⏰ ${stamp(14, 9, 0)}\n`
  edit.mtime = 2
  edit.clock = at(9, 0)
  await edit.reminders.tick()
  ok('a note edited meanwhile is read again: a reminder moved earlier is sent at its new time', edit.sent.length === 1, JSON.stringify(edit.sent))
}

ok('links and marks are not read out', plainWords('see [[Note|the note]] and [[Other]] [site](https://x.y)  ok') === 'see the note and Other site ok', plainWords('see [[Note|the note]] and [[Other]] [site](https://x.y)  ok'))

const failed = results.filter((passed) => !passed).length
console.log(failed ? `\n${failed} из ${results.length} проверок не прошли` : `\nВсе ${results.length} проверок прошли`)
process.exit(failed ? 1 : 0)
