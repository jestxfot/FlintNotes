<script lang="ts" module>
  /** What was typed last in the dialogs that ask for it to be kept, by their names; lives as long as the page. */
  const remembered = new Map<string, string>()
</script>

<script lang="ts" generics="T">
  import { onMount } from 'svelte'
  import type { SuggestOptions } from '../core/suggest'
  import { app } from '../instance'
  import { layout } from './layout.svelte'

  let { options, onclose }: { options: SuggestOptions<T>; onclose: () => void } = $props()

  const LIMIT = 80

  let dialog: HTMLDialogElement
  // svelte-ignore state_referenced_locally (a dialog is opened with its options once)
  let query = $state(options.remember ? (remembered.get(options.remember) ?? '') : '')
  $effect(() => {
    if (options.remember) remembered.set(options.remember, query)
  })
  let field: HTMLInputElement
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

  /** The label in pieces, so that what was typed can be shown in bold where it occurs. */
  function pieces(text: string): { text: string; hit: boolean }[] {
    const needle = query.trim().toLowerCase()
    const at = needle ? text.toLowerCase().indexOf(needle) : -1
    if (at < 0) return [{ text, hit: false }]
    return [
      { text: text.slice(0, at), hit: false },
      { text: text.slice(at, at + needle.length), hit: true },
      { text: text.slice(at + needle.length), hit: false },
    ]
  }

  function icon(node: HTMLElement, look: { icon?: string; color?: string } | undefined) {
    if (look?.icon) node.append(app.icons.draw(look.icon, look.color))
  }

  onMount(() => {
    dialog.showModal()
    // What is there from the last time is selected: typing replaces it, Enter repeats it.
    field.select()
  })
</script>

<dialog
  bind:this={dialog}
  onclose={() => {
    if (!chosen) options.onCancel?.()
    onclose()
  }}
  {onkeydown}
  class:stacked={options.stacked || layout.mobile}
  class:phone={layout.mobile}
  onclick={(event) => event.target === dialog && dialog.close()}>
  <div class="field">
    <input
      placeholder={options.placeholder}
      aria-label={options.placeholder}
      bind:this={field}
      bind:value={query}
      oninput={() => (index = 0)}
    />
    {#if layout.mobile}<button class="cancel" onclick={() => dialog.close()}>Отмена</button>{/if}
  </div>
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
        {#if options.icon}
          {@const look = options.icon(item)}
          {#key look?.icon}<span class="glyph" use:icon={look}></span>{/key}
        {/if}
        <span class="text">
          <span class="label">{#each pieces(options.label(item)) as piece, n (n)}{#if piece.hit}<b>{piece.text}</b>{:else}{piece.text}{/if}{/each}</span>
          {#if detail}<span class="detail">{detail}</span>{/if}
        </span>
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
    border-radius: var(--radius-xl);
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

  .field {
    display: flex;
    flex: none;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }

  .cancel {
    padding: 0 16px 0 4px;
    color: var(--accent);
    font-size: 16px;
  }

  /* On a phone the list has the whole screen and every row is a finger high. */
  .phone input {
    font-size: 16px;
  }

  .phone .list button {
    min-height: 50px;
    padding: 6px 12px;
    border-radius: 12px;
    font-size: 16px;
  }

  .phone .list button.selected:not(:active) {
    background: none;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 13px 16px;
    border: none;
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
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: var(--radius-m);
    text-align: left;
  }

  .text {
    display: flex;
    flex: 1;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  }

  .glyph {
    display: flex;
    flex: none;
    width: 18px;
    color: var(--text-muted);
    font-size: 16px;
  }

  .label b {
    font-weight: 700;
  }

  /* A big list for finding files: most of the window, the folder under each name. */
  dialog.stacked {
    top: 8vh;
    width: min(880px, calc(100vw - 48px));
    max-height: 84vh;
    background: var(--bg-alt);
  }

  .stacked .text {
    flex-direction: column;
    gap: 1px;
  }

  .stacked .detail {
    max-width: 100%;
    color: var(--text-muted);
  }

  .stacked input {
    padding: 15px 18px;
    font-size: 16px;
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
