<script lang="ts">
  import { onMount } from 'svelte'
  import { moment, watch, whenQuiet, type App, type Moment, type Plugin } from '../../api'
  import type { PeriodicNotes } from './periodic'

  let { app, plugin, notes }: { app: App; plugin: Plugin; notes: PeriodicNotes } = $props()

  const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
  const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

  /** The month on screen, as its first day. */
  let month = $state.raw(moment().startOf('month'))
  let today = $state.raw(moment().startOf('day'))

  /** Goes up when a daily note's text changes: its dots may be different now. */
  let written = $state(0)
  // svelte-ignore state_referenced_locally
  const files = watch(app.vault, ['create', 'delete', 'rename'], () => ({}))
  // svelte-ignore state_referenced_locally
  const active = watch(app.workspace, ['active-change', 'layout-change'], () => app.workspace.active?.path)
  // svelte-ignore state_referenced_locally
  const settings = watch(app.settings, ['change'], () => ({
    sundayFirst: plugin.getSetting<string>('weekStart') === 'sunday',
    weekNumbers: plugin.getSetting<boolean>('weekNumbers'),
    wordsPerDot: Math.max(1, plugin.getSetting<number>('wordsPerDot')),
  }))

  interface Day {
    date: Moment
    key: string
    outside: boolean
    note: string | null
    /** Filled dots: how much is written in the day's note. */
    dots: number
    /** The note has tasks that are not done yet. */
    openTasks: boolean
  }

  const weeks = $derived.by(() => {
    void written
    void files.current
    const { sundayFirst, wordsPerDot } = settings.current
    // The grid starts on the first day of the week that contains the 1st.
    const start = month.clone().startOf('isoWeek')
    if (sundayFirst) start.subtract(month.day() === 0 ? -6 : 1, 'day')
    const rows: { week: Moment; note: string | null; days: Day[] }[] = []
    for (let w = 0; w < 6; w++) {
      const days: Day[] = []
      for (let d = 0; d < 7; d++) {
        const date = start.clone().add(w * 7 + d, 'day')
        const note = notes.find('daily', date)
        const text = note ? (app.metadata.text(note) ?? '') : ''
        // Properties and markup are not "writing"; words are what is left.
        const words = text.replace(/^---[\s\S]*?\n---/, '').match(/[\p{L}\p{N}]+/gu)?.length ?? 0
        days.push({
          date,
          key: date.format('YYYY-MM-DD'),
          outside: date.month() !== month.month(),
          note,
          dots: note ? Math.min(5, Math.max(1, Math.ceil(words / wordsPerDot))) : 0,
          openTasks: /^\s*(?:[-*+]|\d+[.)])\s+\[ \]/m.test(text),
        })
      }
      // A week belongs to the year and number of its Thursday.
      const thursday = days.find((day) => day.date.isoWeekday() === 4)!.date
      rows.push({ week: thursday, note: notes.find('weekly', thursday), days })
    }
    return rows
  })

  const activeDay = $derived(active.current ? notes.dateOf('daily', active.current)?.format('YYYY-MM-DD') : undefined)
  const todayKey = $derived(today.format('YYYY-MM-DD'))
  const headers = $derived(settings.current.sundayFirst ? ['вс', ...WEEKDAYS.slice(0, 6)] : WEEKDAYS)

  const shift = (months: number) => (month = month.clone().add(months, 'month'))

  onMount(() => {
    // The highlighted day must follow the clock past midnight.
    const timer = setInterval(() => {
      if (!moment().isSame(today, 'day')) today = moment().startOf('day')
    }, 60_000)
    // Other notes change all the time while typing; only daily notes matter here, and the month follows
    // once the typing stops (a daily note is saved at every pause in it).
    const soon = whenQuiet(() => written++)
    const off = app.metadata.on('changed', (path) => {
      if (notes.dateOf('daily', path)) soon()
    })
    return () => {
      clearInterval(timer)
      soon.cancel()
      off()
    }
  })
</script>

<div class="calendar">
  <div class="head">
    <div class="title">
      <button title="Заметка месяца" onclick={() => notes.open('monthly', month)}>{MONTHS[month.month()]}</button>
      <button class="year" title="Заметка года" onclick={() => notes.open('yearly', month)}>{month.year()}</button>
    </div>
    <button class="nav" aria-label="Предыдущий месяц" onclick={() => shift(-1)}>‹</button>
    <button class="today" onclick={() => (month = moment().startOf('month'))}>Сегодня</button>
    <button class="nav" aria-label="Следующий месяц" onclick={() => shift(1)}>›</button>
  </div>

  <div class="grid" class:numbered={settings.current.weekNumbers} role="grid">
    {#if settings.current.weekNumbers}<span class="label">н</span>{/if}
    {#each headers as name (name)}<span class="label">{name}</span>{/each}

    {#each weeks as row (row.week.format('GGGG-WW'))}
      {#if settings.current.weekNumbers}
        <button class="week" class:has-note={!!row.note} title="Заметка недели {row.week.format('W')}" onclick={() => notes.open('weekly', row.week)}>
          {row.week.format('W')}
        </button>
      {/if}
      {#each row.days as day (day.key)}
        <button
          class="day"
          class:outside={day.outside}
          class:today={day.key === todayKey}
          class:active={day.key === activeDay}
          title={day.date.format('dddd, D MMMM YYYY')}
          data-date={day.key}
          onclick={() => notes.open('daily', day.date)}
        >
          {day.date.date()}
          <span class="dots">
            {#each { length: day.dots } as _, i (i)}<i></i>{/each}
            {#if day.openTasks}<i class="hollow"></i>{/if}
          </span>
        </button>
      {/each}
    {/each}
  </div>
</div>

<style>
  .calendar {
    padding: 8px 10px 10px;
    user-select: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 6px;
  }

  .title {
    flex: 1;
    font-size: 18px;
    font-weight: 600;
  }

  .title button {
    padding: 0 2px;
    border-radius: var(--radius-s);
  }

  .title button:hover {
    background: var(--bg-hover);
  }

  .year {
    color: var(--accent);
  }

  .nav,
  .today {
    padding: 2px 7px;
    border-radius: var(--radius-m);
    color: var(--text-muted);
  }

  .nav {
    font-size: 18px;
    line-height: 1;
  }

  .today {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .nav:hover,
  .today:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
  }

  .grid.numbered {
    grid-template-columns: 26px repeat(7, 1fr);
  }

  .label {
    padding: 3px 0;
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-align: center;
    text-transform: uppercase;
  }

  .day,
  .week {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 0 3px;
    border-radius: var(--radius-m);
    font-size: 13.5px;
    line-height: 1.2;
  }

  .week {
    justify-content: flex-start;
    color: var(--text-faint);
    font-size: 11px;
    padding-top: 6px;
  }

  .week.has-note {
    color: var(--accent);
    font-weight: 600;
  }

  .day:hover,
  .week:hover {
    background: var(--bg-hover);
  }

  .day.outside {
    color: var(--text-faint);
  }

  .day.active {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .day.today {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 700;
  }

  .dots {
    display: flex;
    gap: 2px;
    height: 5px;
    margin-top: 2px;
  }

  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.65;
  }

  .dots i.hollow {
    background: none;
    box-shadow: inset 0 0 0 1px currentColor;
  }
</style>
