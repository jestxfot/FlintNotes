<script lang="ts">
  import { onMount } from 'svelte'
  import { errorMessage, moment, renderInline, watch, type App, type Moment, type Plugin } from '../../api'
  import type { PeriodicNotes } from './periodic'

  let { app, plugin, notes }: { app: App; plugin: Plugin; notes: PeriodicNotes } = $props()

  /** What the Tasks plugin offers to others, when it is on. */
  interface VaultTask {
    path: string
    line: number
    raw: string
    status: string
    description: string
    due?: string
    scheduled?: string
    start?: string
    plain?: boolean
  }
  interface TasksService {
    all(): VaultTask[]
    toggle(task: VaultTask): Promise<void>
    edit(task: VaultTask): void
    on(name: 'change', fn: () => void): () => void
  }

  /** One line of a day: a block of its plan, a task of its note, or a task from elsewhere dated to it. */
  interface Item {
    id: string
    path: string
    line: number
    raw: string
    text: string
    /** `null` for a line without a box. */
    status: string | null
    done: boolean
    /** `HH:mm` when the line begins with a time. */
    time: string
    kind: 'plan' | 'note' | 'task'
    task?: VaultTask
  }

  type Mode = 'month' | 'week' | 'year' | 'list'
  const MODES: [Mode, string][] = [
    ['month', 'Месяц'],
    ['week', 'Неделя'],
    ['year', 'Год'],
    ['list', 'Список'],
  ]
  const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
  const KEY = 'YYYY-MM-DD'
  const BOX = /^(\s*(?:[-*+]|\d+[.)])\s+)(?:\[(.)\]\s+)?(.*)$/
  const TIME = /^(\d{1,2}):(\d{2})(?:\s*[-–—]\s*\d{1,2}:\d{2})?\s+/
  const MARKS = /\s*(?:📅|⏳|🛫|➕|✅|❌|⏰)️?\s*\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?|\s*\(@[^)]*\)/gu

  let today = $state.raw(moment().startOf('day'))
  /** The day the calendar stands on: its month, week or year is shown, and its tasks beside. */
  let chosen = $state.raw(moment().startOf('day'))
  /** Goes up when notes or tasks change. */
  let written = $state(0)
  let adding = $state('')

  // svelte-ignore state_referenced_locally
  const files = watch(app.vault, ['create', 'delete', 'rename'], () => ({}))
  // svelte-ignore state_referenced_locally
  const settings = watch(app.settings, ['change'], () => ({
    sundayFirst: plugin.getSetting<string>('weekStart') === 'sunday',
    weekNumbers: plugin.getSetting<boolean>('weekNumbers') !== false,
    mode: (MODES.some(([id]) => id === plugin.getSetting<string>('boardView')) ? plugin.getSetting<string>('boardView') : 'month') as Mode,
    field: plugin.getSetting<string>('boardField') ?? 'happens',
    tasks: plugin.getSetting<boolean>('boardTasks') !== false,
    note: plugin.getSetting<boolean>('boardNote') !== false,
    plan: plugin.getSetting<boolean>('boardPlan') !== false,
    done: plugin.getSetting<boolean>('boardDone') !== false,
    lines: Math.max(1, plugin.getSetting<number>('boardLines') ?? 5),
  }))
  const mode = $derived(settings.current.mode)
  const service = () => app.services.get<TasksService>('tasks')

  const weekStart = (date: Moment): Moment => {
    const start = date.clone().startOf('isoWeek')
    if (settings.current.sundayFirst) start.subtract(date.day() === 0 ? -6 : 1, 'day')
    return start
  }

  /** Tasks from anywhere in the vault, by the day they stand on. */
  const dated = $derived.by(() => {
    void written
    const map = new Map<string, VaultTask[]>()
    if (!settings.current.tasks) return map
    const field = settings.current.field
    for (const task of service()?.all() ?? []) {
      const date = field === 'happens' ? (task.due ?? task.scheduled ?? task.start) : (task as unknown as Record<string, string | undefined>)[field]
      if (date) map.set(date, [...(map.get(date) ?? []), task])
    }
    return map
  })

  const clean = (text: string) => text.replace(MARKS, '').trim()

  /** Everything of one day, in the order of the day: by time, then what is open, then what is done. */
  function itemsOf(date: Moment): Item[] {
    void written
    void files.current
    const { note: showNote, plan, done: showDone } = settings.current
    const key = date.format(KEY)
    const note = notes.find('daily', date)
    const items: Item[] = []
    const seen = new Set<string>()
    const text = note && (showNote || plan) ? (app.metadata.text(note) ?? '') : ''
    if (note && text) {
      const known = new Map((service()?.all() ?? []).filter((task) => task.path === note).map((task) => [task.line, task]))
      let fence = false
      text.split(/\r?\n/).forEach((raw, line) => {
        if (/^\s*(```|~~~)/.test(raw)) fence = !fence
        if (fence) return
        const m = BOX.exec(raw)
        if (!m) return
        const time = TIME.exec(m[3])
        // A line without a box is of the day only when it begins with a time.
        if (m[2] === undefined && !time) return
        if (time ? !plan : !showNote) return
        seen.add(`${note}:${line}`)
        items.push({
          id: `${note}:${line}`,
          path: note,
          line,
          raw,
          text: clean(time ? m[3].slice(time[0].length) : m[3]),
          status: m[2] ?? null,
          done: m[2] !== undefined && m[2] !== ' ',
          time: time ? `${time[1].padStart(2, '0')}:${time[2]}` : '',
          kind: time ? 'plan' : 'note',
          task: known.get(line),
        })
      })
    }
    for (const task of dated.get(key) ?? []) {
      const id = `${task.path}:${task.line}`
      if (seen.has(id) || task.plain) continue
      items.push({ id, path: task.path, line: task.line, raw: task.raw, text: clean(task.description), status: task.status, done: task.status !== ' ', time: '', kind: 'task', task })
    }
    return items
      .filter((item) => showDone || !item.done)
      .sort((a, b) => Number(!a.time) - Number(!b.time) || a.time.localeCompare(b.time) || Number(a.done) - Number(b.done) || a.line - b.line)
  }

  interface Day {
    date: Moment
    key: string
    outside: boolean
    note: string | null
    items: Item[]
  }
  const dayOf = (date: Moment, outside = false): Day => ({ date, key: date.format(KEY), outside, note: notes.find('daily', date), items: itemsOf(date) })

  const weeks = $derived.by(() => {
    if (mode !== 'month' && mode !== 'week') return []
    const first = mode === 'week' ? weekStart(chosen) : weekStart(chosen.clone().startOf('month'))
    const rows: { week: Moment; note: string | null; days: Day[] }[] = []
    for (let w = 0; w < (mode === 'week' ? 1 : 6); w++) {
      const days = Array.from({ length: 7 }, (_, d) => {
        const date = first.clone().add(w * 7 + d, 'day')
        return dayOf(date, mode === 'month' && date.month() !== chosen.month())
      })
      const thursday = days.find((day) => day.date.isoWeekday() === 4)!.date
      rows.push({ week: thursday, note: notes.find('weekly', thursday), days })
    }
    return rows
  })

  /** A year: twelve small months; a day says only how much it holds. */
  const year = $derived.by(() => {
    if (mode !== 'year') return []
    void written
    void files.current
    return Array.from({ length: 12 }, (_, index) => {
      const month = chosen.clone().startOf('year').add(index, 'month')
      const first = weekStart(month)
      const days = Array.from({ length: 42 }, (_, d) => {
        const date = first.clone().add(d, 'day')
        const key = date.format(KEY)
        const open = (dated.get(key) ?? []).filter((task) => task.status === ' ').length
        return { date, key, outside: date.month() !== month.month(), note: !!notes.find('daily', date), open }
      })
      return { month, days }
    })
  })

  /** A list: the days of the month that hold something, one under another. */
  const list = $derived.by(() => {
    if (mode !== 'list') return []
    const first = chosen.clone().startOf('month')
    return Array.from({ length: first.daysInMonth() }, (_, d) => dayOf(first.clone().add(d, 'day'))).filter((day) => day.items.length)
  })

  const selected = $derived(dayOf(chosen))
  const todayKey = $derived(today.format(KEY))
  const chosenKey = $derived(chosen.format(KEY))
  const headers = $derived(settings.current.sundayFirst ? ['вс', ...WEEKDAYS.slice(0, 6)] : WEEKDAYS)
  const title = $derived.by(() => {
    if (mode === 'year') return String(chosen.year())
    if (mode !== 'week') return chosen.format('MMMM YYYY')
    const first = weekStart(chosen)
    const last = first.clone().add(6, 'day')
    return first.month() === last.month() ? `${first.format('D')}–${last.format('D MMMM YYYY')}` : `${first.format('D MMM')} – ${last.format('D MMM YYYY')}`
  })
  const groups = $derived(
    (
      [
        ['plan', 'План дня'],
        ['task', 'Задачи на этот день'],
        ['note', 'В заметке дня'],
      ] as const
    )
      .map(([kind, name]) => ({ kind, name, items: selected.items.filter((item) => item.kind === kind) }))
      .filter((group) => group.items.length),
  )
  const openCount = (items: Item[]) => items.filter((item) => item.status !== null && !item.done).length

  const step = (by: number) => (chosen = chosen.clone().add(by, mode === 'week' ? 'week' : mode === 'year' ? 'year' : 'month'))
  const show = (next: Mode) => plugin.setSetting('boardView', next)
  const flip = (key: string) => plugin.setSetting(key, plugin.getSetting<boolean>(key) === false)

  /** Rewrites one line of a note, found again by its text if the note has changed meanwhile. */
  async function rewrite(item: Item, change: (raw: string) => string): Promise<void> {
    try {
      await app.workspace.flushAll()
      const text = await app.vault.read(item.path)
      const lines = text.split(/\r?\n/)
      const at = lines[item.line] === item.raw ? item.line : lines.indexOf(item.raw)
      if (at < 0) return void app.notice('Заметка изменилась, календарь сейчас обновится')
      lines[at] = change(lines[at])
      await app.vault.write(item.path, lines.join(text.includes('\r\n') ? '\r\n' : '\n'))
    } catch (err) {
      app.notice(`Календарь: ${errorMessage(err)}`)
    }
  }

  function toggle(item: Item): void {
    // The Tasks plugin completes a task properly: the day it was done, the next occurrence.
    if (item.task && service()) return void service()!.toggle(item.task)
    void rewrite(item, (raw) => {
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/.exec(raw)
      if (!m) return raw
      const open = m[2] === ' '
      const body = raw.slice(m[0].length).replace(/\s*✅️?\s*\d{4}-\d{2}-\d{2}/u, '')
      return `${m[1]}${open ? 'x' : ' '}${m[3]}${body}${open ? ` ✅ ${moment().format(KEY)}` : ''}`
    })
  }

  /** A task opens in the window of tasks; a line that is not one, in its note. */
  function openItem(event: MouseEvent, item: Item): void {
    if ((event.target as Element).closest('a, input')) return
    if (item.task && service()) service()!.edit(item.task)
    else app.workspace.openFile(item.path, { line: item.line })
  }

  /** A new task of the chosen day goes to the end of its note, which is made if need be. */
  async function add(): Promise<void> {
    const text = adding.trim()
    if (!text) return
    try {
      const note = await notes.ensure('daily', chosen)
      if (!note) return
      await app.workspace.flushAll()
      const before = await app.vault.read(note)
      const eol = before.includes('\r\n') ? '\r\n' : '\n'
      await app.vault.write(note, `${before.replace(/(\r?\n)*$/, '')}${before.trim() ? eol : ''}- [ ] ${text}${eol}`)
      adding = ''
    } catch (err) {
      app.notice(`Календарь: ${errorMessage(err)}`)
    }
  }

  const inline = (node: HTMLElement, item: Item) => {
    const draw = (one: Item) => node.replaceChildren(renderInline(app, one.text, one.path))
    draw(item)
    return { update: draw }
  }

  onMount(() => {
    const timer = setInterval(() => {
      if (!moment().isSame(today, 'day')) today = moment().startOf('day')
    }, 60_000)
    let later: ReturnType<typeof setTimeout> | undefined
    const soon = () => {
      clearTimeout(later)
      later = setTimeout(() => written++, 150)
    }
    const offs = [app.metadata.on('changed', (path) => notes.dateOf('daily', path) && soon()), app.metadata.on('resolved', soon)]
    // The Tasks plugin may be turned on after the calendar was opened.
    let offTasks: (() => void) | undefined
    const hook = () => {
      offTasks ??= service()?.on('change', soon)
    }
    hook()
    const waiting = setInterval(hook, 3000)
    return () => {
      clearInterval(timer)
      clearInterval(waiting)
      clearTimeout(later)
      offs.forEach((off) => off())
      offTasks?.()
    }
  })
</script>

{#snippet line(item: Item, full: boolean)}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="item {item.kind}" class:done={item.done} title={full ? item.path : `${item.time} ${item.text}`.trim()} onclick={(event) => (event.stopPropagation(), openItem(event, item))}>
    {#if item.status !== null}
      <input type="checkbox" checked={item.done} aria-label="Выполнено" onclick={(event) => event.stopPropagation()} onchange={() => toggle(item)} />
    {/if}
    {#if item.time}<span class="time">{item.time}</span>{/if}
    <span class="text" use:inline={item}></span>
    {#if full && item.kind === 'task'}<span class="source">{item.path.replace(/^.*\//, '').replace(/\.md$/, '')}</span>{/if}
  </div>
{/snippet}

<div class="board" data-mode={mode}>
  <div class="head">
    <button class="nav" aria-label="Назад" onclick={() => step(-1)}>‹</button>
    <button class="nav" aria-label="Вперёд" onclick={() => step(1)}>›</button>
    <button class="now" onclick={() => (chosen = moment().startOf('day'))}>Сегодня</button>
    <h2>{title}</h2>
    <span class="grow"></span>
    <div class="modes" role="tablist">
      {#each MODES as [id, name] (id)}
        <button role="tab" aria-selected={mode === id} class:on={mode === id} onclick={() => show(id)}>{name}</button>
      {/each}
    </div>
    <button
      class="options"
      title="Что показывать"
      aria-label="Что показывать"
      onclick={(event) =>
        app.menus.show(event, 'calendar-board', null, [
          { icon: settings.current.plan ? 'check' : 'minus', title: 'План дня (строки со временем)', onClick: () => flip('boardPlan') },
          { icon: settings.current.note ? 'check' : 'minus', title: 'Задачи из заметки дня', onClick: () => flip('boardNote') },
          { icon: settings.current.tasks ? 'check' : 'minus', title: 'Задачи с датой из всех заметок', onClick: () => flip('boardTasks') },
          { icon: settings.current.done ? 'check' : 'minus', title: 'Выполненное', onClick: () => flip('boardDone') },
          { icon: settings.current.weekNumbers ? 'check' : 'minus', title: 'Номера недель', onClick: () => flip('weekNumbers') },
          { section: 'edit', icon: 'file-text', title: 'Заметка месяца', onClick: () => void notes.open('monthly', chosen) },
          { section: 'edit', icon: 'file-text', title: 'Заметка года', onClick: () => void notes.open('yearly', chosen) },
          { section: 'edit', icon: 'settings', title: 'Настройки календаря…', onClick: () => app.commands.run('core:settings') },
        ])}>⋯</button
    >
  </div>

  <div class="body">
    <div class="main">
      {#if mode === 'month' || mode === 'week'}
        <div class="grid" class:numbered={settings.current.weekNumbers} role="grid">
          {#if settings.current.weekNumbers}<span class="label"></span>{/if}
          {#each headers as name (name)}<span class="label">{name}</span>{/each}
          {#each weeks as row (row.week.format('GGGG-WW'))}
            {#if settings.current.weekNumbers}
              <button class="week" class:has-note={!!row.note} title="Заметка недели {row.week.format('W')}" onclick={() => notes.open('weekly', row.week)}>{row.week.format('W')}</button>
            {/if}
            {#each row.days as day (day.key)}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <div
                class="cell"
                class:outside={day.outside}
                class:today={day.key === todayKey}
                class:chosen={day.key === chosenKey}
                data-date={day.key}
                onclick={() => (chosen = day.date.clone())}
                ondblclick={(event) => !(event.target as Element).closest('.item') && void notes.open('daily', day.date)}
              >
                <div class="cell-head">
                  {#if day.note}<i class="has-note" title="Есть заметка дня"></i>{/if}
                  {#if openCount(day.items)}<span class="count" title="Не выполнено">{openCount(day.items)}</span>{/if}
                  <span class="number">{day.date.date()}</span>
                </div>
                {#each mode === 'week' ? day.items : day.items.slice(0, settings.current.lines) as item (item.id)}
                  {@render line(item, false)}
                {/each}
                {#if mode === 'month' && day.items.length > settings.current.lines}
                  <span class="more">ещё {day.items.length - settings.current.lines}</span>
                {/if}
              </div>
            {/each}
          {/each}
        </div>
      {:else if mode === 'year'}
        <div class="year">
          {#each year as one (one.month.format('YYYY-MM'))}
            <div class="mini">
              <button
                class="mini-title"
                class:current={one.month.isSame(today, 'month')}
                onclick={() => {
                  chosen = one.month.clone()
                  show('month')
                }}>{one.month.format('MMMM')}</button
              >
              <div class="mini-grid">
                {#each headers as name (name)}<span class="label">{name[0]}</span>{/each}
                {#each one.days as day (day.key)}
                  {#if day.outside}
                    <span></span>
                  {:else}
                    <button
                      class="mini-day"
                      class:today={day.key === todayKey}
                      class:chosen={day.key === chosenKey}
                      class:has-note={day.note}
                      class:busy={day.open > 0}
                      data-date={day.key}
                      title={day.open ? `${day.date.format('D MMMM')}: не выполнено ${day.open}` : day.date.format('D MMMM')}
                      onclick={() => (chosen = day.date.clone())}>{day.date.date()}</button
                    >
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="list">
          {#each list as day (day.key)}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <section class:today={day.key === todayKey} class:chosen={day.key === chosenKey} data-date={day.key} onclick={() => (chosen = day.date.clone())}>
              <h3>{day.date.format('D MMMM, dddd')}<span class="count">{openCount(day.items)}</span></h3>
              {#each day.items as item (item.id)}{@render line(item, true)}{/each}
            </section>
          {:else}
            <p class="none">В этом месяце ничего не запланировано</p>
          {/each}
        </div>
      {/if}
    </div>

    <aside class="day">
      <div class="day-head">
        <div>
          <h3 class:today={chosenKey === todayKey}>{chosen.format('D MMMM')}</h3>
          <span class="weekday">{chosen.format('dddd')}{chosenKey === todayKey ? ' · сегодня' : ''}</span>
        </div>
        <span class="grow"></span>
        <button class="open-note" onclick={() => notes.open('daily', chosen)}>{selected.note ? 'Открыть заметку' : 'Создать заметку'}</button>
      </div>
      <div class="summary">
        {#if selected.items.length}
          Не выполнено {openCount(selected.items)} · всего {selected.items.length}
        {:else}
          На этот день ничего нет
        {/if}
      </div>
      <form
        class="add"
        onsubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <input type="text" placeholder="Новая задача на этот день — Enter" bind:value={adding} aria-label="Новая задача на этот день" />
      </form>
      <div class="day-items">
        {#each groups as group (group.kind)}
          <h4>{group.name}<span class="count">{group.items.length}</span></h4>
          {#each group.items as item (item.id)}{@render line(item, true)}{/each}
        {/each}
      </div>
    </aside>
  </div>
</div>

<style>
  .board {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    font: 13.5px/1.35 var(--font-ui);
    user-select: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px 10px;
  }

  .head h2 {
    margin: 0 0 0 8px;
    font-size: 20px;
    font-weight: 600;
  }

  .head h2::first-letter {
    text-transform: uppercase;
  }

  .grow {
    flex: 1;
  }

  .nav,
  .now,
  .options {
    padding: 3px 10px;
    border-radius: var(--radius-m);
    color: var(--text-muted);
  }

  .nav,
  .options {
    font-size: 18px;
    line-height: 1.1;
  }

  .now {
    border: 1px solid var(--border);
  }

  .nav:hover,
  .now:hover,
  .options:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .modes {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--bg-alt);
  }

  .modes button {
    padding: 4px 16px;
    border-radius: var(--radius-s);
    color: var(--text-muted);
  }

  .modes button:hover {
    color: var(--text);
  }

  .modes button.on {
    background: var(--bg);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text);
  }

  .body {
    display: flex;
    flex: 1;
    gap: 16px;
    min-height: 0;
  }

  .main {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  /* ---- a month and a week */
  .grid {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    grid-template-rows: auto;
    grid-auto-rows: minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-l, 10px);
  }

  .grid.numbered {
    grid-template-columns: 30px repeat(7, minmax(0, 1fr));
  }

  .label {
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
    background: var(--bg-alt);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-align: center;
    text-transform: uppercase;
  }

  .week {
    padding-top: 6px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-alt);
    color: var(--text-faint);
    font-size: 11px;
  }

  .week.has-note {
    color: var(--accent);
    font-weight: 600;
  }

  .week:hover {
    color: var(--text);
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: 3px 4px 4px;
    overflow: hidden;
    border-bottom: 1px solid var(--border);
    border-left: 1px solid var(--border);
    cursor: pointer;
  }

  [data-mode='week'] .cell {
    overflow-y: auto;
  }

  .cell:hover {
    background: var(--bg-hover);
  }

  .cell.outside {
    background: var(--bg-alt);
  }

  .cell.outside > * {
    opacity: 0.5;
  }

  .cell.chosen {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .cell-head {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 1px;
  }

  .number {
    min-width: 24px;
    margin-left: auto;
    padding: 0 5px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 600;
    line-height: 22px;
    text-align: center;
  }

  .cell.today .number {
    background: var(--accent);
    color: var(--accent-text);
  }

  .has-note {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0.7;
  }

  .count {
    min-width: 17px;
    padding: 0 5px;
    border-radius: 2em;
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
  }

  .more {
    padding-left: 5px;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  /* ---- one line of a day */
  .item {
    display: flex;
    flex: none;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
    padding: 1px 5px;
    border-left: 2px solid var(--accent);
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    font-size: 12px;
    cursor: pointer;
  }

  .item.task {
    border-left-color: var(--color-orange);
    background: color-mix(in srgb, var(--color-orange) 10%, transparent);
  }

  .item.note {
    border-left-color: var(--text-faint);
    background: none;
  }

  .item:hover {
    background: var(--bg-hover);
  }

  .item.done {
    border-left-color: var(--text-faint);
    background: none;
    color: var(--text-faint);
  }

  .item.done .text {
    text-decoration: line-through;
  }

  .item input {
    flex: none;
    align-self: center;
    margin: 0;
  }

  .time {
    flex: none;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    color: var(--text-faint);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- a year */
  .year {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px 22px;
    overflow-y: auto;
    padding: 2px;
  }

  .mini-title {
    margin-bottom: 4px;
    padding: 1px 6px;
    border-radius: var(--radius-s);
    font-size: 14px;
    font-weight: 600;
    text-transform: capitalize;
  }

  .mini-title.current {
    color: var(--accent);
  }

  .mini-title:hover {
    background: var(--bg-hover);
  }

  .mini-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
  }

  .mini-grid .label {
    padding: 2px 0;
    border: 0;
    background: none;
    font-size: 10px;
  }

  .mini-day {
    position: relative;
    padding: 3px 0;
    border-radius: var(--radius-s);
    color: var(--text-muted);
    font-size: 12px;
  }

  .mini-day.has-note {
    color: var(--text);
    font-weight: 600;
  }

  .mini-day.busy::after {
    content: '';
    position: absolute;
    bottom: 1px;
    left: calc(50% - 2px);
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--color-orange);
  }

  .mini-day:hover {
    background: var(--bg-hover);
  }

  .mini-day.chosen {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .mini-day.today {
    background: var(--accent);
    color: var(--accent-text);
  }

  /* ---- a list */
  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
  }

  .list section {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-l, 10px);
    cursor: pointer;
  }

  .list section.chosen {
    border-color: var(--accent);
  }

  .list h3,
  .day-items h4 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 2px 0 4px;
    font-size: 13px;
    font-weight: 600;
  }

  .list section.today h3 {
    color: var(--accent);
  }

  .list .item,
  .day .item {
    padding: 4px 8px;
    font-size: 13.5px;
  }

  .none {
    color: var(--text-faint);
  }

  /* ---- the chosen day */
  .day {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    width: 340px;
    min-height: 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-l, 10px);
    background: var(--bg-alt);
  }

  .day-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .day-head h3 {
    margin: 0;
    font-size: 18px;
  }

  .day-head h3.today {
    color: var(--accent);
  }

  .weekday,
  .summary {
    color: var(--text-muted);
    font-size: 12px;
  }

  .open-note {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    color: var(--text-muted);
    font-size: 12.5px;
  }

  .open-note:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .add input {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    user-select: text;
  }

  .add input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .day-items {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    overflow-y: auto;
  }

  .day-items h4 {
    margin-top: 8px;
    color: var(--text-muted);
    font-size: 11.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .day .text {
    white-space: normal;
  }

  /* A narrow page: the day goes under the calendar. */
  @container (max-width: 760px) {
    .body {
      flex-direction: column;
    }

    .day {
      width: auto;
      max-height: 45%;
    }
  }
</style>
