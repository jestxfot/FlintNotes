<script lang="ts">
  import { onMount } from 'svelte'
  import { NO_PRIORITY, PRIORITIES, type TaskFields } from './task'

  let {
    task,
    title,
    onsave,
    onclose,
  }: { task: TaskFields; title: string; onsave: (task: TaskFields) => void; onclose: () => void } = $props()

  let dialog: HTMLDialogElement
  // svelte-ignore state_referenced_locally (the dialog edits a copy of the task it was opened with)
  const form = $state({
    ...task,
    done: task.status.toLowerCase() === 'x',
    // The browser's date-and-time field wants `2026-10-09T14:30`.
    reminder: task.reminder?.includes('-') ? task.reminder.replace(' ', 'T') : '',
    reminderTime: task.reminder && !task.reminder.includes('-') ? task.reminder : '',
  })

  function save(event: SubmitEvent) {
    event.preventDefault()
    const description = form.description.trim()
    if (!description) return
    const { done, reminderTime, ...fields } = form
    onsave({
      ...fields,
      description,
      status: done ? 'x' : task.status.toLowerCase() === 'x' ? ' ' : task.status,
      priority: Number(form.priority),
      due: form.due || undefined,
      scheduled: form.scheduled || undefined,
      start: form.start || undefined,
      recurrence: form.recurrence?.trim() || undefined,
      reminder: form.reminder.replace('T', ' ') || reminderTime || undefined,
    })
    dialog.close()
  }

  onMount(() => dialog.showModal())
</script>

<dialog bind:this={dialog} {onclose} onclick={(event) => event.target === dialog && dialog.close()}>
  <form onsubmit={save}>
    <h2>{title}</h2>
    <!-- svelte-ignore a11y_autofocus (the dialog exists to type the task) -->
    <input class="wide" placeholder="Что нужно сделать" aria-label="Описание" bind:value={form.description} autofocus />

    <div class="grid">
      <label>Срок <input type="date" bind:value={form.due} /></label>
      <label>
        Приоритет
        <select bind:value={form.priority}>
          {#each PRIORITIES as priority, i (priority.name)}
            <option value={i}>{priority.emoji} {priority.label}</option>
          {/each}
        </select>
      </label>
      <label>Напомнить <input type="datetime-local" bind:value={form.reminder} /></label>
      <label>
        Повтор
        <input placeholder="every week" list="task-recurrence" bind:value={form.recurrence} />
      </label>
      <label>Запланировано <input type="date" bind:value={form.scheduled} /></label>
      <label>Начало <input type="date" bind:value={form.start} /></label>
    </div>
    <datalist id="task-recurrence">
      <option value="every day"></option>
      <option value="every weekday"></option>
      <option value="every week"></option>
      <option value="every 2 weeks"></option>
      <option value="every month"></option>
      <option value="every year"></option>
      <option value="every week when done"></option>
    </datalist>

    <div class="actions">
      <label class="check"><input type="checkbox" bind:checked={form.done} /> Выполнена</label>
      <button type="button" onclick={() => dialog.close()}>Отмена</button>
      <button class="primary" disabled={!form.description.trim()}>Сохранить</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
    padding: 20px 22px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
    box-shadow: var(--shadow);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }

  h2 {
    margin: 0 0 12px;
    font-size: 17px;
  }

  input,
  select {
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
  }

  .wide {
    width: 100%;
    font-size: 15px;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 14px;
    margin: 14px 0 18px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    color: var(--text-muted);
    font-size: 12.5px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    margin-right: auto;
    font-size: 14px;
  }

  button {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  button:hover {
    background: var(--bg-hover);
  }

  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
  }

  .primary:hover {
    background: var(--accent);
    filter: brightness(1.08);
  }

  .primary:disabled {
    opacity: 0.5;
  }
</style>
