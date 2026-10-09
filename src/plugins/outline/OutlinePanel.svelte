<script lang="ts">
  import { watch, type App } from '../../api'

  let { app }: { app: App } = $props()

  // svelte-ignore state_referenced_locally (props of a panel are set once, when it is mounted)
  const active = watch(app.workspace, ['active-change', 'layout-change'], () => app.workspace.active?.path)
  // svelte-ignore state_referenced_locally (props of a panel are set once, when it is mounted)
  const indexed = watch(app.metadata, ['changed'], () => ({}))

  const headings = $derived.by(() => {
    void indexed.current
    const list = (active.current && app.metadata.get(active.current)?.headings) || []
    // Indentation starts from the shallowest level used, so a note of `##` headings is not pushed right.
    const top = Math.min(6, ...list.map((heading) => heading.level))
    return list.map((heading) => ({ ...heading, depth: heading.level - top }))
  })
</script>

<div class="outline">
  {#each headings as heading (heading.line)}
    <button
      style:padding-left="{8 + heading.depth * 14}px"
      class:top={heading.depth === 0}
      title={heading.text}
      onclick={() => app.workspace.openFile(active.current!, { line: heading.line })}
    >
      {heading.text}
    </button>
  {:else}
    <p>{active.current ? 'В этой заметке нет заголовков.' : 'Откройте заметку, чтобы увидеть её оглавление.'}</p>
  {/each}
</div>

<style>
  .outline {
    flex: 1;
    padding: 10px 6px 12px;
    overflow-y: auto;
  }

  button {
    display: block;
    width: 100%;
    padding: 3px 8px;
    overflow: hidden;
    border-radius: 5px;
    color: var(--text-muted);
    font-size: 13.5px;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button.top {
    color: var(--text);
    font-weight: 600;
  }

  button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  p {
    padding: 0 8px;
    color: var(--text-muted);
  }
</style>
