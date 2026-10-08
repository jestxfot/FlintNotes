<script lang="ts">
  import { path, watch, type App } from '../../api'

  let { app }: { app: App } = $props()

  // svelte-ignore state_referenced_locally (props of a panel are set once, when it is mounted)
  const active = watch(app.workspace, ['active-change', 'layout-change'], () => app.workspace.active?.path)
  // svelte-ignore state_referenced_locally (props of a panel are set once, when it is mounted)
  const indexed = watch(app.metadata, ['resolved'], () => ({}))

  /** Notes linking to the open one, each with the lines its links are on. */
  const sources = $derived.by(() => {
    void indexed.current
    const target = active.current
    if (!target) return []
    return [...app.metadata.backlinks(target).keys()]
      .filter((source) => source !== target)
      .sort((a, b) => a.localeCompare(b))
      .map((source) => {
        const lines = (app.metadata.text(source) ?? '').split('\n')
        const links = app.metadata.get(source)?.links ?? []
        const numbers = links.filter((link) => app.metadata.resolve(link.target, source) === target).map((l) => l.line)
        return { source, lines: [...new Set(numbers)].map((line) => ({ line, text: lines[line]?.trim() ?? '' })) }
      })
  })

  const title = (file: string) => path.stripExt(path.basename(file))
</script>

<div class="backlinks">
  {#if !active.current}
    <p>Откройте заметку, чтобы увидеть ссылки на неё.</p>
  {:else}
    <h3>Обратные ссылки <span>{sources.length}</span></h3>
    {#each sources as { source, lines } (source)}
      <button class="file" title={source} onclick={() => app.workspace.openFile(source)}>{title(source)}</button>
      {#each lines as { line, text } (line)}
        <button class="line" onclick={() => app.workspace.openFile(source, { line })}>{text}</button>
      {/each}
    {:else}
      <p>На эту заметку пока никто не ссылается.</p>
    {/each}
  {/if}
</div>

<style>
  .backlinks {
    flex: 1;
    padding: 10px 6px 12px;
    overflow-y: auto;
  }

  h3 {
    margin: 0 0 6px;
    padding: 0 6px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  h3 span {
    margin-left: 4px;
    color: var(--text-faint);
  }

  button {
    display: block;
    width: 100%;
    border-radius: 5px;
    text-align: left;
  }

  button:hover {
    background: var(--bg-hover);
  }

  .file {
    padding: 4px 6px;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line {
    padding: 3px 6px 3px 16px;
    color: var(--text-muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  p {
    padding: 0 6px;
    color: var(--text-muted);
  }
</style>
