<script lang="ts" generics="T">
  import { onMount } from 'svelte'
  import type { SuggestOptions } from '../core/suggest'

  let { options, onclose }: { options: SuggestOptions<T>; onclose: () => void } = $props()

  const LIMIT = 50

  let dialog: HTMLDialogElement
  let query = $state('')
  let index = $state(0)
  let chosen = false

  const results = $derived(options.items(query).slice(0, LIMIT))
  const creatable = $derived.by(() => {
    const text = query.trim()
    if (!options.onCreate || !text) return null
    return results.some((item) => options.label(item).toLowerCase() === text.toLowerCase()) ? null : text
  })
  const rows = $derived(results.length + (creatable ? 1 : 0))

  function choose(i: number) {
    const item = results[i]
    if (!item && !(creatable && i === results.length)) return
    chosen = true
    dialog.close()
    if (item) options.onChoose(item)
    else options.onCreate!(creatable!)
  }

  function onkeydown(event: KeyboardEvent) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step && rows) {
      event.preventDefault()
      index = (index + step + rows) % rows
      dialog.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(index)
    }
  }

  onMount(() => dialog.showModal())
</script>

<dialog
  bind:this={dialog}
  onclose={() => {
    if (!chosen) options.onCancel?.()
    onclose()
  }}
  {onkeydown}
  onclick={(event) => event.target === dialog && dialog.close()}>
  <input
    placeholder={options.placeholder}
    aria-label={options.placeholder}
    bind:value={query}
    oninput={() => (index = 0)}
  />
  <div class="list" role="listbox">
    {#each results as item, i (i)}
      {@const detail = options.detail?.(item)}
      <button
        role="option"
        aria-selected={i === index}
        class:selected={i === index}
        onclick={() => choose(i)}
        onmousemove={() => (index = i)}
      >
        <span class="label">{options.label(item)}</span>
        {#if detail}<span class="detail">{detail}</span>{/if}
      </button>
    {/each}
    {#if creatable}
      <button
        role="option"
        aria-selected={index === results.length}
        class:selected={index === results.length}
        onclick={() => choose(results.length)}
        onmousemove={() => (index = results.length)}
      >
        <span class="label">{options.createLabel?.(creatable) ?? `Создать «${creatable}»`}</span>
      </button>
    {:else if !results.length}
      <div class="none">Ничего не найдено</div>
    {/if}
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

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    flex: none;
    max-width: 50%;
    overflow: hidden;
    color: var(--text-faint);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .none {
    padding: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
