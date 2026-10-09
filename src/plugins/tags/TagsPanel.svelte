<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity'
  import { path, watch, type App } from '../../api'
  import type { TagSelection } from './state'

  let { app, selection }: { app: App; selection: TagSelection } = $props()

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  // svelte-ignore state_referenced_locally (props of a panel are set once, when it is mounted)
  const tags = watch(app.metadata, ['resolved'], () =>
    app.metadata.tags().sort((a, b) => collator.compare(a.tag, b.tag)),
  )
  // svelte-ignore state_referenced_locally (props of a panel are set once, when it is mounted)
  const selected = watch(selection, ['change'], () => selection.selected)
  const expanded = new SvelteSet<string>()

  // A tag clicked in the editor opens here.
  $effect(() => {
    if (selected.current) expanded.add(selected.current)
  })

  // svelte-ignore state_referenced_locally
  const icons = watch(app.icons, ['change'], () => ({}))
  function tagIcon(node: HTMLElement, icon: string | undefined) {
    if (icon) node.prepend(app.icons.draw(icon), ' ')
  }
  const key = (tag: string) => tag.toLowerCase()
  const toggle = (tag: string) => expanded.delete(key(tag)) || expanded.add(key(tag))
  const title = (file: string) => path.stripExt(path.basename(file))
</script>

<div class="tags">
  {#each tags.current as { tag, files } (key(tag))}
    {@const look = icons.current && app.icons.look('tag', tag)}
    <button class="tag" class:selected={selected.current === key(tag)} onclick={() => toggle(tag)} oncontextmenu={(event) => app.menus.show(event, 'tag', tag)}>
      {#key look?.icon}
        <span class="name" style:color={app.icons.css(look?.color)} use:tagIcon={look?.icon}>#{tag}</span>
      {/key}
      <span class="count">{files.length}</span>
    </button>
    {#if expanded.has(key(tag))}
      {#each files as file (file)}
        <button class="file" title={file} onclick={() => app.workspace.openFile(file)}>{title(file)}</button>
      {/each}
    {/if}
  {:else}
    <p>В заметках пока нет тегов. Напишите <code>#тег</code> в тексте.</p>
  {/each}
</div>

<style>
  .tags {
    flex: 1;
    padding: 8px 6px 12px;
    overflow-y: auto;
  }

  button {
    display: flex;
    width: 100%;
    padding: 4px 8px;
    border-radius: 5px;
    color: var(--text-muted);
    text-align: left;
  }

  button:hover,
  .selected {
    background: var(--bg-hover);
    color: var(--text);
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    color: var(--text-faint);
    font-size: 12px;
  }

  .file {
    display: block;
    padding-left: 22px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    padding: 8px;
    color: var(--text-muted);
  }

  code {
    font-family: var(--font-mono);
  }
</style>
