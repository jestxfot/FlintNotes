<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { path, type App } from '../../api'
  import { highlightPattern, search } from './search'

  let { app, onclose }: { app: App; onclose: () => void } = $props()

  const HISTORY = 20
  let dialog: HTMLDialogElement
  let field: HTMLInputElement
  let list: HTMLElement
  // The search is the one the sidebar's panel has: either place continues what the other began.
  // svelte-ignore state_referenced_locally
  let typed = $state(app.state.get<string>('search-query', ''))
  // svelte-ignore state_referenced_locally
  let query = $state(typed)
  // svelte-ignore state_referenced_locally
  let history = $state.raw(app.state.get<string[]>('search-history', []))
  let index = $state(0)

  $effect(() => {
    const value = typed
    // Searching runs a moment after typing stops.
    const timer = setTimeout(() => {
      query = value
      index = 0
      app.state.set('search-query', value)
    }, 120)
    return () => clearTimeout(timer)
  })

  const results = $derived(search(app, query))
  /** Everything that can be opened, in the order it is shown: a note, then the lines found in it. */
  const rows = $derived(results.flatMap((result) => [{ result, line: undefined as number | undefined, text: '' }, ...result.matches.map((match) => ({ result, line: match.line as number | undefined, text: match.text }))]))
  const highlight = $derived(highlightPattern(query))
  const pieces = (text: string) => (highlight ? text.split(highlight) : [text])
  const title = (file: string) => path.stripExt(path.basename(file))
  const folder = (file: string) => (path.dirname(file) ? `${path.dirname(file)}/` : '')

  /** A search that led somewhere is kept, newest first, to be repeated with one click. */
  function keep(text: string) {
    const value = text.trim()
    if (!value) return
    history = [value, ...history.filter((item) => item !== value)].slice(0, HISTORY)
    app.state.set('search-history', history)
  }

  function open(row: (typeof rows)[number], newTab: boolean) {
    keep(typed)
    dialog.close()
    app.workspace.openFile(row.result.path, { line: row.line, ...(newTab ? { newTab: true } : {}) })
  }

  async function move(by: number) {
    if (!rows.length) return
    index = (index + by + rows.length) % rows.length
    await tick()
    list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      void move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      void move(-1)
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault()
      void move(event.key === 'PageDown' ? 8 : -8)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (rows[index]) open(rows[index], event.ctrlKey || event.metaKey)
    }
  }

  onMount(() => {
    dialog.showModal()
    field.select()
  })
</script>

<dialog bind:this={dialog} {onclose} {onkeydown} onclick={(event) => event.target === dialog && dialog.close()}>
  <div class="head">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM11 11l3 3" /></svg>
    <input
      bind:this={field}
      bind:value={typed}
      placeholder="Поиск по всем заметкам: слова, &quot;точная фраза&quot;, tag:#тег, path:папка"
      aria-label="Поиск по всем заметкам"
      spellcheck="false"
    />
    {#if query.trim()}<span class="summary">{results.length ? `заметок: ${results.length}` : 'ничего не найдено'}</span>{/if}
  </div>

  <div class="list" bind:this={list} role="listbox">
    {#if !typed.trim()}
      {#if history.length}
        <div class="label">
          Недавние запросы
          <button
            class="clear"
            onclick={() => {
              history = []
              app.state.set('search-history', [])
            }}>очистить</button
          >
        </div>
        <div class="history">
          {#each history as item (item)}
            <button
              onclick={() => {
                typed = item
                field.focus()
              }}>{item}</button
            >
          {/each}
        </div>
      {:else}
        <p class="hint">Ищет в названиях, алиасах и тексте заметок; названия идут первыми.</p>
      {/if}
    {/if}
    {#each rows as row, i (row.result.path + ':' + (row.line ?? 'file'))}
      {#if row.line === undefined}
        <button class="file" class:selected={i === index} role="option" aria-selected={i === index} title={row.result.path} onmousemove={() => (index = i)} onclick={(event) => open(row, event.ctrlKey || event.metaKey)}>
          <span class="name">{#each pieces(title(row.result.path)) as piece, n (n)}{#if n % 2}<mark>{piece}</mark>{:else}{piece}{/if}{/each}</span>
          {#if row.result.alias}<span class="alias">{row.result.alias}</span>{/if}
          <span class="folder">{folder(row.result.path)}</span>
          {#if row.result.total}<span class="count">{row.result.total}</span>{/if}
        </button>
      {:else}
        <button class="line" class:selected={i === index} role="option" aria-selected={i === index} onmousemove={() => (index = i)} onclick={(event) => open(row, event.ctrlKey || event.metaKey)}>
          <span class="number">{row.line + 1}</span>
          <span class="text">{#each pieces(row.text) as piece, n (n)}{#if n % 2}<mark>{piece}</mark>{:else}{piece}{/if}{/each}</span>
        </button>
      {/if}
    {/each}
  </div>
  <div class="foot">↑↓ выбрать · Enter открыть · Ctrl+Enter в новой вкладке · Esc закрыть</div>
</dialog>

<style>
  dialog {
    display: flex;
    flex-direction: column;
    width: min(920px, calc(100vw - 48px));
    height: min(720px, calc(100vh - 96px));
    margin-top: 48px;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    background: var(--bg-alt);
    color: var(--text);
    box-shadow: var(--shadow);
    font: 14px/1.4 var(--font-ui);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  svg {
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 16px;
  }

  .summary,
  .foot,
  .hint,
  .label {
    color: var(--text-faint);
    font-size: 12px;
  }

  .list {
    flex: 1;
    padding: 6px;
    overflow-y: auto;
  }

  .label {
    display: flex;
    justify-content: space-between;
    padding: 8px 10px 4px;
  }

  .clear {
    color: var(--text-faint);
  }

  .clear:hover {
    color: var(--text);
  }

  .hint {
    padding: 8px 10px;
  }

  .history {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 4px 10px 10px;
  }

  .history button {
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 2em;
    background: var(--bg);
  }

  .history button:hover {
    border-color: var(--accent);
  }

  .file,
  .line {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    padding: 5px 10px;
    border-radius: var(--radius-m);
    text-align: left;
  }

  .file {
    margin-top: 4px;
    font-weight: 600;
  }

  .line {
    padding-left: 22px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .selected {
    background: var(--bg-hover);
    color: var(--text);
  }

  .name,
  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .text {
    flex: 1;
  }

  .folder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .alias {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 400;
  }

  .count,
  .number {
    flex: none;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }

  .number {
    width: 34px;
    text-align: right;
  }

  mark {
    border-radius: 3px;
    background: color-mix(in srgb, var(--color-yellow) 45%, transparent);
    color: inherit;
  }

  .foot {
    padding: 7px 16px;
    border-top: 1px solid var(--border);
  }
</style>
