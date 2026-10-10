<script lang="ts">
  import { onMount } from 'svelte'
  import { path, watch, type App } from '../../api'
  import { search, textTerms } from './search'

  let { app, panelId }: { app: App; panelId: string } = $props()

  let input: HTMLInputElement
  // What was searched for last stays in the field: the panel is taken away and put back
  // (another widget's tab, a floating sidebar, a reload), and the search is still there.
  // svelte-ignore state_referenced_locally
  let typed = $state(app.state.get<string>('search-query', ''))
  // Searching runs a moment after typing stops.
  // svelte-ignore state_referenced_locally
  let query = $state(typed)
  $effect(() => {
    const value = typed
    const timer = setTimeout(() => {
      query = value
      app.state.set('search-query', value)
    }, 150)
    return () => clearTimeout(timer)
  })

  // svelte-ignore state_referenced_locally (props of a panel are set once, when it is mounted)
  const indexed = watch(app.metadata, ['resolved'], () => ({}))
  const results = $derived.by(() => {
    void indexed.current
    return search(app, query)
  })
  const highlight = $derived.by(() => {
    const words = textTerms(query).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return words.length ? new RegExp(`(${words.join('|')})`, 'gi') : null
  })

  /** Splits a line into plain and matching pieces; odd pieces are matches. */
  const pieces = (text: string) => (highlight ? text.split(highlight) : [text])
  const title = (file: string) => path.stripExt(path.basename(file))

  onMount(() =>
    app.panels.on('reveal', (id) => {
      if (id !== panelId) return
      // The sidebar may be opening right now; focus once it is on screen.
      setTimeout(() => {
        input.focus()
        input.select()
      })
    }),
  )
</script>

<div class="field">
  <input
    bind:this={input}
    bind:value={typed}
    type="search"
    placeholder="Поиск по заметкам…"
    aria-label="Поиск по заметкам"
    title={'Ищет в названиях, алиасах и тексте; названия идут первыми. "точная фраза", tag:#тег, path:папка'}
  />
</div>

<div class="results">
  {#if query.trim()}
    <p class="summary">{results.length ? `Найдено заметок: ${results.length}` : 'Ничего не найдено'}</p>
  {/if}
  {#each results as result (result.path)}
    <button class="file" title={result.path} onclick={() => app.workspace.openFile(result.path)}>
      <span class="name">{title(result.path)}</span>
      {#if result.alias}<span class="alias" title="Найдено по алиасу">{result.alias}</span>{/if}
      {#if result.total}<span class="count">{result.total}</span>{/if}
    </button>
    {#each result.matches as match (match.line)}
      <button class="line" onclick={() => app.workspace.openFile(result.path, { line: match.line })}>
        {#each pieces(match.text) as piece, i (i)}{#if i % 2}<mark>{piece}</mark>{:else}{piece}{/if}{/each}
      </button>
    {/each}
  {/each}
</div>

<style>
  .field {
    padding: 8px;
  }

  input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--bg);
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .results {
    flex: 1;
    padding: 0 6px 12px;
    overflow-y: auto;
  }

  .summary {
    margin: 0 0 6px;
    padding: 0 6px;
    color: var(--text-faint);
    font-size: 12px;
  }

  button {
    display: flex;
    width: 100%;
    border-radius: var(--radius-m);
    text-align: left;
  }

  button:hover {
    background: var(--bg-hover);
  }

  .file {
    gap: 8px;
    padding: 4px 6px;
    font-weight: 600;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .alias {
    flex: none;
    max-width: 50%;
    overflow: hidden;
    color: var(--accent);
    font-size: 12px;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 400;
  }

  .line {
    display: block;
    padding: 3px 6px 3px 16px;
    color: var(--text-muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  mark {
    border-radius: 2px;
    background: var(--selection);
    color: var(--text);
  }
</style>
