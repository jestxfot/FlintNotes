<script lang="ts">
  import type { MenuItem } from '../core/menu'
  import { app } from '../instance'
  import ContextMenu from './ContextMenu.svelte'
  import { layout } from './layout.svelte'
  import Sheet from './Sheet.svelte'

  let { x, y, items, onclose, nested = false, parentLeft = x }: { x: number; y: number; items: MenuItem[]; onclose: () => void; nested?: boolean; /** The left edge of the row a submenu belongs to. */ parentLeft?: number } = $props()

  // svelte-ignore non_reactive_update (bound once, in whichever form the menu takes)
  let el: HTMLElement
  // Where the menu really goes: moved up or left if it would not fit on the screen.
  // svelte-ignore state_referenced_locally
  let at = $state({ left: x, top: y, ready: false })
  let sub = $state<{ index: number; x: number; y: number; left: number } | null>(null)

  $effect(() => {
    if (sheet) return
    const box = el.getBoundingClientRect()
    const margin = 6
    let left = x
    let top = y
    // A submenu that does not fit to the right opens to the left of its parent.
    if (left + box.width > innerWidth - margin) left = nested ? Math.max(margin, parentLeft - box.width + 2) : innerWidth - box.width - margin
    if (top + box.height > innerHeight - margin) top = Math.max(margin, innerHeight - box.height - margin)
    at = { left: Math.max(margin, left), top, ready: true }
  })

  function icon(node: HTMLElement, name: string | undefined) {
    if (name) node.append(app.icons.draw(name))
  }

  function open(index: number, event: MouseEvent) {
    const item = items[index]
    if (!item.submenu) return void (sub = null)
    const row = (event.currentTarget as HTMLElement).getBoundingClientRect()
    sub = { index, x: row.right - 2, y: row.top - 5, left: row.left }
  }

  function choose(item: MenuItem) {
    if (item.disabled || item.submenu) return
    onclose()
    item.onClick?.()
  }

  // On a phone the menu is a sheet from the bottom, and a submenu takes its place, with a way back.
  // svelte-ignore state_referenced_locally (a menu keeps its form while it is open)
  const sheet = layout.mobile && !nested
  let trail = $state<MenuItem[]>([])
  const shown = $derived(trail.length ? (trail[trail.length - 1].submenu ?? []) : items)
  function tap(item: MenuItem) {
    if (item.disabled) return
    if (item.submenu) trail = [...trail, item]
    else choose(item)
  }
</script>

{#if sheet}
  <Sheet label="Меню" {onclose}>
    {#snippet header()}
      {#if trail.length}
        <button class="sheet-back" onclick={() => (trail = trail.slice(0, -1))}><span class="sheet-arrow">‹</span>{trail[trail.length - 1].title}</button>
      {/if}
    {/snippet}
    <div class="sheet-menu" role="menu" tabindex="-1" oncontextmenu={(event) => event.preventDefault()}>
      {#each shown as item, i (i)}
        {#if i > 0 && (item.section ?? 'action') !== (shown[i - 1].section ?? 'action')}
          <hr />
        {/if}
        <button role="menuitem" class:danger={item.danger} disabled={item.disabled} onclick={() => tap(item)}>
          <span class="menu-icon" use:icon={item.icon}></span>
          <span class="menu-title">{item.title}</span>
          {#if item.submenu}<span class="menu-arrow">›</span>{/if}
        </button>
      {/each}
    </div>
  </Sheet>
{:else}

<div
  class="menu"
  class:ready={at.ready}
  role="menu"
  tabindex="-1"
  bind:this={el}
  style:left="{at.left}px"
  style:top="{at.top}px"
  onclick={(event) => event.stopPropagation()}
  onkeydown={(event) => event.key === 'Escape' && onclose()}
  oncontextmenu={(event) => event.preventDefault()}
>
  {#each items as item, i (i)}
    {#if i > 0 && (item.section ?? 'action') !== (items[i - 1].section ?? 'action')}
      <hr />
    {/if}
    <button role="menuitem" class:danger={item.danger} class:open={sub?.index === i} disabled={item.disabled} onmouseenter={(event) => open(i, event)} onclick={() => choose(item)}>
      <span class="menu-icon" use:icon={item.icon}></span>
      <span class="menu-title">{item.title}</span>
      {#if item.submenu}<span class="menu-arrow">›</span>{/if}
    </button>
  {/each}
</div>
{#if sub && items[sub.index]?.submenu}
  {#key sub.index}
    <ContextMenu x={sub.x} y={sub.y} items={items[sub.index].submenu ?? []} {onclose} nested parentLeft={sub.left} />
  {/key}
{/if}
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    max-width: 380px;
    max-height: calc(100vh - 12px);
    padding: 4px;
    font-family: var(--font-ui, inherit);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.35;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--bg-alt);
    box-shadow: var(--shadow);
    visibility: hidden;
  }

  .menu.ready {
    visibility: visible;
  }

  button {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 4px 9px;
    border-radius: 5px;
    font-size: inherit;
    text-align: left;
  }

  button:hover:not(:disabled),
  button.open {
    background: var(--bg-hover);
  }

  button:disabled {
    color: var(--text-faint);
    cursor: default;
  }

  button.danger {
    color: var(--color-red);
  }

  .menu-icon {
    display: flex;
    flex: none;
    width: 15px;
    height: 15px;
    color: var(--text-muted);
    font-size: 15px;
  }

  .danger .menu-icon {
    color: inherit;
  }

  .menu-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-arrow {
    color: var(--text-faint);
  }

  .sheet-menu {
    display: flex;
    flex-direction: column;
    font-size: 16px;
  }

  .sheet-menu button {
    gap: 14px;
    min-height: 48px;
    padding: 0 14px;
    border-radius: 12px;
  }

  .sheet-menu button:hover:not(:disabled) {
    background: none;
  }

  .sheet-menu button:active:not(:disabled) {
    background: var(--bg-hover);
  }

  .sheet-menu .menu-icon {
    width: 20px;
    height: 20px;
    font-size: 20px;
  }

  .sheet-menu hr {
    width: auto;
    margin: 4px 12px;
  }

  .sheet-back {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 8px 6px;
    padding: 8px 10px;
    color: var(--accent);
    font-size: 16px;
    font-weight: 600;
  }

  .sheet-arrow {
    font-size: 24px;
    line-height: 16px;
  }

  hr {
    width: calc(100% + 8px);
    margin: 4px -4px;
    border: none;
    border-top: 1px solid var(--border);
  }
</style>
