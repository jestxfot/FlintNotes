<script lang="ts">
  import { drag } from './drag.svelte'
  import Toolbar from './Toolbar.svelte'

  /** A strip along an edge of the window: buttons at its top, and at its bottom. */
  let { side, floating = false }: { side: 'left' | 'right'; /** Shown over the page, taking no room of its own: a strip that is there only to be dropped on. */ floating?: boolean } = $props()
</script>

<div class="ribbon {side}" class:floating class:dragging={!!(drag.button || drag.note || drag.panel)}>
  <div class="start"><Toolbar place={side === 'left' ? 'left-ribbon' : 'right-ribbon'} vertical /></div>
  <div class="end"><Toolbar place={side === 'left' ? 'left-ribbon-end' : 'right-ribbon-end'} vertical /></div>
</div>

<style>
  .ribbon {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 44px;
    background: var(--bg-alt);
  }

  .ribbon.left {
    border-right: 1px solid var(--border);
  }

  .ribbon.right {
    border-left: 1px solid var(--border);
  }

  /* The top takes all the room the bottom does not: a click or a drop on the empty middle is the top's. */
  .start {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  .start > :global(.toolbar) {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .end {
    display: flex;
    flex: none;
    flex-direction: column;
  }

  .end > :global(.toolbar) {
    justify-content: flex-end;
  }

  /* While something is dragged, the strip is tinted as a place to drop on, and the bottom grows into a place of its own. */
  .ribbon.dragging {
    background: color-mix(in srgb, var(--accent) 6%, var(--bg-alt));
  }

  .ribbon.dragging .end > :global(.toolbar) {
    min-height: 120px;
    border-top: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
  }

  /* A strip with no buttons yet appears over the page while something is dragged, so nothing moves under the pointer. */
  .ribbon.floating {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 40;
    box-shadow: 0 0 18px rgb(0 0 0 / 0.28);
  }

  .ribbon.floating.left {
    left: 0;
  }

  .ribbon.floating.right {
    right: 0;
  }
</style>
