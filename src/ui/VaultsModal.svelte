<script lang="ts">
  import { onMount } from 'svelte'
  import { errorMessage } from '../core/notice'
  import type { VaultInfo } from '../core/vault'
  import { app } from '../instance'

  let { onclose }: { onclose: () => void } = $props()

  let dialog: HTMLDialogElement
  let vaults = $state.raw<VaultInfo[]>([])
  let folder = $state('')
  let error = $state('')

  // `/home/me/notes`, `D:\Notes` or a network path `\\server\share`.
  const isAbsolute = (path: string) => /^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(path)

  async function open(path: string, create = false) {
    error = ''
    if (!isAbsolute(path)) {
      error = 'Укажите полный путь к папке, например D:\\Заметки'
      return
    }
    try {
      await app.workspace.flushAll()
      // The page reloads by itself once the server has switched.
      await app.vault.openVault(path, create)
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

  onMount(async () => {
    dialog.showModal()
    vaults = await app.vault.vaults().catch(() => [])
  })
</script>

<dialog bind:this={dialog} {onclose} onclick={(event) => event.target === dialog && dialog.close()} aria-label="Хранилища">
  <button class="close" aria-label="Закрыть" onclick={() => dialog.close()}>×</button>
  <h2>Хранилища</h2>
  <p class="hint">Хранилище — обычная папка с заметками. Здесь перечислены папки, которые вы уже открывали.</p>

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

  <form
    onsubmit={(event) => {
      event.preventDefault()
      if (folder.trim()) void open(folder.trim())
    }}
  >
    <label for="vault-folder">Открыть другую папку как хранилище</label>
    <div class="row">
      <input id="vault-folder" placeholder="Полный путь, например D:\Заметки" bind:value={folder} />
      <button class="primary" disabled={!folder.trim()}>Открыть</button>
    </div>
    {#if error}<p class="error">{error}</p>{/if}
  </form>
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
