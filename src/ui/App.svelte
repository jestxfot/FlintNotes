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
  import { drag } from './drag.svelte'
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
  const hasRightPanels = watch(app.panels, ['change'], () => app.panels.has('right'))
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

  // Ctrl+wheel resizes the note's text, like in a text editor, instead of zooming the whole page.
  let wheel = 0
  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    // A mouse wheel sends one big step per notch, a touchpad many small ones.
    wheel += event.deltaY
    if (Math.abs(wheel) < 40) return
    const size = settings.get<number>('core', 'fontSize') + (wheel < 0 ? 1 : -1)
    wheel = 0
    settings.set('core', 'fontSize', Math.min(32, Math.max(10, size)))
  }

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
        if (app.panels.sideOf(id) === 'left') leftOpen = true
        else rightOpen = true
      }),
      app.panels.add({
        id: 'files',
        title: 'Файлы',
        side: 'left',
        icon: 'M2 4.5h4l1.5 1.5H14v6.5H2z',
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
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      void workspace.flushAll(true)
      void app.state.flush(true)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('visibilitychange', onHide)
    return () => {
      offs.forEach((off) => off())
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', onWheel)
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
              draggable={!tab.path.startsWith('view:')}
              ondragstart={(event) => {
                event.dataTransfer?.setData('text/plain', tab.path)
                // The sidebars change to show where the note can go; Chrome cancels a drag
                // whose surroundings change while it is starting. So: a moment later.
                setTimeout(() => (drag.note = tab.path))
              }}
              ondragend={() => (drag.note = null)}
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

  <!-- An empty right sidebar appears while a widget is dragged, so it can be dropped there. -->
  {#if rightOpen && (hasRightPanels.current || drag.panel || drag.note)}
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
