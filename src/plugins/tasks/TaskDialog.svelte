<script lang="ts">
  import { onMount } from 'svelte'
  import { addDays, fromIso, iso, parseDateSpec, today } from './dates'
  import { NO_PRIORITY, PRIORITIES, type TaskFields } from './task'

  let {
    task,
    title,
    onsave,
    onclose,
  }: { task: TaskFields; title: string; onsave: (task: TaskFields) => void; onclose: () => void } = $props()

  /** The dates of a task, in the order of the form: three that plan it, three that record what happened. */
  const PLANNED = [
    ['due', 'Срок', '📅'],
    ['scheduled', 'Запланировано', '⏳'],
    ['start', 'Начало', '🛫'],
  ] as const
  const RECORDED = [
    ['created', 'Создана', '➕'],
    ['done', 'Выполнена (x)', '✅'],
    ['cancelled', 'Отменена (-)', '❌'],
  ] as const
  type DateKey = (typeof PLANNED)[number][0] | (typeof RECORDED)[number][0]
  const STATUSES: [symbol: string, label: string][] = [
    [' ', 'К выполнению [ ]'],
    ['/', 'В работе [/]'],
    ['x', 'Выполнена [x]'],
    ['-', 'Отменена [-]'],
  ]
  // The form shows priorities from the lowest up, as Obsidian Tasks does.
  const LEVELS = [5, 4, NO_PRIORITY, 2, 1, 0]
  const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, вс: 0, пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6 }

  let dialog: HTMLDialogElement
  // svelte-ignore state_referenced_locally (the dialog edits a copy of the task it was opened with)
  const form = $state({
    ...task,
    status: task.status.toLowerCase() === 'x' ? 'x' : task.status,
    // The browser's date-and-time field wants `2026-10-09T14:30`.
    reminder: task.reminder?.includes('-') ? task.reminder.replace(' ', 'T') : '',
    reminderTime: task.reminder && !task.reminder.includes('-') ? task.reminder : '',
    // The id of the task and the ids it waits for, kept among the fields this app does not use otherwise.
    id: /🆔️?\s*([\w-]+)/u.exec(task.extra ?? '')?.[1] ?? '',
    dependsOn: /⛔️?\s*([\w,-]+)/u.exec(task.extra ?? '')?.[1] ?? '',
  })
  /** What is typed in the words field of each date, until it is understood. */
  const words = $state<Record<string, string>>({})
  let futureOnly = $state(true)

  /**
   * A date from a few typed letters: `tm`, `завтра`, `пн`, `mon`, `+3d`, `in 2 weeks`,
   * `12.10`, `2026-10-12`. A weekday means the coming one, or the one of this week
   * when dates in the past are allowed.
   */
  function understand(text: string): string | null {
    const spec = text.trim().toLowerCase()
    if (!spec) return null
    if (spec === 'td') return today()
    if (spec === 'tm') return addDays(today(), 1)
    if (spec === 'yd') return addDays(today(), -1)
    const weekday = WEEKDAYS[spec.slice(0, spec.charCodeAt(0) > 127 ? 2 : 3)]
    if (weekday !== undefined && Object.hasOwn(WEEKDAYS, spec.slice(0, spec.charCodeAt(0) > 127 ? 2 : 3))) {
      const ahead = (weekday - fromIso(today()).getDay() + 7) % 7
      return addDays(today(), ahead === 0 && futureOnly ? 7 : !futureOnly && ahead > 3 ? ahead - 7 : ahead)
    }
    const shift = /^\+?(\d+)\s*([dwmднм])/.exec(spec)
    if (shift) return addDays(today(), Number(shift[1]) * ('wн'.includes(shift[2]) ? 7 : 'mм'.includes(shift[2]) ? 30 : 1))
    const dotted = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(spec)
    if (dotted) {
      const year = dotted[3] ? Number(dotted[3].length === 2 ? `20${dotted[3]}` : dotted[3]) : fromIso(today()).getFullYear()
      const date = iso(new Date(year, Number(dotted[2]) - 1, Number(dotted[1])))
      // Without a year, a day that has passed means next year's.
      return !dotted[3] && futureOnly && date < today() ? iso(new Date(year + 1, Number(dotted[2]) - 1, Number(dotted[1]))) : date
    }
    return parseDateSpec(spec)?.[0] ?? null
  }

  function typed(key: DateKey) {
    const date = understand(words[key] ?? '')
    if (!date) return
    form[key] = date
    words[key] = ''
  }

  function save(event: SubmitEvent) {
    event.preventDefault()
    const description = form.description.replace(/\s*\n\s*/g, ' ').trim()
    if (!description) return
    for (const [key] of [...PLANNED, ...RECORDED]) typed(key)
    const { reminderTime, id, dependsOn, ...fields } = form
    const other = (task.extra ?? '').replace(/[🆔⛔]️?\s*[\w,-]+/gu, '').trim()
    const extra = [other, id.trim() && `🆔 ${id.trim()}`, dependsOn.trim() && `⛔ ${dependsOn.replace(/\s+/g, '')}`].filter(Boolean).join(' ')
    onsave({
      ...fields,
      description,
      priority: Number(form.priority),
      due: form.due || undefined,
      scheduled: form.scheduled || undefined,
      start: form.start || undefined,
      created: form.created || undefined,
      done: form.done || undefined,
      cancelled: form.cancelled || undefined,
      recurrence: form.recurrence?.trim() || undefined,
      reminder: form.reminder.replace('T', ' ') || reminderTime || undefined,
      extra: extra || undefined,
    })
    dialog.close()
  }

  onMount(() => dialog.showModal())
</script>

{#snippet dateRow(key: DateKey, label: string, emoji: string)}
  <div class="row">
    <label for="task-{key}">{label}</label>
    <input
      id="task-{key}"
      class="words"
      placeholder="«пн» или «tm», затем пробел"
      bind:value={words[key]}
      onblur={() => typed(key)}
      onkeydown={(event) => {
        if (event.key !== ' ' || !understand(words[key] ?? '')) return
        event.preventDefault()
        typed(key)
      }}
    />
    <span class="emoji" aria-hidden="true">{emoji}</span>
    <input type="date" aria-label={label} bind:value={form[key]} />
  </div>
{/snippet}

<dialog bind:this={dialog} {onclose} onclick={(event) => event.target === dialog && dialog.close()}>
  <form onsubmit={save}>
    <h2>{title}</h2>
    <label class="block" for="task-description">Описание</label>
    <!-- svelte-ignore a11y_autofocus (the dialog exists to type the task) -->
    <textarea
      id="task-description"
      rows="2"
      placeholder="Что нужно сделать"
      bind:value={form.description}
      autofocus
      onkeydown={(event) => {
        // A task is one line: Enter applies the form instead of breaking it.
        if (event.key !== 'Enter' || event.shiftKey) return
        event.preventDefault()
        event.currentTarget.form?.requestSubmit()
      }}
    ></textarea>

    <div class="row top">
      <span class="name">Приоритет</span>
      <div class="levels">
        {#each LEVELS as level (level)}
          <label class="level"><input type="radio" name="priority" value={level} bind:group={form.priority} /> {PRIORITIES[level].label} {PRIORITIES[level].emoji}</label>
        {/each}
      </div>
    </div>

    <hr />
    <div class="row">
      <label for="task-recurs">Повтор</label>
      <input id="task-recurs" class="words" placeholder="например: every day when done" list="task-recurrence" bind:value={form.recurrence} />
      <span class="emoji" aria-hidden="true">🔁</span>
      <span class="note">{form.recurrence?.trim() ? form.recurrence.trim() : 'не повторяется'}</span>
    </div>
    {#each PLANNED as [key, label, emoji] (key)}
      {@render dateRow(key, label, emoji)}
    {/each}
    <div class="row">
      <label for="task-reminder">Напомнить</label>
      <input id="task-reminder" class="words" type="datetime-local" bind:value={form.reminder} />
      <span class="emoji" aria-hidden="true">⏰</span>
      <input class="time" type="time" aria-label="Время напоминания в день срока" bind:value={form.reminderTime} />
    </div>
    <label class="check"><span class="name">Только будущие даты:</span> <input type="checkbox" bind:checked={futureOnly} /></label>
    <datalist id="task-recurrence">
      <option value="every day"></option>
      <option value="every weekday"></option>
      <option value="every week"></option>
      <option value="every 2 weeks"></option>
      <option value="every month"></option>
      <option value="every year"></option>
      <option value="every week when done"></option>
    </datalist>

    <hr />
    <div class="row">
      <label for="task-id">Номер задачи</label>
      <input id="task-id" class="grow" placeholder="🆔 по нему на эту задачу ссылаются другие" bind:value={form.id} />
    </div>
    <div class="row">
      <label for="task-depends">Ждёт задач</label>
      <input id="task-depends" class="grow" placeholder="⛔ номера задач через запятую, которые должны быть сделаны раньше" bind:value={form.dependsOn} />
    </div>

    <hr />
    <div class="row">
      <label for="task-status">Статус</label>
      <select id="task-status" class="words" bind:value={form.status}>
        {#each STATUSES as [symbol, label] (symbol)}
          <option value={symbol}>{label}</option>
        {/each}
        {#if !STATUSES.some(([symbol]) => symbol === form.status)}<option value={form.status}>[{form.status}]</option>{/if}
      </select>
    </div>
    {#each RECORDED as [key, label, emoji] (key)}
      {@render dateRow(key, label, emoji)}
    {/each}

    <div class="actions">
      <button class="primary" disabled={!form.description.trim()}>Применить</button>
      <button type="button" onclick={() => dialog.close()}>Отмена</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 16px 18px 18px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-alt);
    color: var(--text);
    box-shadow: var(--shadow);
    font-size: 14px;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }

  h2 {
    margin: 0 0 10px;
    font-size: 15px;
  }

  .block {
    display: block;
    padding-bottom: 6px;
  }

  textarea,
  input:not([type='radio']):not([type='checkbox']),
  select {
    min-width: 0;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: inherit;
    font: inherit;
  }

  textarea {
    display: block;
    width: 100%;
    resize: vertical;
  }

  textarea:focus,
  input:focus,
  select:focus {
    border-color: var(--accent);
    outline: none;
  }

  input::placeholder,
  textarea::placeholder {
    color: var(--text-faint);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
  }

  .row.top {
    align-items: flex-start;
    padding-top: 10px;
  }

  .row > label,
  .name {
    flex: 0 0 110px;
  }

  .words {
    flex: 0 0 200px;
  }

  .grow {
    flex: 1;
  }

  .emoji {
    flex: 0 0 20px;
    text-align: center;
  }

  .note {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 12.5px;
    font-style: italic;
  }

  .levels {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px 8px;
  }

  .level {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  input[type='radio'] {
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--accent);
  }

  .level:has(input:checked) {
    font-weight: 700;
  }

  .check {
    display: flex;
    align-items: center;
    padding: 4px 0;
  }

  .check .name {
    flex: 0 0 auto;
    padding-right: 10px;
  }

  hr {
    margin: 8px 0;
    border: none;
    border-top: 1px solid var(--border);
  }

  .actions {
    display: flex;
    gap: 8px;
    padding-top: 14px;
  }

  button {
    padding: 7px 22px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-hover);
  }

  button.primary {
    flex: 1;
    border-color: transparent;
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  button:disabled {
    opacity: 0.5;
  }
</style>
