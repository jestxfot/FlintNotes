<script lang="ts">
  import type { ToolbarPlace } from '../core/toolbars'
  import { app } from '../instance'
  import { drag } from './drag.svelte'
  import { watch } from './reactive.svelte'

  let { place, vertical = false, floating = false }: { place: ToolbarPlace; vertical?: boolean; /** Shown over the page, taking no room of its own: a strip that is there only to be dropped on. */ floating?: boolean } = $props()

  // svelte-ignore state_referenced_locally (a toolbar keeps its place for life)
  const buttons = watch(app.toolbars, ['change'], () => app.toolbars.list(place))
  /** The button whose view is on screen now: a button of an edge strip is the tab of the view it opens. */
  const hosting = watch(app.workspace, ['active-change', 'layout-change'], () => app.workspace.active?.host ?? null)

  function press(button: { id: string; onClick(event: MouseEvent): void }, event: MouseEvent) {
    if (!vertical || app.settings.get<boolean>('core', 'ribbonTabs') === false) return button.onClick(event)
    // A second click on the button of the view that is on screen goes back to the tab that was there before.
    if (app.workspace.active?.host === button.id) return app.workspace.back()
    app.workspace.withHost(button.id, () => button.onClick(event))
  }

  function icon(node: HTMLElement, name: string) {
    node.append(app.icons.draw(name))
  }

  // A tab or a widget's icon dragged onto a strip along the edge becomes a button there.
  const side = $derived(place === 'left-ribbon' ? 'left' : place === 'right-ribbon' ? 'right' : null)
  let over = $state(false)
  function dragOver(event: DragEvent) {
    if (!side || (!drag.note && !drag.panel)) return
    event.preventDefault()
    over = true
  }
  function drop(event: DragEvent) {
    over = false
    if (!side || (!drag.note && !drag.panel)) return
    event.preventDefault()
    event.stopPropagation()
    app.ribbonItems.add(drag.note ?? `view:panel-${drag.panel}`, side)
    drag.note = drag.panel = null
  }
</script>

{#if buttons.current.length || vertical}
  <div
    class="toolbar"
    class:vertical
    class:floating
    class:receiving={!!side && (!!drag.note || !!drag.panel)}
    class:over
    data-place={place}
    role="toolbar"
    tabindex="-1"
    oncontextmenu={(event) => app.menus.show(event, 'toolbar', { place })}
    ondragover={dragOver}
    ondragleave={() => (over = false)}
    ondrop={drop}
  >
    {#each buttons.current as button (button.id)}
      {#key button.icon}
        <button
          title={button.title}
          aria-label={button.title}
          style:color={app.icons.css(button.color)}
          class:on={vertical && hosting.current === button.id}
          onclick={(event) => press(button, event)}
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

  /* A strip with no buttons yet appears over the page while something is dragged, so nothing moves under the pointer. */
  .toolbar.vertical.floating {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 40;
    opacity: 0.92;
  }

  .toolbar.vertical.floating[data-place='left-ribbon'] {
    left: 0;
  }

  .toolbar.vertical.floating[data-place='right-ribbon'] {
    right: 0;
  }

  /* While something is dragged that can become a button, the strip shows it is a place for it. */
  .toolbar.vertical.receiving {
    outline: 2px dashed color-mix(in srgb, var(--accent) 55%, transparent);
    outline-offset: -4px;
  }

  .toolbar.vertical.over {
    background: color-mix(in srgb, var(--accent) 22%, var(--bg-alt));
  }

  button {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-m);
    color: var(--text-muted);
    font-size: 17px;
  }

  button:hover {
    background: var(--bg-hover);
    filter: brightness(1.15);
  }

  /* The button whose view is on screen: it is that view's tab. */
  button.on {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
    color: var(--text);
  }
</style>
