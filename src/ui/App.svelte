<script lang="ts">
  import { onMount } from 'svelte'
  import { errorMessage } from '../core/notice'
  import { basename, extname, stripExt } from '../core/path'
  import { app } from '../instance'
  import CommandPalette from './CommandPalette.svelte'
  import FileTree from './FileTree.svelte'
  import { watch } from './reactive.svelte'
  import SettingsModal from './SettingsModal.svelte'

  let settingsOpen = $state(false)
  let paletteOpen = $state(false)
  let sidebarOpen = $state(true)

  const { workspace, settings } = app
  const tabs = watch(workspace, ['layout-change'], () => workspace.leaves.map(({ id, path }) => ({ id, path })))
  const activeId = watch(workspace, ['active-change'], () => workspace.active?.id ?? null)
  const theme = watch(settings, ['change'], () => settings.get<string>('core', 'theme'))
  const fontSize = watch(settings, ['change'], () => settings.get<number>('core', 'fontSize'))
  const readableWidth = watch(settings, ['change'], () => settings.get<boolean>('core', 'readableWidth'))

  const root = document.documentElement
  $effect(() => {
    if (theme.current === 'system') delete root.dataset.theme
    else root.dataset.theme = theme.current
  })
  $effect(() => {
    root.style.setProperty('--editor-font-size', `${fontSize.current}px`)
  })
  $effect(() => {
    root.classList.toggle('wide', !readableWidth.current)
  })

  const title = (path: string) => (extname(path) === 'md' ? stripExt(basename(path)) : basename(path))
  const leafById = (id: number) => workspace.leaves.find((leaf) => leaf.id === id)!

  async function newNote() {
    try {
      const entry = await app.vault.create(app.vault.uniquePath('', 'Без названия', 'md'))
      workspace.openFile(entry.path)
    } catch (err) {
      app.notice(`Не удалось создать заметку: ${errorMessage(err)}`)
    }
  }

  /** Places an element owned by the core inside this component's markup. */
  function host(node: HTMLElement, child: HTMLElement) {
    node.append(child)
    return { destroy: () => child.remove() }
  }

  onMount(() => {
    const offs = [
      app.commands.add({
        id: 'core:command-palette',
        name: 'Палитра команд',
        hotkey: 'Mod+P',
        callback: () => (paletteOpen = true),
      }),
      app.commands.add({
        id: 'core:settings',
        name: 'Открыть настройки',
        hotkey: 'Mod+Comma',
        callback: () => (settingsOpen = true),
      }),
      app.commands.add({
        id: 'core:toggle-sidebar',
        name: 'Показать или скрыть боковую панель',
        hotkey: 'Mod+Backslash',
        callback: () => (sidebarOpen = !sidebarOpen),
      }),
      app.commands.add({ id: 'core:new-note', name: 'Новая заметка', hotkey: 'Alt+N', callback: newNote }),
      app.commands.add({
        id: 'core:close-tab',
        name: 'Закрыть вкладку',
        hotkey: 'Alt+W',
        callback: () => workspace.active && workspace.close(workspace.active),
      }),
      app.commands.add({
        id: 'core:save',
        name: 'Сохранить сейчас',
        hotkey: 'Mod+S',
        callback: () => workspace.flushAll(),
      }),
    ]
    // Capture phase: app shortcuts take priority over the focused editor's keymap.
    const onKey = (event: KeyboardEvent) => void app.commands.handleKey(event)
    const onHide = () => document.visibilityState === 'hidden' && workspace.flushAll(true)
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      offs.forEach((off) => off())
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('visibilitychange', onHide)
    }
  })
</script>

<div class="app">
  {#if sidebarOpen}
    <aside class="sidebar">
      <FileTree />
      <button class="sidebar-footer" onclick={() => (settingsOpen = true)}>Настройки</button>
    </aside>
  {/if}

  <main>
    {#if tabs.current.length}
      <div class="tabs" role="tablist">
        {#each tabs.current as tab (tab.id)}
          <div class="tab" class:active={tab.id === activeId.current}>
            <button
              class="tab-title"
              role="tab"
              aria-selected={tab.id === activeId.current}
              title={tab.path}
              onclick={() => workspace.setActive(leafById(tab.id))}
              onauxclick={(event) => event.button === 1 && workspace.close(leafById(tab.id))}
            >
              {title(tab.path)}
            </button>
            <button class="tab-close" aria-label="Закрыть вкладку" onclick={() => workspace.close(leafById(tab.id))}>
              ×
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="content" use:host={workspace.containerEl}>
      {#if !tabs.current.length}
        <div class="empty">
          <p>Откройте заметку в боковой панели</p>
          <button onclick={newNote}>Новая заметка <kbd>Alt+N</kbd></button>
          <button onclick={() => (paletteOpen = true)}>Палитра команд <kbd>Ctrl+P</kbd></button>
        </div>
      {/if}
    </div>

    <div use:host={app.statusBar.el}></div>
  </main>
</div>

{#if settingsOpen}
  <SettingsModal onclose={() => (settingsOpen = false)} />
{/if}
{#if paletteOpen}
  <CommandPalette onclose={() => (paletteOpen = false)} />
{/if}

<style>
  .app {
    display: flex;
    height: 100%;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    flex: 0 0 260px;
    min-width: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-alt);
  }

  .sidebar-footer {
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    text-align: left;
  }

  .sidebar-footer:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .tabs {
    display: flex;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    background: var(--bg-alt);
    scrollbar-width: none;
  }

  .tab {
    display: flex;
    align-items: center;
    flex: 0 1 200px;
    min-width: 90px;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
  }

  .tab.active {
    background: var(--bg);
    color: var(--text);
  }

  .tab-title {
    flex: 1;
    min-width: 0;
    padding: 7px 4px 7px 12px;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-close {
    margin-right: 6px;
    padding: 0 5px;
    border-radius: 4px;
    color: var(--text-faint);
    font-size: 16px;
    line-height: 20px;
  }

  .tab-close:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .content {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-muted);
  }

  .empty button {
    color: var(--accent);
  }

  kbd {
    margin-left: 6px;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font: 11px var(--font-mono);
  }
</style>
