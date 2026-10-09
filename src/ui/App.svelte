<script lang="ts">
  import { mount, onMount, unmount } from 'svelte'
  import { formatHotkey, type Command } from '../core/commands'
  import { errorMessage } from '../core/notice'
  import { basename, extname, stripExt } from '../core/path'
  import { app } from '../instance'
  import FileTree from './FileTree.svelte'
  import HelpModal from './HelpModal.svelte'
  import MainMenu from './MainMenu.svelte'
  import VaultsModal from './VaultsModal.svelte'
  import { watch } from './reactive.svelte'
  import SettingsModal from './SettingsModal.svelte'
  import Sidebar from './Sidebar.svelte'
  import SuggestModal from './SuggestModal.svelte'
  import type { SuggestOptions } from '../core/suggest'

  let settingsOpen = $state(false)
  let vaultsOpen = $state(false)
  let helpOpen = $state(false)
  let suggest = $state.raw<SuggestOptions<any> | null>(null)
  let leftOpen = $state(true)
  let rightOpen = $state(true)

  const { workspace, settings } = app
  const tabs = watch(workspace, ['layout-change'], () => workspace.leaves.map(({ id, path, title }) => ({ id, path, title })))
  const activeId = watch(workspace, ['active-change'], () => workspace.active?.id ?? null)
  const hasRightPanels = watch(app.panels, ['change'], () => app.panels.list('right').length > 0)
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

  function openPalette() {
    const commands = app.commands.list().sort((a, b) => a.name.localeCompare(b.name))
    app.suggest<Command>({
      placeholder: 'Команда…',
      items: (query) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean)
        return commands.filter((c) => words.every((word) => c.name.toLowerCase().includes(word)))
      },
      label: (command) => command.name,
      detail: (command) => command.hotkey && formatHotkey(command.hotkey),
      onChoose: (command) => command.callback(),
    })
  }

  /** Places an element owned by the core inside this component's markup. */
  function host(node: HTMLElement, child: HTMLElement) {
    node.append(child)
    return { destroy: () => child.remove() }
  }

  onMount(() => {
    const offs = [
      app.ui.on('suggest', (options) => (suggest = options)),
      app.panels.on('reveal', (id) => {
        if (app.panels.list('left').some((p) => p.def.id === id)) leftOpen = true
        else rightOpen = true
      }),
      app.panels.add({
        id: 'files',
        title: 'Файлы',
        side: 'left',
        mount: (target) => {
          const tree = mount(FileTree, { target })
          return () => void unmount(tree)
        },
      }),
      app.commands.add({
        id: 'core:command-palette',
        name: 'Палитра команд',
        hotkey: 'Mod+P',
        callback: openPalette,
      }),
      app.commands.add({
        id: 'core:settings',
        name: 'Открыть настройки',
        hotkey: 'Mod+Comma',
        callback: () => (settingsOpen = true),
      }),
      app.commands.add({
        id: 'core:toggle-sidebar',
        name: 'Показать или скрыть левую панель',
        hotkey: 'Mod+Backslash',
        callback: () => (leftOpen = !leftOpen),
      }),
      app.commands.add({
        id: 'core:toggle-right-sidebar',
        name: 'Показать или скрыть правую панель',
        hotkey: 'Mod+Shift+Backslash',
        callback: () => (rightOpen = !rightOpen),
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
        callback: () => void workspace.flushAll(),
      }),
    ]
    // Capture phase: app shortcuts take priority over the focused editor's keymap.
    const onKey = (event: KeyboardEvent) => void app.commands.handleKey(event)
    const onHide = () => document.visibilityState === 'hidden' && void workspace.flushAll(true)
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
  {#if leftOpen}
    <Sidebar side="left">
      {#snippet footer()}
        <MainMenu onvaults={() => (vaultsOpen = true)} onhelp={() => (helpOpen = true)} onsettings={() => (settingsOpen = true)} />
      {/snippet}
    </Sidebar>
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
              title={tab.title ?? tab.path}
              onclick={() => workspace.setActive(leafById(tab.id))}
              onauxclick={(event) => event.button === 1 && workspace.close(leafById(tab.id))}
            >
              {tab.title ?? title(tab.path)}
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
          <button onclick={openPalette}>Палитра команд <kbd>Ctrl+P</kbd></button>
        </div>
      {/if}
    </div>

    <div use:host={app.statusBar.el}></div>
  </main>

  {#if rightOpen && hasRightPanels.current}
    <Sidebar side="right" />
  {/if}
</div>

{#if settingsOpen}
  <SettingsModal onclose={() => (settingsOpen = false)} />
{/if}
{#if vaultsOpen}
  <VaultsModal onclose={() => (vaultsOpen = false)} />
{/if}
{#if helpOpen}
  <HelpModal onclose={() => (helpOpen = false)} />
{/if}
{#if suggest}
  {#key suggest}
    <SuggestModal options={suggest} onclose={() => (suggest = null)} />
  {/key}
{/if}

<style>
  .app {
    display: flex;
    height: 100%;
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
