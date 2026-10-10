<script lang="ts">
  import { errorMessage } from '../core/notice'
  import { vaultAddress, type VaultInfo } from '../core/vault'
  import { app } from '../instance'

  let { onvaults, onhelp, onsettings }: { onvaults: () => void; onhelp: () => void; onsettings: () => void } = $props()

  let open = $state(false)
  let vaults = $state.raw<VaultInfo[]>([])

  async function toggle() {
    open = !open
    if (open) vaults = await app.vault.vaults().catch(() => [])
  }

  async function switchTo(vault: VaultInfo) {
    open = false
    if (vault.current) return
    try {
      // Unsaved text belongs to the vault that is being left.
      await app.workspace.flushAll()
      location.href = vaultAddress(vault.name)
    } catch (err) {
      app.notice(`Не удалось открыть «${vault.name}»: ${errorMessage(err)}`)
    }
  }
</script>

<svelte:window
  onclick={(event) => !(event.target as Element).closest('.main-menu') && (open = false)}
  onkeydown={(event) => event.key === 'Escape' && (open = false)}
/>

<!-- The app's main menu, at the bottom of the left sidebar: vaults, help, settings. -->
<div class="main-menu">
  {#if open}
    <div class="popup" role="menu">
      {#each vaults as vault (vault.path)}
        <button role="menuitem" title={vault.path} disabled={!vault.exists} onclick={() => switchTo(vault)}>
          <span class="name">{vault.name}</span>
          {#if vault.current}<span class="check">✓</span>{/if}
        </button>
      {/each}
      <hr />
      <button
        role="menuitem"
        onclick={() => {
          open = false
          onvaults()
        }}
      >
        Управление хранилищами…
      </button>
    </div>
  {/if}

  <button class="vault" aria-haspopup="menu" aria-expanded={open} title={app.vault.path} onclick={toggle}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6l3-3 3 3M5 10l3 3 3-3" /></svg>
    <span class="name">{app.vault.name}</span>
  </button>
  <button class="icon" title="Справка" aria-label="Справка" onclick={onhelp}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" /><path d="M6.4 6.3a1.7 1.7 0 1 1 2.5 1.5c-.6.3-.9.7-.9 1.4M8 11.4v.1" />
    </svg>
  </button>
  <button class="icon" title="Настройки" aria-label="Настройки" onclick={onsettings}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </svg>
  </button>
</div>

<style>
  .main-menu {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px;
    border-top: 1px solid var(--border);
  }

  button {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: var(--radius-m);
    color: var(--text-muted);
  }

  button:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .vault {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    font-weight: 600;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon {
    flex: none;
    justify-content: center;
    width: 28px;
    height: 28px;
  }

  svg {
    flex: none;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .popup {
    position: absolute;
    bottom: calc(100% - 2px);
    left: 6px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 220px;
    max-width: 320px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-l);
    background: var(--bg);
    box-shadow: var(--shadow);
  }

  .popup button {
    padding: 6px 10px;
    color: var(--text);
  }

  .check {
    color: var(--accent);
  }

  hr {
    width: 100%;
    margin: 4px 0;
    border: none;
    border-top: 1px solid var(--border);
  }
</style>
