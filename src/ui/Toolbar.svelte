<script lang="ts">
  import type { ToolbarPlace } from '../core/toolbars'
  import { app } from '../instance'
  import { drag } from './drag.svelte'
  import { layout } from './layout.svelte'
  import { watch } from './reactive.svelte'

  let { place, vertical = false }: { place: ToolbarPlace; vertical?: boolean } = $props()

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

  // A tab or a widget's icon dragged onto a strip along the edge becomes a button there; a button dragged onto any strip moves there.
  const side = $derived(place.startsWith('left-ribbon') ? 'left' : place.startsWith('right-ribbon') ? 'right' : null)
  const takes = $derived(!!drag.button || (!!side && (!!drag.note || !!drag.panel)))
  /** Where a dropped button would land: before this button, or (null) at the end. */
  let landing = $state<string | null | undefined>(undefined)
  let el = $state<HTMLElement>()

  function landingAt(event: DragEvent): string | null {
    for (const node of el?.querySelectorAll<HTMLElement>(':scope > button[data-id]') ?? []) {
      if (node.dataset.id === drag.button) continue
      const box = node.getBoundingClientRect()
      if (vertical ? event.clientY < box.top + box.height / 2 : event.clientX < box.left + box.width / 2) return node.dataset.id!
    }
    return null
  }
  function dragOver(event: DragEvent) {
    if (!takes) return
    event.preventDefault()
    event.stopPropagation()
    landing = landingAt(event)
  }
  function drop(event: DragEvent) {
    landing = undefined
    if (!takes) return
    const before = landingAt(event)
    event.preventDefault()
    event.stopPropagation()
    if (drag.button) app.toolbars.move(drag.button, place, before)
    else if (side) {
      const id = app.ribbonItems.add(drag.note ?? `view:panel-${drag.panel}`, side)
      if (app.toolbars.placeOf(id) !== place || before) app.toolbars.move(id, place, before)
    }
    drag.note = drag.panel = drag.button = null
  }
  // Chrome tells no element the pointer went to; leaving for a button of the strip is not leaving it.
  function leave(event: DragEvent) {
    const box = el?.getBoundingClientRect()
    if (!box || event.clientX < box.left || event.clientX >= box.right || event.clientY < box.top || event.clientY >= box.bottom) landing = undefined
  }
  function dragStart(event: DragEvent, id: string) {
    event.dataTransfer?.setData('text/plain', id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    // The strips change to show where the button can go; Chrome cancels a drag whose surroundings change while it is starting.
    setTimeout(() => (drag.button = id))
  }
</script>

{#if buttons.current.length || vertical || drag.button}
  <div
    bind:this={el}
    class="toolbar"
    class:vertical
    class:receiving={takes}
    class:over={landing !== undefined}
    class:land-end={landing === null}
    data-place={place}
    role="toolbar"
    tabindex="-1"
    oncontextmenu={(event) => app.menus.show(event, 'toolbar', { place })}
    ondragover={dragOver}
    ondragleave={leave}
    ondrop={drop}
  >
    {#each buttons.current as button (button.id)}
      {#key button.icon}
        <button
          title={button.title}
          aria-label={button.title}
          data-id={button.id}
          style:color={app.icons.css(button.color)}
          class:on={vertical && hosting.current === button.id}
          class:land={landing === button.id}
          class:lifted={drag.button === button.id}
          draggable={!layout.mobile}
          ondragstart={(event) => dragStart(event, button.id)}
          ondragend={() => ((drag.button = null), (landing = undefined))}
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
    padding: 8px 0;
  }

  /* While a button is dragged, an empty strip still has room to take it. */
  .toolbar:not(.vertical).receiving {
    min-width: 28px;
    min-height: 28px;
    border-radius: var(--radius-m);
  }

  /* While something is dragged that can land here, the strip shows it is a place for it; a strip along an edge says it as a whole (Ribbon.svelte). */
  .toolbar.receiving:not(.vertical) {
    outline: 1.5px dashed color-mix(in srgb, var(--accent) 50%, transparent);
    outline-offset: -2px;
  }

  .toolbar.over {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
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

  /* A drop on an icon is not let through by Chrome: the button itself takes it. */
  button > :global(*) {
    pointer-events: none;
  }

  button:hover {
    background: var(--bg-hover);
    filter: brightness(1.15);
  }

  button.lifted {
    opacity: 0.4;
  }

  /* Where a dragged button would land: a line before a button, or after the last one. */
  button.land {
    box-shadow: -3px 0 0 -1px var(--accent);
  }

  .toolbar.vertical button.land {
    box-shadow: 0 -3px 0 -1px var(--accent);
  }

  .toolbar.land-end::after {
    content: '';
    flex: none;
    width: 2px;
    height: 22px;
    border-radius: 1px;
    background: var(--accent);
  }

  .toolbar.vertical.land-end::after {
    width: 22px;
    height: 2px;
  }

  /* The button whose view is on screen: it is that view's tab. */
  button.on {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
    color: var(--text);
  }

  .toolbar[data-place='status-bar'] {
    margin: -3px 0;
  }

  .toolbar[data-place='status-bar'] button {
    width: 22px;
    height: 22px;
    font-size: 14px;
  }
</style>
