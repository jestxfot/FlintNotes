<script lang="ts">
  import { onMount } from 'svelte'
  import { formatHotkey, type Command } from '../core/commands'
  import { app } from '../instance'

  let { onclose }: { onclose: () => void } = $props()

  const commands = app.commands.list().sort((a, b) => a.name.localeCompare(b.name))

  let dialog: HTMLDialogElement
  let query = $state('')
  let index = $state(0)

  const results = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return commands.filter((c) => words.every((word) => c.name.toLowerCase().includes(word)))
  })

  function run(command: Command | undefined) {
    if (!command) return
    dialog.close()
    command.callback()
  }

  function onkeydown(event: KeyboardEvent) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step && results.length) {
      event.preventDefault()
      index = (index + step + results.length) % results.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(results[index])
    }
  }

  onMount(() => dialog.showModal())
</script>

<dialog
  bind:this={dialog}
  {onclose}
  {onkeydown}
  onclick={(event) => event.target === dialog && dialog.close()}
  aria-label="Палитра команд"
>
  <input placeholder="Команда…" aria-label="Поиск команды" bind:value={query} oninput={() => (index = 0)} />
  <div class="list" role="listbox">
    {#each results as command, i (command.id)}
      <button
        role="option"
        aria-selected={i === index}
        class:selected={i === index}
        onclick={() => run(command)}
        onmousemove={() => (index = i)}
      >
        <span>{command.name}</span>
        {#if command.hotkey}<kbd>{formatHotkey(command.hotkey)}</kbd>{/if}
      </button>
    {:else}
      <div class="none">Ничего не найдено</div>
    {/each}
  </div>
</dialog>

<style>
  dialog {
    top: 14vh;
    width: min(560px, calc(100vw - 32px));
    max-height: 60vh;
    margin-top: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
    box-shadow: var(--shadow);
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.25);
  }

  input {
    padding: 13px 16px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: none;
    font-size: 15px;
    outline: none;
  }

  .list {
    display: flex;
    flex-direction: column;
    padding: 6px;
    overflow-y: auto;
  }

  .list button {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 10px;
    border-radius: 6px;
    text-align: left;
  }

  .list button.selected {
    background: var(--bg-hover);
  }

  kbd {
    color: var(--text-muted);
    font: 11px var(--font-mono);
  }

  .none {
    padding: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
