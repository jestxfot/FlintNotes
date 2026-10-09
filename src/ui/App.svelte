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
  import ContextMenu from './ContextMenu.svelte'
  import Toolbar from './Toolbar.svelte'
  import { drag } from './drag.svelte'
  import { watch } from './reactive.svelte'
  import SettingsModal from './SettingsModal.svelte'
  import Sidebar from './Sidebar.svelte'
  import SuggestModal from './SuggestModal.svelte'
  import type { SuggestOptions } from '../core/suggest'
  import type { MenuItem } from '../core/menu'

  let settingsOpen = $state(false)
  let vaultsOpen = $state(false)
  let helpOpen = $state(false)
  let menu = $state.raw<{ x: number; y: number; items: MenuItem[] } | null>(null)
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
  const inlineTitle = watch(settings, ['change'], () => settings.get<boolean>('core', 'inlineTitle'))
  /** Folders and name of the open file, for the path shown above it. */
  const crumbs = watch(workspace, ['active-change', 'layout-change'], () => {
    const path = workspace.active?.path
    if (!path || path.startsWith('view:')) return workspace.active?.title ? [workspace.active.title] : []
    const parts = path.split('/')
    return [...parts.slice(0, -1), title(parts[parts.length - 1])]
  })

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
  $effect(() => {
    root.classList.toggle('no-inline-title', !inlineTitle.current)
  })

  const title = (path: string) => (extname(path) === 'md' ? stripExt(basename(path)) : basename(path))
  const leafById = (id: number) => workspace.leaves.find((leaf) => leaf.id === id)!
  // The strips along the edges take room only when something was put on them.
  const ribbons = watch(app.toolbars, ['change'], () => ({ left: app.toolbars.list('left-ribbon').length > 0, right: app.toolbars.list('right-ribbon').length > 0 }))
  const looks = watch(app.icons, ['change'], () => ({}))
  const tabLook = (path: string) => (looks.current && !path.startsWith('view:') ? app.icons.look('file', path) : undefined)
  function drawIcon(node: HTMLElement, icon: string | undefined) {
    if (icon) node.append(app.icons.draw(icon))
  }

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

  const stepFont = (by: number) => settings.set('core', 'fontSize', Math.min(32, Math.max(10, settings.get<number>('core', 'fontSize') + by)))
  /** Runs `action` for the open file, if a file is open. */
  function withFile(action: (path: string) => unknown) {
    const path = workspace.active?.path
    if (path && !path.startsWith('view:')) action(path)
    else app.notice('Откройте файл')
  }
  function stepTab(by: number) {
    const { leaves, active } = workspace
    if (leaves.length > 1 && active) workspace.setActive(leaves[(leaves.indexOf(active) + by + leaves.length) % leaves.length])
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
      detail: (command) => {
        const hotkey = app.commands.hotkeyOf(command)
        return hotkey && formatHotkey(hotkey)
      },
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
      // Every action of the frame is a command, so it can be bound to a shortcut or a button.
      ...(
        [
          ['core:go-back', 'Назад', 'arrow-left', () => history.back()],
          ['core:go-forward', 'Вперёд', 'arrow-right', () => history.forward()],
          ['core:help', 'Справка и сочетания клавиш', 'circle-help', () => (helpOpen = true)],
          ['core:vaults', 'Управление хранилищами', 'vault', () => (vaultsOpen = true)],
          ['core:next-tab', 'Следующая вкладка', 'chevron-right', () => stepTab(1)],
          ['core:previous-tab', 'Предыдущая вкладка', 'chevron-left', () => stepTab(-1)],
          ['core:close-other-tabs', 'Закрыть остальные вкладки', 'copy-x', () => workspace.leaves.filter((leaf) => leaf !== workspace.active).forEach((leaf) => workspace.close(leaf))],
          ['core:close-all-tabs', 'Закрыть все вкладки', 'square-x', () => [...workspace.leaves].forEach((leaf) => workspace.close(leaf))],
          ['core:reveal-active', 'Показать открытый файл в проводнике', 'arrow-up-right', () => withFile((path) => void app.vault.reveal(path).catch((err) => app.notice(errorMessage(err))))],
          ['core:reveal-vault', 'Показать папку хранилища в проводнике', 'folder-open', () => void app.vault.reveal('').catch((err) => app.notice(errorMessage(err)))],
          ['core:copy-path', 'Копировать путь открытого файла', 'clipboard', () => withFile((path) => void navigator.clipboard.writeText(path).then(() => app.notice('Скопировано')))],
          ['core:rename-active', 'Переименовать открытую заметку', 'pencil', () => document.querySelector<HTMLInputElement>('.leaf:not([hidden]) .inline-title')?.select()],
          ['core:delete-active', 'Удалить открытый файл', 'trash', () => withFile((path) => confirm(`Переместить «${basename(path)}» в корзину?`) && void app.vault.trash(path).catch((err) => app.notice(errorMessage(err))))],
          ['core:dock-active', 'Перенести открытую заметку в боковую панель', 'panel-right', () => withFile((path) => app.docked.dock(path, 'right'))],
          ['core:toggle-theme', 'Переключить светлую и тёмную тему', 'sun-moon', () => settings.set('core', 'theme', (root.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark')],
          ['core:font-bigger', 'Увеличить шрифт заметки', 'a-arrow-up', () => stepFont(1)],
          ['core:font-smaller', 'Уменьшить шрифт заметки', 'a-arrow-down', () => stepFont(-1)],
          ['core:toggle-readable-width', 'Переключить удобную ширину строки', 'chevrons-left-right', () => settings.set('core', 'readableWidth', !settings.get<boolean>('core', 'readableWidth'))],
        ] as [string, string, string, () => unknown][]
      ).map(([id, name, icon, callback]) => app.commands.add({ id, name, icon, callback: () => void callback() })),
    ]
    // Capture phase: app shortcuts take priority over the focused editor's keymap.
    const onKey = (event: KeyboardEvent) => void app.commands.handleKey(event)
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      void workspace.flushAll(true)
      void app.state.flush(true)
    }
    offs.push(app.menus.on('show', (shown) => (menu = shown)))
    const closeMenu = () => (menu = null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    offs.push(() => (window.removeEventListener('click', closeMenu), window.removeEventListener('blur', closeMenu)))
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
  {#if ribbons.current.left}<Toolbar place="left-ribbon" vertical />{/if}
  {#if leftOpen}
    <Sidebar side="left">
      {#snippet footer()}
        <MainMenu onvaults={() => (vaultsOpen = true)} onhelp={() => (helpOpen = true)} onsettings={() => (settingsOpen = true)} />
      {/snippet}
    </Sidebar>
  {/if}

  <main>
    <div class="tabbar">
      <button class="bar-button" title="Левая панель" aria-label="Левая панель" aria-pressed={leftOpen} onclick={() => (leftOpen = !leftOpen)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" /><path d="M6 2.5v11" /></svg>
      </button>
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
              {#key tabLook(tab.path)?.icon}
                {#if tabLook(tab.path)?.icon}<span class="tab-icon" style:color={app.icons.css(tabLook(tab.path)?.color)} use:drawIcon={tabLook(tab.path)?.icon}></span>{/if}
              {/key}
              {tab.title ?? title(tab.path)}
            </button>
            <button class="tab-close" aria-label="Закрыть вкладку" onclick={() => workspace.close(leafById(tab.id))}>
              ×
            </button>
          </div>
        {/each}
        <button class="bar-button" title="Создать заметку" aria-label="Создать заметку" onclick={newNote}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </button>
      </div>
      <Toolbar place="tab-bar" />
      <button class="bar-button" title="Правая панель" aria-label="Правая панель" aria-pressed={rightOpen} onclick={() => (rightOpen = !rightOpen)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" /><path d="M10 2.5v11" /></svg>
      </button>
    </div>
    {#if crumbs.current.length}
      <div class="view-header">
        <button class="bar-button" title="Назад" aria-label="Назад" onclick={() => history.back()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8H3M7 4L3 8l4 4" /></svg>
        </button>
        <button class="bar-button" title="Вперёд" aria-label="Вперёд" onclick={() => history.forward()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
        </button>
        <div class="crumbs">
          {#each crumbs.current as part, i (i)}
            {#if i}<span class="sep">/</span>{/if}
            <span class:last={i === crumbs.current.length - 1}>{part}</span>
          {/each}
        </div>
        <Toolbar place="page-header" />
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
  {#if ribbons.current.right}<Toolbar place="right-ribbon" vertical />{/if}
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
{#if menu}
  {#key menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
  {/key}
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
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  /* The strip of tabs, as in Obsidian: a darker band with no lines in it. The
     open tab is a piece of the page rising into the band, joined to the page
     by small inward curves; the other tabs are plain text set apart by hairlines. */
  .tabbar {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 40px;
    padding: 0 8px;
    background: var(--bg-alt);
  }

  .tabs {
    display: flex;
    align-items: flex-end;
    flex: 1;
    align-self: stretch;
    min-width: 0;
    padding: 6px 8px 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .tab {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 1 200px;
    align-self: stretch;
    min-width: 90px;
    border-radius: 8px 8px 0 0;
    color: var(--text-muted);
  }

  /* A hairline between two tabs that are both at rest. */
  .tab:not(.active) + .tab:not(.active)::before {
    content: '';
    position: absolute;
    left: 0;
    top: 9px;
    bottom: 9px;
    width: 1px;
    background: var(--border);
  }

  .tab:not(.active):hover {
    color: var(--text);
  }

  .tab:not(.active):hover::after {
    content: '';
    position: absolute;
    inset: 3px 3px 4px;
    z-index: 0;
    border-radius: 6px;
    background: var(--bg-hover);
  }

  .tab > :global(*) {
    position: relative;
    z-index: 1;
  }

  .tab.active {
    background: var(--bg);
    color: var(--text);
  }

  /* The curves that join the open tab to the page below it. */
  .tab.active::before,
  .tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }

  .tab.active::before {
    left: -8px;
    background: radial-gradient(circle at 0 0, transparent 8px, var(--bg) 8.5px);
  }

  .tab.active::after {
    right: -8px;
    background: radial-gradient(circle at 100% 0, transparent 8px, var(--bg) 8.5px);
  }

  /* The cross shows on the open tab, and on another when the pointer is over it. */
  .tab:not(.active):not(:hover) .tab-close {
    visibility: hidden;
  }

  .bar-button {
    display: flex;
    flex: none;
    align-items: center;
    align-self: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 5px;
    color: var(--text-muted);
  }

  .bar-button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .bar-button svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .view-header {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 36px;
    padding: 0 10px;
  }

  .crumbs {
    flex: 1;
    min-width: 0;
    padding-left: 10px;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .crumbs .sep {
    padding: 0 6px;
    color: var(--text-faint);
  }

  .crumbs .last {
    color: var(--text);
  }

  .tab-title {
    flex: 1;
    min-width: 0;
    padding: 0 4px 0 12px;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-icon {
    display: inline-flex;
    margin-right: 6px;
    font-size: 14px;
    vertical-align: -2px;
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
