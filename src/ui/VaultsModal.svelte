<script lang="ts">
  import { onMount } from 'svelte'
  import type { DirListing } from '../../shared/protocol'
  import { errorMessage } from '../core/notice'
  import { vaultAddress, type VaultInfo } from '../core/vault'
  import { app } from '../instance'

  let { onclose }: { onclose: () => void } = $props()

  let dialog: HTMLDialogElement
  let vaults = $state.raw<VaultInfo[]>([])
  let folder = $state('')
  let error = $state('')
  /** The folder being looked at on the server's disk; null while the chooser is closed. */
  let listing = $state.raw<DirListing | null>(null)
  let newFolder = $state('')
  // On the server's own computer a path may be typed; from the Windows app or a phone folders are only chosen.
  const typing = app.vault.tier === 'admin'

  // The server is Linux: a full path starts with a slash.
  const isAbsolute = (path: string) => path.startsWith('/')

  async function open(path: string, create = false) {
    error = ''
    if (!isAbsolute(path)) {
      error = 'Укажите полный путь к папке, например /var/lib/flintnotes/vaults/Заметки'
      return
    }
    try {
      await app.workspace.flushAll()
      // A vault is a place of its own: the page goes to its address.
      const vault = await app.vault.openVault(path, create)
      location.href = vaultAddress(vault.name)
    } catch (err) {
      const message = errorMessage(err)
      // A folder that does not exist yet can become a new, empty vault.
      if (message === 'Такой папки нет' && confirm(`Папки «${path}» нет. Создать её как новое хранилище?`)) return open(path, true)
      error = message
    }
  }

  async function forget(vault: VaultInfo) {
    try {
      vaults = await app.vault.forgetVault(vault.path)
    } catch (err) {
      error = errorMessage(err)
    }
  }

  /** Shows the folders under `path` (the roots with none given). */
  async function browse(path?: string) {
    error = ''
    try {
      listing = await app.vault.dirs(path)
    } catch (err) {
      error = errorMessage(err)
    }
  }

  const here = $derived(listing?.path ?? null)

  onMount(async () => {
    dialog.showModal()
    vaults = await app.vault.vaults().catch(() => [])
  })
</script>

<dialog bind:this={dialog} {onclose} onclick={(event) => event.target === dialog && dialog.close()} aria-label="Хранилища">
  <button class="close" aria-label="Закрыть" onclick={() => dialog.close()}>×</button>
  <h2>Хранилища</h2>
  <p class="hint">Хранилище — обычная папка с заметками на сервере. Здесь перечислены папки, которые вы уже открывали.</p>

  <div class="list">
    {#each vaults as vault (vault.path)}
      <div class="vault" class:current={vault.current}>
        <div class="info">
          <span class="name">{vault.name}</span>
          <span class="path">{vault.path}{vault.exists ? '' : ' — папка не найдена'}</span>
        </div>
        {#if vault.current}
          <span class="badge">открыто</span>
        {:else}
          <button disabled={!vault.exists} onclick={() => open(vault.path)}>Открыть</button>
          <button title="Убрать из списка. Папка и заметки останутся на диске" onclick={() => forget(vault)}>Забыть</button>
        {/if}
      </div>
    {/each}
  </div>

  <div class="chooser">
    <span class="label">Открыть другую папку как хранилище</span>
    {#if !listing}
      <button class="choose" onclick={() => browse()}>Выбрать папку на сервере…</button>
    {:else}
      <div class="where">
        <button class="up" disabled={here === null} onclick={() => browse(listing?.parent ?? undefined)} title="Выше" aria-label="Выше">↑</button>
        <span class="here">{here ?? 'Папки для хранилищ'}</span>
        {#if here}<button class="primary" onclick={() => open(here)}>Открыть эту папку</button>{/if}
      </div>
      <div class="folders">
        {#each listing.dirs as dir (dir.path)}
          <div class="folder">
            <button class="enter" onclick={() => browse(dir.path)}>{dir.name}</button>
            {#if dir.vault}<button onclick={() => open(dir.path)}>Открыть как хранилище</button>{/if}
          </div>
        {:else}
          <p class="empty">Здесь нет вложенных папок</p>
        {/each}
      </div>
      {#if here}
        <form
          class="row"
          onsubmit={(event) => {
            event.preventDefault()
            if (newFolder.trim()) void open(`${here.replace(/\/$/, '')}/${newFolder.trim()}`, true)
          }}
        >
          <input aria-label="Имя новой папки" placeholder="Новая папка для нового хранилища" bind:value={newFolder} />
          <button disabled={!newFolder.trim()}>Создать</button>
        </form>
      {/if}
    {/if}
  </div>

  {#if typing}
    <form
      onsubmit={(event) => {
        event.preventDefault()
        if (folder.trim()) void open(folder.trim())
      }}
    >
      <label for="vault-folder">Или укажите путь к папке</label>
      <div class="row">
        <input id="vault-folder" placeholder="Полный путь, например /home/me/notes" bind:value={folder} />
        <button class="primary" disabled={!folder.trim()}>Открыть</button>
      </div>
    </form>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
</dialog>

<style>
  dialog {
    width: min(620px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 20px 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    background: var(--bg);
    color: var(--text);
    box-shadow: var(--shadow);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 18px;
  }

  .hint {
    margin: 0 0 12px;
    color: var(--text-muted);
  }

  .close {
    position: absolute;
    top: 10px;
    right: 12px;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-m);
    color: var(--text-muted);
    font-size: 20px;
  }

  .list {
    display: flex;
    flex-direction: column;
    margin-bottom: 16px;
  }

  .vault {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    border-top: 1px solid var(--border);
  }

  .info {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-weight: 600;
  }

  .path {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    color: var(--accent);
    font-size: 13px;
  }

  button:not(.close) {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
  }

  button:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  label {
    display: block;
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--bg);
  }

  .chooser {
    margin-bottom: 16px;
  }

  .chooser .label {
    display: block;
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .where {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .here {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folders {
    max-height: 220px;
    margin-bottom: 8px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
  }

  .folder {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 6px;
  }

  .folder .enter {
    flex: 1;
    border: 0 !important;
    text-align: left;
  }

  .empty {
    margin: 10px;
    color: var(--text-muted);
  }

  .primary {
    border-color: var(--accent) !important;
    background: var(--accent);
    color: var(--accent-text);
  }

  .error {
    margin: 8px 0 0;
    color: #d0342c;
  }
</style>
