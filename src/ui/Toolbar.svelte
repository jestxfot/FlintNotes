<script lang="ts">
  import type { ToolbarPlace } from '../core/toolbars'
  import { app } from '../instance'
  import { watch } from './reactive.svelte'

  let { place, vertical = false }: { place: ToolbarPlace; vertical?: boolean } = $props()

  // svelte-ignore state_referenced_locally (a toolbar keeps its place for life)
  const buttons = watch(app.toolbars, ['change'], () => app.toolbars.list(place))

  function icon(node: HTMLElement, name: string) {
    node.append(app.icons.draw(name))
  }
</script>

{#if buttons.current.length || vertical}
  <div class="toolbar" class:vertical data-place={place} role="toolbar" tabindex="-1" oncontextmenu={(event) => app.menus.show(event, 'toolbar', { place })}>
    {#each buttons.current as button (button.id)}
      {#key button.icon}
        <button
          title={button.title}
          aria-label={button.title}
          style:color={app.icons.css(button.color)}
          onclick={(event) => button.onClick(event)}
          oncontextmenu={(event) => app.menus.show(event, 'toolbar', { place, button: button.id })}
          use:icon={button.icon}
        ></button>
      {/key}
    {/each}
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .toolbar.vertical {
    flex-direction: column;
    flex: none;
    width: 44px;
    padding: 8px 0;
    background: var(--bg-alt);
  }

  .toolbar.vertical[data-place='left-ribbon'] {
    border-right: 1px solid var(--border);
  }

  .toolbar.vertical[data-place='right-ribbon'] {
    border-left: 1px solid var(--border);
  }

  button {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 5px;
    color: var(--text-muted);
    font-size: 17px;
  }

  button:hover {
    background: var(--bg-hover);
    filter: brightness(1.15);
  }
</style>
