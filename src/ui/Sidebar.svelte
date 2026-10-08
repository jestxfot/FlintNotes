<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { PanelDef, Side } from '../core/panels'
  import { app } from '../instance'
  import { watch } from './reactive.svelte'

  let { side, footer }: { side: Side; footer?: Snippet } = $props()

  const panels = watch(app.panels, ['change'], () => app.panels.list(side))
  const active = watch(app.panels, ['change'], () => app.panels.active(side))

  function mountPanel(node: HTMLElement, panel: PanelDef) {
    const off = panel.mount(node)
    return { destroy: () => off?.() }
  }
</script>

<aside class={side}>
  <!-- A lone panel needs no tabs: with no plugins enabled the sidebar is just the file list. -->
  {#if panels.current.length > 1}
    <div class="tabs" role="tablist">
      {#each panels.current as { def, key } (key)}
        <button
          role="tab"
          aria-selected={def.id === active.current}
          class:active={def.id === active.current}
          onclick={() => app.panels.reveal(def.id)}
        >
          {def.title}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Panels stay mounted while hidden, so switching tabs keeps their state. -->
  {#each panels.current as { def, key } (key)}
    <div class="panel" hidden={def.id !== active.current} use:mountPanel={def}></div>
  {/each}

  {@render footer?.()}
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg-alt);
  }

  .left {
    flex: 0 0 260px;
    border-right: 1px solid var(--border);
  }

  .right {
    flex: 0 0 290px;
    border-left: 1px solid var(--border);
  }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 6px 6px 0;
  }

  .tabs button {
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    overflow: hidden;
    border-radius: 5px;
    color: var(--text-muted);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tabs button:hover,
  .tabs button.active {
    background: var(--bg-hover);
    color: var(--text);
  }

  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .panel[hidden] {
    display: none;
  }
</style>
