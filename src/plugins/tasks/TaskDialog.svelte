<script lang="ts">
  import { onMount } from 'svelte'
  import { addDays, fromIso, iso, parseDateSpec, today } from './dates'
  import { dependsOn, isOpen, newTaskId, NO_PRIORITY, PRIORITIES, taskId, withLinks, type Task, type TaskFields } from './task'

  let {
    task,
    title,
    tasks = [],
    onsave,
    onclose,
  }: {
    task: TaskFields
    title: string
    /** Every task of the vault: the ones this task can be put before or after. */
    tasks?: Task[]
    /** `others` are tasks whose own lines change with this one: they get an id, or start waiting for this task. */
    onsave: (task: TaskFields, others: { task: Task; extra: string | undefined }[]) => void
    onclose: () => void
  } = $props()

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
    id: taskId(task),
  })
  // svelte-ignore state_referenced_locally
  const self = 'path' in task ? (task as Task) : null
  // svelte-ignore state_referenced_locally
  const others = tasks.filter((other) => !self || other.path !== self.path || other.line !== self.line)
  // svelte-ignore state_referenced_locally
  const waited = dependsOn(task)
  /** Tasks to be done before this one (it waits for them, ⛔) and after it (they wait for it). */
  // A repeating task leaves its done copies behind with the same id: one task stands for an id, an open one first.
  let after = $state.raw(
    waited.flatMap((id) => {
      const named = others.filter((other) => taskId(other) === id)
      return named.length ? [named.find(isOpen) ?? named[0]] : []
    }),
  )
  // svelte-ignore state_referenced_locally
  let before = $state.raw(form.id ? others.filter((other) => dependsOn(other).includes(form.id)) : [])
  const wasBefore = before
  /** Ids this task waits for that belong to no task found: kept as they are. */
  const unknown = waited.filter((id) => !after.some((other) => taskId(other) === id))
  const search = $state({ after: '', before: '' })

  const same = (a: Task, b: Task) => a.path === b.path && a.line === b.line
  function found(kind: 'after' | 'before'): Task[] {
    const query = search[kind].trim().toLowerCase()
    if (!query) return []
    const chosen = kind === 'after' ? after : before
    return others.filter((other) => isOpen(other) && other.description.toLowerCase().includes(query) && !chosen.some((one) => same(one, other))).slice(0, 8)
  }
  function choose(kind: 'after' | 'before', other: Task) {
    if (kind === 'after') after = [...after, other]
    else before = [...before, other]
    search[kind] = ''
  }
  function drop(kind: 'after' | 'before', other: Task) {
    if (kind === 'after') after = after.filter((one) => !same(one, other))
    else before = before.filter((one) => !same(one, other))
  }
  const where = (other: Task) => other.path.replace(/^.*\//, '').replace(/\.md$/, '')
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
    const { reminderTime, id: typedId, ...fields } = form
    // Links between tasks are kept the way Obsidian Tasks keeps them: the earlier task has an id (🆔),
    // the later one names it after ⛔. A task that is pointed at and has no id yet gets one.
    const taken = new Set(tasks.map(taskId).filter(Boolean))
    const changed = new Map<Task, { id: string; waits: string[] }>()
    const edit = (other: Task) => changed.get(other) ?? changed.set(other, { id: taskId(other), waits: dependsOn(other) }).get(other)!
    const fresh = () => {
      const made = newTaskId(taken)
      taken.add(made)
      return made
    }
    const id = typedId.trim() || (before.length ? fresh() : '')
    const waits = [...unknown]
    for (const other of after) {
      const link = edit(other)
      link.id ||= fresh()
      waits.push(link.id)
    }
    for (const other of before) {
      const link = edit(other)
      if (!link.waits.includes(id)) link.waits.push(id)
    }
    for (const other of wasBefore) {
      if (!before.some((one) => same(one, other))) edit(other).waits = edit(other).waits.filter((one) => one !== taskId(task))
    }
    // A renamed id is followed by the tasks that waited for the old one.
    if (taskId(task) && id !== taskId(task)) for (const other of before) edit(other).waits = edit(other).waits.filter((one) => one !== taskId(task))
    const rewritten = [...changed]
      .filter(([other, link]) => link.id !== taskId(other) || link.waits.join() !== dependsOn(other).join())
      .map(([other, link]) => ({ task: other, extra: withLinks(other, link.id, link.waits) }))
    const extra = withLinks(task, id, [...new Set(waits)])
    onsave(
      {
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
        extra,
      },
      rewritten,
    )
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

{#snippet links(kind: 'after' | 'before', label: string, placeholder: string, chosen: Task[])}
  <div class="row top links">
    <label for="task-{kind}">{label}</label>
    <div class="grow">
      <input
        id="task-{kind}"
        class="search"
        {placeholder}
        autocomplete="off"
        bind:value={search[kind]}
        onkeydown={(event) => {
          if (event.key !== 'Enter') return
          // Enter takes the first task found, and must not apply the whole form.
          event.preventDefault()
          const first = found(kind)[0]
          if (first) choose(kind, first)
        }}
      />
      {#if search[kind].trim()}
        <div class="found">
          {#each found(kind) as other (other.path + other.line)}
            <button type="button" class="found-task" onclick={() => choose(kind, other)}>
              <span class="found-text">{other.description}</span>
              <span class="found-where">{where(other)}</span>
            </button>
          {:else}
            <div class="found-none">Задач не найдено</div>
          {/each}
        </div>
      {/if}
      {#each chosen as other (other.path + other.line)}
        <div class="linked">
          <span class="found-text">{other.description}</span>
          <span class="found-where">{where(other)}</span>
          <button type="button" class="unlink" aria-label="Убрать связь" title="Убрать связь" onclick={() => drop(kind, other)}>×</button>
        </div>
      {/each}
    </div>
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
    {@render links('before', 'Перед этой', 'Найти задачу, которая ждёт эту…', before)}
    {@render links('after', 'После этой', 'Найти задачу, которую эта ждёт…', after)}

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
    border-radius: var(--radius-xl);
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
    border-radius: var(--radius-m);
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

  .links .search {
    width: 100%;
  }

  .links > label {
    padding-top: 6px;
  }

  .found {
    margin-top: 4px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-l);
    background: var(--bg);
  }

  .found-task,
  .linked {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 5px 9px;
    text-align: left;
  }

  .found-task {
    border: none;
    border-radius: 0;
    background: none;
    font-weight: inherit;
  }

  .found-task:hover {
    background: var(--bg-hover);
  }

  .linked {
    margin-top: 4px;
    border-radius: var(--radius-l);
    background: var(--bg-hover);
  }

  .found-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .found-where,
  .found-none {
    color: var(--text-faint);
    font-size: 12.5px;
  }

  .found-none {
    padding: 6px 9px;
  }

  .unlink {
    padding: 0 6px;
    border: none;
    background: none;
    color: var(--text-muted);
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
    border-radius: var(--radius-m);
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
