<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { PanelDef, Side } from '../core/panels'
  import { app } from '../instance'
  import { drag } from './drag.svelte'
  import { watch } from './reactive.svelte'

  let { side, footer, floating = false }: { side: Side; footer?: Snippet; floating?: boolean } = $props()
  let resizing = $state(false)

  const MIN = 180
  const MAX = 640
  const DEFAULT = { left: 260, right: 290 }

  // svelte-ignore state_referenced_locally (a sidebar keeps its side for life)
  const groups = watch(app.panels, ['change'], () => app.panels.groups(side))
  const total = watch(app.panels, ['change'], () => app.panels.count())
  // svelte-ignore state_referenced_locally
  let width = $state(app.state.get(`sidebar-${side}`, DEFAULT[side]))
  /** Where the dragged widget would land: a block, or a gap between blocks. */
  let target = $state<{ group: number | null; at: number } | null>(null)

  function mountPanel(node: HTMLElement, panel: PanelDef) {
    const off = panel.mount(node)
    return { destroy: () => off?.() }
  }

  /** Position among a block's tabs that the pointer is over. */
  function tabPosition(event: DragEvent): number {
    const tabs = [...(event.currentTarget as HTMLElement).querySelectorAll('.widget-tab')]
    const index = tabs.findIndex((tab) => {
      const box = tab.getBoundingClientRect()
      return event.clientX < box.left + box.width / 2
    })
    return index < 0 ? tabs.length : index
  }

  function over(event: DragEvent, group: number | null, at: number) {
    if (!drag.panel && !drag.note) return
    event.preventDefault()
    event.stopPropagation()
    target = { group, at }
  }

  function drop(event: DragEvent) {
    if ((!drag.panel && !drag.note) || !target) return
    event.preventDefault()
    event.stopPropagation()
    // A note tab dropped here becomes a widget showing that note.
    if (drag.note) app.docked.dock(drag.note, side, target.group, target.at)
    else if (drag.panel) app.panels.move(drag.panel, side, target.group, target.at)
    drag.panel = null
    drag.note = null
    target = null
  }

  function resize(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const start = event.clientX
    const initial = width
    const move = (e: PointerEvent) => {
      const delta = side === 'left' ? e.clientX - start : start - e.clientX
      width = Math.min(MAX, Math.max(MIN, initial + delta))
    }
    resizing = true
    const up = () => {
      resizing = false
      handle.removeEventListener('pointermove', move)
      app.state.set(`sidebar-${side}`, width)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up, { once: true })
  }
</script>

<aside
  class={side}
  class:dragging={!!drag.panel || !!drag.note}
  class:floating
  class:resizing
  style:flex-basis="{width}px"
  style:width={floating ? `${width}px` : null}
  ondragleave={() => (target = null)}
>
  {#each groups.current as group, i (group.index)}
    {@const activeDef = group.entries.find((entry) => entry.def.id === group.active)?.def}
    <!-- While a widget is dragged, the gaps between blocks accept it as a block of its own. -->
    <div
      class="gap"
      class:over={target?.group === null && target.at === group.index}
      role="presentation"
      ondragover={(event) => over(event, null, group.index)}
      ondrop={drop}
    ></div>
    <section class="group" class:compact={activeDef?.compact} class:over={target?.group === group.index}>
      <!-- A lone widget needs no tabs: with no plugins enabled the sidebar is just the file list. -->
      {#if total.current > 1}
        <div
          class="tabs"
          role="tablist"
          tabindex="-1"
          ondragover={(event) => over(event, group.index, tabPosition(event))}
          ondrop={drop}
        >
          {#each group.entries as { def, key } (key)}
            <button
              class="widget-tab"
              role="tab"
              aria-selected={def.id === group.active}
              class:active={def.id === group.active}
              title={def.title}
              aria-label={def.title}
              draggable="true"
              onclick={() => app.panels.reveal(def.id)}
              oncontextmenu={(event) => app.menus.show(event, 'panel', def.id)}
              ondragstart={(event) => {
                event.dataTransfer?.setData('text/plain', def.id)
                // Showing the drop places moves things on the page, and Chrome cancels a
                // drag whose surroundings change while it is starting. So: a moment later.
                setTimeout(() => (drag.panel = def.id))
              }}
              ondragend={() => {
                drag.panel = null
                target = null
              }}
            >
              {#if def.icon}
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d={def.icon} /></svg>
              {:else}
                {def.title.slice(0, 1)}
              {/if}
            </button>
          {/each}
        </div>
      {/if}
      <!-- Widgets stay mounted while hidden, so switching tabs keeps their state. -->
      {#each group.entries as { def, key } (key)}
        <div
          class="panel"
          role="tabpanel"
          tabindex="-1"
          hidden={def.id !== group.active}
          use:mountPanel={def}
          ondragover={(event) => over(event, group.index, group.entries.length)}
          ondrop={drop}
        ></div>
      {/each}
    </section>
    {#if i === groups.current.length - 1}
      <div
        class="gap"
        class:over={target?.group === null && target.at === group.index + 1}
        role="presentation"
        ondragover={(event) => over(event, null, group.index + 1)}
        ondrop={drop}
      ></div>
    {/if}
  {:else}
    <!-- An empty sidebar is still a place to drop a widget. -->
    <div class="empty" class:over={!!target} role="presentation" ondragover={(event) => over(event, null, 0)} ondrop={drop}>
      Перетащите сюда виджет
    </div>
  {/each}

  {@render footer?.()}
  <div class="resize" role="separator" aria-orientation="vertical" onpointerdown={resize}></div>
</aside>

<style>
  aside {
    position: relative;
    display: flex;
    flex: 0 0 260px;
    flex-direction: column;
    min-width: 0;
    background: var(--bg-alt);
  }

  /* A floating sidebar lies over the note instead of taking room beside it. */
  .floating {
    position: absolute;
    top: 8px;
    bottom: 8px;
    z-index: 31;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-l);
    box-shadow: var(--shadow);
    animation: slide-in 0.08s ease-out;
  }

  .floating.left {
    left: 8px;
    --from: -12px;
  }

  .floating.right {
    right: 8px;
    --from: 12px;
  }

  @keyframes slide-in {
    from {
      opacity: 0;
      translate: var(--from) 0;
    }
  }

  .left {
    border-right: 1px solid var(--border);
  }

  .right {
    border-left: 1px solid var(--border);
  }

  .group {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-height: 90px;
  }

  /* A line separates every block from the one above it. */
  .group ~ .group {
    border-top: 1px solid var(--border);
  }

  /* A compact widget takes the height of its content; the others share the rest. */
  .group.compact {
    flex: 0 0 auto;
    min-height: 0;
  }

  .group.over {
    outline: 2px dashed var(--accent);
    outline-offset: -3px;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 5px 6px 2px;
  }

  .widget-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    border-radius: var(--radius-m);
    color: var(--text-faint);
    font-size: 13px;
    font-weight: 600;
    cursor: grab;
  }

  .widget-tab:hover,
  .widget-tab.active {
    background: var(--bg-hover);
    color: var(--text);
  }

  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  .panel[hidden] {
    display: none;
  }

  /* Gaps take no room until a widget is being dragged. */
  .gap {
    flex: none;
    height: 0;
  }

  .dragging .gap {
    height: 14px;
    margin: 0 6px;
    border-radius: var(--radius-s);
  }

  .gap.over,
  .empty.over {
    background: var(--accent);
    opacity: 0.35;
  }

  .empty {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    margin: 6px;
    border: 2px dashed var(--border);
    border-radius: var(--radius-l);
    color: var(--text-faint);
    font-size: 13px;
  }

  .resize {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 5px;
    cursor: col-resize;
  }

  .left .resize {
    right: -3px;
  }

  .right .resize {
    left: -3px;
  }

  .resize:hover {
    background: var(--accent);
    opacity: 0.4;
  }
</style>
