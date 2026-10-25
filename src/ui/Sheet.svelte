<script lang="ts">
  import type { Snippet } from 'svelte'

  // A sheet rising from the bottom of a phone's screen, over a shade: menus, the open tabs, more actions.
  // A tap on the shade, Esc or the sheet pulled down by its handle sends it away.
  let { onclose, label, children, header }: { onclose: () => void; label: string; children: Snippet; header?: Snippet } = $props()

  let sheet: HTMLElement
  let pulled = $state(0)
  let start: { y: number; at: number } | null = null

  function grab(event: PointerEvent) {
    // Pulled by the handle or the title; the list itself scrolls.
    start = { y: event.clientY, at: performance.now() }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  function drag(event: PointerEvent) {
    if (start) pulled = Math.max(0, event.clientY - start.y)
  }
  function release() {
    if (!start) return
    // Pulled down a third of the way, or flicked down: it goes.
    const fast = pulled / Math.max(1, performance.now() - start.at) > 0.6
    start = null
    if (pulled > sheet.offsetHeight / 3 || (fast && pulled > 24)) onclose()
    pulled = 0
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (event.stopPropagation(), onclose())} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (Esc closes it) -->
<div class="shade" onclick={onclose}></div>
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="sheet" role="dialog" tabindex="-1" aria-modal="true" aria-label={label} bind:this={sheet} style:translate={pulled ? `0 ${pulled}px` : null} class:pulling={pulled > 0} onclick={(event) => event.stopPropagation()}>
  <div class="grip" role="presentation" onpointerdown={grab} onpointermove={drag} onpointerup={release} onpointercancel={release}>
    <span class="handle"></span>
    {@render header?.()}
  </div>
  <div class="sheet-body">{@render children()}</div>
</div>

<style>
  .shade {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgb(0 0 0 / 0.38);
    animation: shade-in 0.18s ease-out;
  }

  .sheet {
    position: fixed;
    inset: auto 0 0;
    z-index: 61;
    display: flex;
    flex-direction: column;
    max-height: min(82%, calc(var(--visible-height, 100dvh) - 48px));
    padding-bottom: env(safe-area-inset-bottom);
    border-radius: 18px 18px 0 0;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 -8px 32px rgb(0 0 0 / 0.22);
    font-size: 16px;
    animation: sheet-in 0.24s cubic-bezier(0.2, 0.9, 0.3, 1);
    transition: translate 0.18s ease-out;
  }

  .sheet.pulling {
    transition: none;
  }

  .grip {
    display: flex;
    flex-direction: column;
    flex: none;
    touch-action: none;
  }

  .handle {
    align-self: center;
    width: 38px;
    height: 5px;
    margin: 8px 0 6px;
    border-radius: 3px;
    background: var(--text-faint);
    opacity: 0.55;
  }

  .sheet-body {
    flex: 1;
    min-height: 0;
    padding: 0 8px 10px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  @keyframes sheet-in {
    from {
      translate: 0 100%;
    }
  }

  @keyframes shade-in {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet,
    .shade {
      animation: none;
    }
  }
</style>
