<script lang="ts">
  import type { MenuItem } from '../core/menu'
  import { app } from '../instance'
  import ContextMenu from './ContextMenu.svelte'

  let { x, y, items, onclose, nested = false }: { x: number; y: number; items: MenuItem[]; onclose: () => void; nested?: boolean } = $props()

  let el: HTMLElement
  // Where the menu really goes: moved up or left if it would not fit on the screen.
  // svelte-ignore state_referenced_locally
  let at = $state({ left: x, top: y, ready: false })
  let sub = $state<{ index: number; x: number; y: number; left: number } | null>(null)

  $effect(() => {
    const box = el.getBoundingClientRect()
    const margin = 6
    let left = x
    let top = y
    // A submenu that does not fit to the right opens to the left of its parent.
    if (left + box.width > innerWidth - margin) left = nested ? Math.max(margin, x - box.width - 2 * (x - (sub?.left ?? x))) : innerWidth - box.width - margin
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
</script>

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
    <ContextMenu x={sub.x} y={sub.y} items={items[sub.index].submenu ?? []} {onclose} nested />
  {/key}
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    max-width: 320px;
    max-height: calc(100vh - 12px);
    padding: 6px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
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
    gap: 8px;
    padding: 5px 8px;
    border-radius: 5px;
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
    width: 16px;
    height: 16px;
    color: var(--text-muted);
    font-size: 16px;
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

  hr {
    width: calc(100% + 12px);
    margin: 5px -6px;
    border: none;
    border-top: 1px solid var(--border);
  }
</style>
