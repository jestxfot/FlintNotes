<script lang="ts">
  import { onMount } from 'svelte'
  import { path as paths, renderInline, watch, type App } from '../../api'
  import { drawCalendar, type CalendarState } from './calendar'
  import { addDays, daysBetween, parseDateSpec, shortDate, today } from './dates'
  import type { TaskStore } from './store'
  import { formatTaskLine, isDone, isOpen, NO_PRIORITY, parseTaskLine, PRIORITIES, type Task, type TaskFields } from './task'

  let {
    app,
    store,
    inbox,
    onedit,
  }: {
    app: App
    store: TaskStore
    /** The note new tasks go to when the list shown is not a note itself. */
    inbox: () => string
    /** Opens the full form of a task. */
    onedit: (task: Task) => void
  } = $props()

  type List = { kind: 'smart'; id: Smart } | { kind: 'note'; path: string } | { kind: 'tag'; tag: string }
  type Smart = 'today' | 'tomorrow' | 'week' | 'inbox' | 'all' | 'done'
  const SMART: { id: Smart; title: string; icon: string }[] = [
    { id: 'today', title: 'Сегодня', icon: 'sun' },
    { id: 'tomorrow', title: 'Завтра', icon: 'sunrise' },
    { id: 'week', title: 'Следующие 7 дней', icon: 'calendar-days' },
    { id: 'inbox', title: 'Без срока', icon: 'inbox' },
    { id: 'all', title: 'Все задачи', icon: 'list-checks' },
    { id: 'done', title: 'Выполненные', icon: 'circle-check-big' },
  ]
  const SORTS = [
    ['date', 'по сроку'],
    ['priority', 'по приоритету'],
    ['note', 'по заметкам'],
  ] as const

  // svelte-ignore state_referenced_locally (the view is made for one app and one store)
  const all = watch(store, ['change'], () => store.all())
  // svelte-ignore state_referenced_locally
  const saved = app.state.get<{ list?: List; sort?: string; mode?: string; folded?: string[] }>('tasks-manager', {})
  let list = $state<List>(saved.list ?? { kind: 'smart', id: 'today' })
  let sort = $state<(typeof SORTS)[number][0]>((saved.sort as 'date') ?? 'date')
  let mode = $state<'list' | 'calendar'>(saved.mode === 'calendar' ? 'calendar' : 'list')
  /** The task whose card is open, by where it is: its text may change under the same place. */
  let selected = $state<{ path: string; line: number } | null>(null)
  let draft = $state('')
  let filter = $state('')
  let now = $state(today())
  const folded = $state(new Set<string>(saved.folded ?? []))

  $effect(() => {
    app.state.set('tasks-manager', { list: $state.snapshot(list), sort, mode, folded: [...folded] })
  })

  /** The day a task is for: its due date, or the day it is planned for. */
  const dayOf = (task: Task) => task.due ?? task.scheduled
  const title = (file: string) => paths.stripExt(paths.basename(file))
  const key = (task: Task) => `${task.path}\n${task.line}`
  const rank = (task: Task) => (task.priority === NO_PRIORITY ? 3.5 : task.priority)

  const open = $derived(all.current.filter(isOpen))
  const inSmart: Record<Smart, (task: Task) => boolean> = {
    today: (task) => isOpen(task) && !!dayOf(task) && dayOf(task)! <= now,
    tomorrow: (task) => isOpen(task) && dayOf(task) === addDays(now, 1),
    week: (task) => isOpen(task) && !!dayOf(task) && dayOf(task)! <= addDays(now, 7),
    inbox: (task) => isOpen(task) && !dayOf(task) && !task.start,
    all: isOpen,
    done: isDone,
  }
  const counts = $derived(Object.fromEntries(SMART.map(({ id }) => [id, id === 'done' ? 0 : open.filter(inSmart[id]).length])) as Record<Smart, number>)
  /** Notes that hold open tasks, the fullest first: they are the "lists" of this manager. */
  const notes = $derived.by(() => {
    const byNote = new Map<string, number>()
    for (const task of open) byNote.set(task.path, (byNote.get(task.path) ?? 0) + 1)
    return [...byNote].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  })
  const tags = $derived.by(() => {
    const byTag = new Map<string, number>()
    for (const task of open) for (const tag of new Set(task.tags)) byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
    return [...byTag].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  })

  const titleOf = (one: List) => (one.kind === 'smart' ? SMART.find((smart) => smart.id === one.id)!.title : one.kind === 'note' ? title(one.path) : `#${one.tag}`)
  const listTitle = $derived(titleOf(list))
  const shown = $derived.by(() => {
    const current = list
    const of = current.kind === 'smart' ? all.current.filter(inSmart[current.id]) : current.kind === 'note' ? open.filter((task) => task.path === current.path) : open.filter((task) => task.tags.includes(current.tag))
    const words = filter.trim().toLowerCase()
    return words ? of.filter((task) => task.description.toLowerCase().includes(words)) : of
  })

  interface Group {
    id: string
    title: string
    late?: boolean
    tasks: Task[]
  }
  const dayTitle = (day: string) => {
    const away = daysBetween(now, day)
    const name = new Date(`${day}T00:00`).toLocaleDateString('ru', { weekday: 'long' })
    return away === 0 ? 'Сегодня' : away === 1 ? 'Завтра' : away === -1 ? 'Вчера' : `${shortDate(day)}, ${name}`
  }
  const groups = $derived.by((): Group[] => {
    const order = (a: Task, b: Task) => rank(a) - rank(b) || (dayOf(a) ?? '9').localeCompare(dayOf(b) ?? '9') || a.path.localeCompare(b.path) || a.line - b.line
    const made = new Map<string, Group>()
    const put = (id: string, name: string, task: Task, late = false) => {
      const group = made.get(id) ?? made.set(id, { id, title: name, late, tasks: [] }).get(id)!
      group.tasks.push(task)
    }
    if (list.kind === 'smart' && list.id === 'done') {
      // What was done, the latest first, a day at a time.
      for (const task of [...shown].sort((a, b) => (b.done ?? '').localeCompare(a.done ?? '')).slice(0, 300)) put(`d${task.done ?? ''}`, task.done ? dayTitle(task.done) : 'Без даты выполнения', task)
      return [...made.values()]
    }
    for (const task of shown) {
      const day = dayOf(task)
      if (sort === 'priority') put(`p${task.priority}`, task.priority === NO_PRIORITY ? 'Обычный приоритет' : `${PRIORITIES[task.priority].label} приоритет`, task)
      else if (sort === 'note') put(`n${task.path}`, title(task.path), task)
      else if (!day) put('z', 'Без срока', task)
      else if (day < now) put('a', 'Просрочено', task, true)
      else if (daysBetween(now, day) <= 7) put(`b${day}`, dayTitle(day), task)
      else put('c', 'Позже', task)
    }
    const result = [...made.values()].sort((a, b) => (sort === 'priority' ? Number(a.id.slice(1) === '3' ? 3.5 : a.id.slice(1)) - Number(b.id.slice(1) === '3' ? 3.5 : b.id.slice(1)) : a.id.localeCompare(b.id)))
    for (const group of result) group.tasks.sort(order)
    return result
  })

  const current = $derived(selected ? (all.current.find((task) => task.path === selected!.path && task.line === selected!.line) ?? null) : null)

  // ---- changing tasks: every change is a change of the task's line in its note

  function update(task: Task, changes: Partial<TaskFields>) {
    void store.edit(task, (raw) => {
      const parsed = parseTaskLine(raw)
      if (!parsed) return [raw]
      const { prefix, tags: _tags, ...fields } = parsed
      return [formatTaskLine({ ...fields, ...changes }, prefix)]
    })
  }

  function remove(task: Task) {
    if (!confirm(`Удалить задачу «${task.description}» из заметки?`)) return
    selected = null
    void store.edit(task, () => [])
  }

  /**
   * A task from one line of typing. Words at its end may set the day (`завтра`,
   * `tm`, `+3d`, `12.10`, `пн`) and the priority (`!1` high, `!2` medium, `!3` low);
   * the rest is what is to be done.
   */
  function parseDraft(text: string): TaskFields {
    const words = text.trim().split(/\s+/)
    const fields: TaskFields = { status: ' ', description: '', priority: NO_PRIORITY }
    const WEEKDAYS: Record<string, number> = { вс: 0, пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6 }
    const day = (word: string): string | null => {
      const lower = word.toLowerCase()
      if (lower === 'td' || lower === 'сегодня') return now
      if (lower === 'tm' || lower === 'завтра') return addDays(now, 1)
      if (lower === 'послезавтра') return addDays(now, 2)
      if (Object.hasOwn(WEEKDAYS, lower)) return addDays(now, (WEEKDAYS[lower] - new Date(`${now}T00:00`).getDay() + 7) % 7 || 7)
      const shift = /^\+(\d+)([dwднм]?)$/.exec(lower)
      if (shift) return addDays(now, Number(shift[1]) * ('wн'.includes(shift[2]) && shift[2] ? 7 : shift[2] === 'м' ? 30 : 1))
      const dotted = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(lower)
      if (dotted) {
        const year = Number(dotted[3] ?? now.slice(0, 4))
        const made = `${year}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`
        return !dotted[3] && made < now ? `${year + 1}${made.slice(4)}` : made
      }
      return /^\d{4}-\d{2}-\d{2}$/.test(lower) ? lower : (parseDateSpec(lower)?.[0] ?? null)
    }
    // From the end: what says "when" and "how important" is taken off, the rest is the task.
    while (words.length > 1) {
      const last = words[words.length - 1]
      const priority = /^!([1-3])$/.exec(last)
      const found = priority ? null : day(last)
      if (priority && fields.priority === NO_PRIORITY) fields.priority = [1, 2, 4][Number(priority[1]) - 1]
      else if (found && !fields.due) fields.due = found
      else break
      words.pop()
    }
    fields.description = words.join(' ')
    return fields
  }

  async function add() {
    const text = draft.trim()
    if (!text) return
    const fields = parseDraft(text)
    // The list being looked at says what the new task is: for today, with this tag, in this note.
    if (list.kind === 'smart' && !fields.due) fields.due = list.id === 'today' ? now : list.id === 'tomorrow' ? addDays(now, 1) : undefined
    if (list.kind === 'tag' && !fields.description.includes(`#${list.tag}`)) fields.description += ` #${list.tag}`
    const target = list.kind === 'note' ? list.path : inbox()
    draft = ''
    try {
      await app.workspace.flushAll()
      const before = (await app.vault.readOptional(target)) ?? ''
      const line = formatTaskLine({ ...fields, created: undefined })
      await app.vault.write(target, `${before}${before && !before.endsWith('\n') ? '\n' : ''}${line}\n`)
    } catch (err) {
      draft = text
      app.notice(`Не удалось добавить задачу: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ---- drawing

  function inline(node: HTMLElement, task: Task) {
    const draw = (one: Task) => node.replaceChildren(renderInline(app, one.description, one.path))
    draw(task)
    return { update: draw }
  }
  function icon(node: HTMLElement, name: string) {
    node.append(app.icons.draw(name))
  }
  function noteIcon(node: HTMLElement, file: string) {
    const look = app.icons.look('file', file)
    node.append(app.icons.draw(look?.icon ?? 'file-text', look?.color))
  }
  const calendarState: CalendarState = { open: new Set(), redraw: () => (redraws += 1) }
  let redraws = $state(0)
  function calendar(node: HTMLElement, tasks: Task[]) {
    const draw = (shownTasks: Task[]) => drawCalendar(app, store, node, shownTasks, 'happens', calendarState, onedit)
    draw(tasks)
    return { update: draw }
  }
  const level = (task: Task) => (task.priority <= 1 ? 'high' : task.priority === 2 ? 'medium' : task.priority >= 4 ? 'low' : 'none')
  const isSame = (a: List, b: List) => JSON.stringify(a) === JSON.stringify(b)
  const dateClass = (task: Task) => (dayOf(task) && dayOf(task)! < now && isOpen(task) ? 'late' : dayOf(task) === now ? 'now' : '')

  onMount(() => {
    // The day changes while the tab stays open.
    const timer = setInterval(() => (now = today()), 60_000)
    return () => clearInterval(timer)
  })
</script>

{#snippet side(one: List, name: string, count: number, glyph?: string, file?: string)}
  <button class="side-item" class:active={isSame(list, one)} onclick={() => ((list = one), (selected = null))}>
    {#if file}<span class="glyph" use:noteIcon={file}></span>{:else if glyph}<span class="glyph" use:icon={glyph}></span>{:else}<span class="glyph hash">#</span>{/if}
    <span class="side-name">{name}</span>
    {#if count}<span class="side-count">{count}</span>{/if}
  </button>
{/snippet}

<div class="manager" class:with-card={!!current}>
  <nav>
    {#each SMART as one (one.id)}
      {@render side({ kind: 'smart', id: one.id }, one.title, counts[one.id], one.icon)}
    {/each}
    {#if notes.length}
      <div class="side-title">Списки</div>
      {#each notes as [file, count] (file)}
        {@render side({ kind: 'note', path: file }, title(file), count, undefined, file)}
      {/each}
    {/if}
    {#if tags.length}
      <div class="side-title">Теги</div>
      {#each tags as [tag, count] (tag)}
        {@render side({ kind: 'tag', tag }, tag, count)}
      {/each}
    {/if}
  </nav>

  <section class="tasks">
    <header>
      <h2>{listTitle}</h2>
      <span class="total">{shown.length}</span>
      <span class="grow"></span>
      <input class="filter" type="search" placeholder="Фильтр…" aria-label="Фильтр задач" bind:value={filter} />
      {#if !(list.kind === 'smart' && list.id === 'done')}
        <select aria-label="Порядок" bind:value={sort}>
          {#each SORTS as [id, name] (id)}<option value={id}>{name}</option>{/each}
        </select>
      {/if}
      <div class="modes">
        <button class:on={mode === 'list'} title="Списком" aria-label="Списком" onclick={() => (mode = 'list')}><span use:icon={'list'}></span></button>
        <button class:on={mode === 'calendar'} title="Календарём" aria-label="Календарём" onclick={() => (mode = 'calendar')}><span use:icon={'calendar'}></span></button>
      </div>
    </header>

    {#if !(list.kind === 'smart' && list.id === 'done')}
      <form
        class="add"
        onsubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <span class="plus">+</span>
        <input
          placeholder={`Добавить задачу в «${listTitle}» — Enter. В конце можно: завтра, пн, +3d, 12.10, !1`}
          aria-label="Новая задача"
          bind:value={draft}
        />
      </form>
    {/if}

    {#if mode === 'calendar'}
      {#key redraws}
        <div class="calendar" use:calendar={shown}></div>
      {/key}
    {:else}
      <div class="list">
        {#each groups as group (group.id)}
          <button
            class="group"
            class:late={group.late}
            onclick={() => {
              if (!folded.delete(group.id)) folded.add(group.id)
            }}
          >
            <span class="fold" class:closed={folded.has(group.id)}>›</span>
            {group.title}
            <span class="group-count">{group.tasks.length}</span>
          </button>
          {#if !folded.has(group.id)}
            {#each group.tasks as task (key(task))}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (the row's own controls are reachable from the keyboard) -->
              <div class="task" class:selected={current === task} class:done={!isOpen(task)} onclick={() => (selected = { path: task.path, line: task.line })} ondblclick={() => onedit(task)}>
                <input
                  type="checkbox"
                  class="tick {level(task)}"
                  checked={!isOpen(task)}
                  aria-label="Выполнено"
                  onclick={(event) => event.stopPropagation()}
                  onchange={() => void store.toggle(task)}
                />
                <span class="what" use:inline={task}></span>
                {#if task.recurrence}<span class="chip" title={task.recurrence}>🔁</span>{/if}
                {#if task.reminder}<span class="chip" title={`Напоминание: ${task.reminder}`}>⏰</span>{/if}
                {#if list.kind !== 'note' && sort !== 'note'}<span class="where" title={task.path}>{title(task.path)}</span>{/if}
                {#if dayOf(task)}<span class="date {dateClass(task)}">{shortDate(dayOf(task)!)}</span>{/if}
              </div>
            {/each}
          {/if}
        {:else}
          <p class="empty">{filter.trim() ? 'Ничего не найдено' : list.kind === 'smart' && list.id === 'today' ? 'На сегодня задач нет' : 'Здесь пусто'}</p>
        {/each}
      </div>
    {/if}
  </section>

  {#if current}
    {@const task = current}
    <aside class="card">
      <div class="card-head">
        <input type="checkbox" class="tick {level(task)}" checked={!isOpen(task)} aria-label="Выполнено" onchange={() => void store.toggle(task)} />
        <span class="grow"></span>
        <button title="Все поля задачи" aria-label="Все поля задачи" onclick={() => onedit(task)}><span use:icon={'sliders-horizontal'}></span></button>
        <button title="Удалить задачу" aria-label="Удалить задачу" onclick={() => remove(task)}><span use:icon={'trash-2'}></span></button>
        <button title="Закрыть" aria-label="Закрыть карточку" onclick={() => (selected = null)}><span use:icon={'x'}></span></button>
      </div>
      {#key key(task) + task.raw}
        <textarea
          class="card-title"
          rows="3"
          aria-label="Что нужно сделать"
          value={task.description}
          onchange={(event) => {
            const text = event.currentTarget.value.replace(/\s*\n\s*/g, ' ').trim()
            if (text && text !== task.description) update(task, { description: text })
          }}
          onkeydown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            event.currentTarget.blur()
          }}
        ></textarea>

        <div class="field">
          <span>Приоритет</span>
          <div class="levels">
            {#each [[1, 'Высокий', 'high'], [2, 'Средний', 'medium'], [4, 'Низкий', 'low'], [NO_PRIORITY, 'Нет', 'none']] as const as [value, name, cls] (value)}
              <button class="level {cls}" class:on={task.priority === value || (value === 1 && task.priority === 0) || (value === 4 && task.priority === 5)} onclick={() => update(task, { priority: value })}>{name}</button>
            {/each}
          </div>
        </div>
        <label class="field">
          <span>Срок</span>
          <input type="date" value={task.due ?? ''} onchange={(event) => update(task, { due: event.currentTarget.value || undefined })} />
        </label>
        <div class="quick">
          {#each [['Сегодня', now], ['Завтра', addDays(now, 1)], ['Через неделю', addDays(now, 7)], ['Без срока', '']] as const as [name, value] (name)}
            <button onclick={() => update(task, { due: value || undefined })}>{name}</button>
          {/each}
        </div>
        <label class="field">
          <span>Запланировано</span>
          <input type="date" value={task.scheduled ?? ''} onchange={(event) => update(task, { scheduled: event.currentTarget.value || undefined })} />
        </label>
        <label class="field">
          <span>Напомнить</span>
          <input
            type="datetime-local"
            value={task.reminder?.includes('-') ? task.reminder.replace(' ', 'T') : ''}
            onchange={(event) => update(task, { reminder: event.currentTarget.value.replace('T', ' ') || undefined })}
          />
        </label>
        <label class="field">
          <span>Повтор</span>
          <input list="manager-repeat" placeholder="не повторяется" value={task.recurrence ?? ''} onchange={(event) => update(task, { recurrence: event.currentTarget.value.trim() || undefined })} />
        </label>
        <datalist id="manager-repeat">
          <option value="every day"></option>
          <option value="every weekday"></option>
          <option value="every week"></option>
          <option value="every month"></option>
          <option value="every year"></option>
        </datalist>
      {/key}
      <button class="source" title="Открыть заметку на этой задаче" onclick={() => app.workspace.openFile(task.path, { line: task.line, newTab: true })}>
        <span use:noteIcon={task.path}></span>
        <span class="side-name">{title(task.path)}{task.heading ? ` › ${task.heading}` : ''}</span>
        <span class="go">↗</span>
      </button>
    </aside>
  {/if}
</div>

<style>
  .manager {
    display: grid;
    grid-template-columns: 250px minmax(0, 1fr);
    height: 100%;
    font: 14px/1.4 var(--font-ui);
  }

  .manager.with-card {
    grid-template-columns: 250px minmax(0, 1fr) 340px;
  }

  nav,
  .card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 10px;
    overflow-y: auto;
    background: var(--bg-alt);
  }

  nav {
    border-right: 1px solid var(--border);
  }

  .card {
    gap: 10px;
    padding: 14px 16px;
    border-left: 1px solid var(--border);
  }

  .side-item,
  .source {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 6px 10px;
    border-radius: var(--radius-m);
    text-align: left;
  }

  .side-item:hover,
  .source:hover {
    background: var(--bg-hover);
  }

  .side-item.active {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--text);
    font-weight: 600;
  }

  .glyph {
    display: flex;
    flex: none;
    justify-content: center;
    width: 18px;
    color: var(--text-muted);
    font-size: 16px;
  }

  .glyph.hash {
    font-weight: 600;
  }

  .side-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .side-count,
  .group-count,
  .total {
    color: var(--text-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .side-title {
    padding: 14px 10px 4px;
    color: var(--text-faint);
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .tasks {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 24px 8px;
  }

  header {
    flex-wrap: wrap;
    row-gap: 6px;
  }

  h2 {
    margin: 0;
    overflow: hidden;
    font-size: 20px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grow {
    flex: 1;
  }

  .filter,
  select,
  .field input,
  .card-title {
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--bg);
    color: inherit;
    font: inherit;
    font-size: 13px;
  }

  .filter {
    flex: 0 1 150px;
    min-width: 80px;
  }

  .modes {
    display: flex;
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--bg-hover);
  }

  .modes button {
    display: flex;
    padding: 4px 8px;
    border-radius: var(--radius-s);
    color: var(--text-muted);
    font-size: 15px;
  }

  .modes button.on {
    background: var(--bg);
    color: var(--text);
  }

  .add {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 4px 24px 10px;
    padding: 0 12px;
    border-radius: var(--radius-l);
    background: var(--bg-alt);
  }

  .add:focus-within {
    outline: 1px solid var(--accent);
  }

  .plus {
    color: var(--text-faint);
    font-size: 18px;
  }

  .add input {
    flex: 1;
    min-width: 0;
    padding: 10px 0;
    border: none;
    outline: none;
    background: none;
    color: inherit;
    font: inherit;
  }

  .list,
  .calendar {
    flex: 1;
    min-height: 0;
    padding: 0 16px 24px;
    overflow-y: auto;
  }

  .calendar {
    padding: 0 24px 24px;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 12px 8px 4px;
    color: var(--text-muted);
    font-size: 12.5px;
    font-weight: 600;
    text-align: left;
  }

  .group.late {
    color: var(--color-red);
  }

  .fold {
    display: inline-block;
    width: 10px;
    rotate: 90deg;
    transition: rotate 0.1s;
  }

  .fold.closed {
    rotate: 0deg;
  }

  .task {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border-radius: var(--radius-m);
    cursor: default;
  }

  .task:hover {
    background: var(--bg-alt);
  }

  .task.selected {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .task.done .what {
    color: var(--text-faint);
    text-decoration: line-through;
  }

  .what {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A round box in the colour of the task's priority, as task managers have it. */
  input.tick {
    appearance: none;
    position: relative;
    flex: none;
    width: 18px;
    height: 18px;
    margin: 0;
    border: 2px solid var(--tick, var(--text-faint));
    border-radius: 50%;
    background: color-mix(in srgb, var(--tick, transparent) 12%, transparent);
    cursor: pointer;
  }

  input.tick.high {
    --tick: var(--color-red);
  }

  input.tick.medium {
    --tick: var(--color-orange);
  }

  input.tick.low {
    --tick: var(--color-blue);
  }

  input.tick:checked {
    border-color: var(--text-faint);
    background: var(--text-faint);
  }

  input.tick:checked::after {
    content: '';
    position: absolute;
    top: 1px;
    left: 4px;
    width: 4px;
    height: 8px;
    border: solid var(--bg);
    border-width: 0 2px 2px 0;
    rotate: 45deg;
  }

  .chip {
    flex: none;
    font-size: 12px;
  }

  .where {
    flex: none;
    max-width: 180px;
    overflow: hidden;
    color: var(--text-faint);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .date {
    flex: none;
    color: var(--text-muted);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }

  .date.late {
    color: var(--color-red);
  }

  .date.now {
    color: var(--accent);
  }

  .empty {
    padding: 48px 0;
    color: var(--text-faint);
    text-align: center;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .card-head button {
    display: flex;
    padding: 5px;
    border-radius: var(--radius-s);
    color: var(--text-muted);
    font-size: 16px;
  }

  .card-head button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .card-title {
    width: 100%;
    padding: 8px 10px;
    font-size: 15px;
    font-weight: 600;
    resize: vertical;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .field > span {
    flex: 0 0 110px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .field input {
    flex: 1;
    min-width: 0;
  }

  .levels,
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .quick {
    padding-left: 120px;
  }

  .level,
  .quick button {
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 2em;
    font-size: 12.5px;
  }

  .quick button:hover {
    border-color: var(--accent);
  }

  .level.on {
    border-color: var(--tick, var(--text-muted));
    background: color-mix(in srgb, var(--tick, var(--text-muted)) 20%, transparent);
    font-weight: 600;
  }

  .level.high {
    --tick: var(--color-red);
  }

  .level.medium {
    --tick: var(--color-orange);
  }

  .level.low {
    --tick: var(--color-blue);
  }

  .source {
    margin-top: auto;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .go {
    color: var(--text-faint);
  }

  @container (max-width: 900px) {
    .manager,
    .manager.with-card {
      grid-template-columns: 200px minmax(0, 1fr);
    }
  }
</style>
