<script lang="ts">
  import { mount, onMount, unmount } from 'svelte'
  import { formatHotkey, type Command } from '../core/commands'
  import { errorMessage } from '../core/notice'
  import { basename, dirname, extname, stripExt } from '../core/path'
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
  // Floating sidebars (a setting): they stay out of the way and slide over the note
  // while the pointer is at that edge of the window or on the sidebar itself.
  const peek = $state({ left: false, right: false })
  const peekTimers: Partial<Record<'left' | 'right', ReturnType<typeof setTimeout>>> = {}
  /** Sidebars the user has pinned open with their button: those do not leave with the pointer. */
  const pinned = $state({ left: false, right: false })
  function pin(side: 'left' | 'right') {
    pinned[side] = !pinned[side]
    peek[side] = pinned[side]
  }
  function hover(side: 'left' | 'right', on: boolean) {
    clearTimeout(peekTimers[side])
    if (!on && pinned[side]) return
    // A short wait both ways: a pointer passing by opens nothing, and leaving for a moment closes nothing.
    peekTimers[side] = setTimeout(() => {
      // A menu opened from the sidebar keeps it in place, and so do dragging its edge and typing a name in it.
      // A button that was merely clicked there does not: the focus it keeps would hold the sidebar for ever.
      if (!on && (menu || document.querySelector('aside.resizing') || document.querySelector('aside input:focus'))) return hover(side, false)
      // The pointer came back meanwhile: the sidebar stays.
      if (!on && over[side]) return
      peek[side] = on
    }, on ? 120 : 350)
  }
  // Whether the pointer is on a floating sidebar is worked out from where the pointer is, not from
  // enter and leave events: a sidebar that appears under a pointer standing still gets no "enter".
  const over = { left: false, right: false }
  $effect(() => {
    // A window opened over the app (settings, vaults, help) sends the floating sidebars away.
    if (!(settingsOpen || vaultsOpen || helpOpen) || !floating) return
    for (const side of ['left', 'right'] as const) {
      clearTimeout(peekTimers[side])
      over[side] = false
      if (!pinned[side]) peek[side] = false
    }
  })
  function trackPointer(event: MouseEvent) {
    if (!floating || settingsOpen || vaultsOpen || helpOpen) return
    for (const side of ['left', 'right'] as const) {
      const box = document.querySelector(`aside.${side}.floating`)?.getBoundingClientRect()
      const atEdge = side === 'left' ? event.clientX <= 6 : event.clientX >= innerWidth - 6
      const inside = atEdge || (!!box && event.clientX >= box.left - 10 && event.clientX <= box.right + 10 && event.clientY >= box.top - 10 && event.clientY <= box.bottom + 10)
      if (inside === over[side]) continue
      over[side] = inside
      hover(side, inside)
    }
  }

  const { workspace, settings } = app
  const tabs = watch(workspace, ['layout-change'], () => workspace.leaves.map(({ id, path, title }) => ({ id, path, title })))
  const activeId = watch(workspace, ['active-change'], () => workspace.active?.id ?? null)
  const hasRightPanels = watch(app.panels, ['change'], () => app.panels.has('right'))
  const theme = watch(settings, ['change'], () => settings.get<string>('core', 'theme'))
  const fontSize = watch(settings, ['change'], () => settings.get<number>('core', 'fontSize'))
  const floatingSetting = watch(settings, ['change'], () => settings.get<boolean>('core', 'floatingSidebars'))
  const floating = $derived(!!floatingSetting.current)
  const readableWidth = watch(settings, ['change'], () => settings.get<boolean>('core', 'readableWidth'))
  const inlineTitle = watch(settings, ['change'], () => settings.get<boolean>('core', 'inlineTitle'))
  const look = watch(settings, ['change'], () => ({
    header: settings.get<boolean>('core', 'viewHeader'),
    ribbon: settings.get<boolean>('core', 'ribbon'),
    zoom: settings.get<number>('core', 'zoom'),
    properties: settings.get<string>('core', 'properties'),
  }))
  /** Folders and name of the open file, for the path shown above it. */
  const crumbs = watch(workspace, ['active-change', 'layout-change'], () => {
    const path = workspace.active?.path
    if (!path || path.startsWith('view:')) return workspace.active?.title ? [{ text: workspace.active.title, folder: '' }] : []
    const parts = path.split('/')
    return [...parts.slice(0, -1).map((text, i) => ({ text, folder: parts.slice(0, i + 1).join('/') })), { text: title(parts[parts.length - 1]), folder: '' }]
  })
  // A folder in the path may look and act as plugins say (a folder with a note of its own opens it).
  const explorer = watch(app.explorer, ['change'], () => ({}))
  const crumbEntry = (folder: string) => (folder ? app.vault.get(folder) : undefined)

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
  $effect(() => {
    root.classList.toggle('no-properties', look.current.properties === 'hidden')
    root.style.zoom = look.current.zoom && look.current.zoom !== 100 ? String(look.current.zoom / 100) : ''
  })

  const title = (path: string) => (extname(path) === 'md' ? stripExt(basename(path)) : basename(path))
  const leafById = (id: number) => workspace.leaves.find((leaf) => leaf.id === id)!
  // The strips along the edges take room only when something was put on them.
  const ribbons = watch(app.toolbars, ['change'], () => ({ left: app.toolbars.list('left-ribbon').length > 0, right: app.toolbars.list('right-ribbon').length > 0 }))
  const looks = watch(app.icons, ['change'], () => ({}))
  const tabLook = (path: string) => (looks.current && !path.startsWith('view:') ? app.icons.look('file', path) : undefined)
  function drawIcon(node: HTMLElement, [icon, path]: [string | undefined, string]) {
    if (icon) node.append(app.icons.clickable(app.icons.draw(icon), 'file', path))
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
  // What the frame's own commands act on; plugins say the same about theirs with `scope`.
  const NOTE_SCOPE = new Set(['core:rename-active', 'core:dock-active', 'core:copy-path', 'core:reveal-active', 'core:toggle-readable-width', 'core:delete-active'])
  const VAULT_SCOPE = new Set(['core:reveal-vault', 'core:vaults'])
  const SIDEBAR_SCOPE = new Set<string>()
  /** Where a core command goes in the note's menu; commands of plugins go to their own section. */
  const NOTE_SECTIONS: Record<string, string> = { 'core:toggle-editor-mode': 'open', 'core:find': 'copy', 'core:replace': 'copy', 'core:toggle-readable-width': 'open', 'core:dock-active': 'open', 'core:rename-active': 'action', 'core:copy-path': 'copy', 'core:reveal-active': 'system', 'core:delete-active': 'danger' }

  /**
   * The menu of the open note ("⋮"). Nothing is listed here by hand: it is made of
   * every command that says it acts on a note, of the commands that insert
   * something (as one list), and of what plugins add to the menu of a file.
   */
  function noteMenu(event: MouseEvent) {
    const path = workspace.active?.path
    const entry = path && !path.startsWith('view:') ? app.vault.get(path) : null
    if (!entry) return
    const commands = app.commands.list()
    const item = (command: Command): MenuItem => ({ icon: command.icon, title: command.name, onClick: () => command.callback() })
    const items: MenuItem[] = commands
      .filter((command) => command.scope === 'note')
      .map((command) => ({ ...item(command), section: NOTE_SECTIONS[command.id] ?? 'plugin', danger: NOTE_SECTIONS[command.id] === 'danger' }))
    const inserts = commands.filter((command) => command.scope === 'insert').sort((a, b) => a.name.localeCompare(b.name))
    if (inserts.length && extname(entry.path) === 'md') items.push({ section: 'new', icon: 'plus', title: 'Вставить', submenu: inserts.map((command) => ({ ...item(command), title: command.name.replace(/^Вставить\s+/, '').replace(/^./, (c) => c.toUpperCase()) })) })
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    app.menus.show({ x: box.right - 4, y: box.bottom + 4 }, 'file', entry, items)
  }

  function stepTab(by: number) {
    const { leaves, active } = workspace
    if (leaves.length > 1 && active) workspace.setActive(leaves[(leaves.indexOf(active) + by + leaves.length) % leaves.length])
  }

  /** The folder new notes go to, as chosen in the settings. */
  function newNoteFolder(): string {
    const where = settings.get<string>('core', 'newNoteLocation')
    const active = workspace.active?.path
    if (where === 'current' && active && !active.startsWith('view:')) return dirname(active)
    return where === 'folder' ? settings.get<string>('core', 'newNoteFolder').trim().replace(/^\/+|\/+$/g, '') : ''
  }

  /** Makes a note and opens it. `inNewTab` is for the tab strip's "+", which always opens a tab of its own. */
  async function newNote(inNewTab = false) {
    try {
      const folder = newNoteFolder()
      if (folder && !app.vault.get(folder)) await app.vault.createFolder(folder)
      const entry = await app.creation.create(app.vault.uniquePath(folder, 'Без названия', 'md'))
      // No template was chosen, or one was not filled in to the end: there is no note.
      if (!entry) return
      workspace.openFile(entry.path, inNewTab || settings.get<string>('core', 'newNoteTab') === 'new' ? { newTab: true } : {})
      // The name is selected, ready to be typed over.
      setTimeout(() => document.querySelector<HTMLInputElement>('.leaf:not([hidden]) .inline-title')?.select(), 250)
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
        const side = app.panels.sideOf(id) === 'left' ? 'left' : 'right'
        // Shown on request, it stays until the pointer has been on it and left, or Esc is pressed; it is not pinned.
        if (floating) {
          peek[side] = true
          over[side] = true
        }
        else if (side === 'left') leftOpen = true
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
        callback: () => (floating ? pin('left') : (leftOpen = !leftOpen)),
      }),
      app.commands.add({
        id: 'core:toggle-right-sidebar',
        name: 'Показать или скрыть правую панель',
        hotkey: 'Mod+Shift+Backslash',
        callback: () => (floating ? pin('right') : (rightOpen = !rightOpen)),
      }),
      app.commands.add({ id: 'core:new-note', name: 'Новая заметка', hotkey: 'Alt+N', callback: () => void newNote() }),
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
          ['core:delete-active', 'Удалить открытый файл', 'trash', () => withFile((path) => (!settings.get<boolean>('core', 'confirmDelete') || confirm(`Переместить «${basename(path)}» в корзину?`)) && void app.vault.trash(path).catch((err) => app.notice(errorMessage(err))))],
          ['core:dock-active', 'Перенести открытую заметку в боковую панель', 'panel-right', () => withFile((path) => app.docked.dock(path, 'right'))],
          ['core:toggle-theme', 'Переключить светлую и тёмную тему', 'sun-moon', () => settings.set('core', 'theme', (root.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark')],
          ['core:font-bigger', 'Увеличить шрифт заметки', 'a-arrow-up', () => stepFont(1)],
          ['core:font-smaller', 'Уменьшить шрифт заметки', 'a-arrow-down', () => stepFont(-1)],
          ['core:toggle-readable-width', 'Переключить удобную ширину строки', 'chevrons-left-right', () => settings.set('core', 'readableWidth', !settings.get<boolean>('core', 'readableWidth'))],
        ] as [string, string, string, () => unknown][]
      ).map(([id, name, icon, callback]) => app.commands.add({ id, name, icon, scope: NOTE_SCOPE.has(id) ? 'note' : VAULT_SCOPE.has(id) ? 'vault' : SIDEBAR_SCOPE.has(id) ? 'sidebar' : undefined, callback: () => void callback() })),
    ]
    // In full screen the browser lets a page have its own Ctrl+W, Ctrl+T and Ctrl+Tab (the
    // Keyboard Lock API of Chrome and Edge); outside it those keys never reach the page.
    const keyboard = (navigator as Navigator & { keyboard?: { lock?: (keys: string[]) => Promise<void>; unlock?: () => void } }).keyboard
    const onFullscreen = () => {
      if (document.fullscreenElement) void keyboard?.lock?.(['KeyW', 'KeyT', 'KeyN', 'Tab', 'Escape']).catch(() => {})
      else keyboard?.unlock?.()
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    offs.push(
      () => document.removeEventListener('fullscreenchange', onFullscreen),
      app.commands.add({
        id: 'core:fullscreen',
        name: 'Во весь экран (в нём Ctrl+W закрывает вкладку заметки)',
        icon: 'maximize',
        hotkey: 'Alt+Enter',
        callback: () => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch((err) => app.notice(errorMessage(err))),
      }),
    )
    const LOCKED: Record<string, string> = { 'Mod+W': 'core:close-tab', 'Mod+T': 'core:new-note', 'Mod+Tab': 'core:next-tab', 'Mod+Shift+Tab': 'core:previous-tab' }
    // Capture phase: app shortcuts take priority over the focused editor's keymap.
    const onKey = (event: KeyboardEvent) => {
      // Esc always sends the floating sidebars away, pinned or not, whatever was keeping them.
      if (event.key === 'Escape' && floating && (peek.left || peek.right) && !menu && !document.querySelector('dialog[open]')) {
        for (const side of ['left', 'right'] as const) {
          clearTimeout(peekTimers[side])
          peek[side] = pinned[side] = over[side] = false
        }
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        workspace.active?.view?.focus?.()
        event.preventDefault()
        return
      }
      if (document.fullscreenElement && (event.ctrlKey || event.metaKey) && !event.altKey) {
        const id = LOCKED[`Mod+${event.shiftKey ? 'Shift+' : ''}${event.code === 'Tab' ? 'Tab' : event.code.replace(/^Key/, '')}`]
        if (id) {
          event.preventDefault()
          event.stopPropagation()
          return void app.commands.run(id)
        }
      }
      void app.commands.handleKey(event)
    }
    // A slip of the hand (Ctrl+W, which the browser keeps for itself) must not close the app
    // with its tabs: the browser asks first. It only does so after the page has been used.
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!settings.get<boolean>('core', 'confirmLeave') || !workspace.leaves.length) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    offs.push(() => window.removeEventListener('beforeunload', onLeave))
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
    window.addEventListener('mousemove', trackPointer)
    offs.push(() => window.removeEventListener('mousemove', trackPointer))
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
  {#if ribbons.current.left && look.current.ribbon}<Toolbar place="left-ribbon" vertical />{/if}
  {#if floating}
    <!-- A thin strip along the edge of the window: the pointer on it brings the sidebar out over the note. -->
    <div class="edge left" role="presentation"></div>
  {/if}
  {#if floating ? peek.left : leftOpen}
    <Sidebar side="left" {floating}>
      {#snippet footer()}
        <MainMenu onvaults={() => (vaultsOpen = true)} onhelp={() => (helpOpen = true)} onsettings={() => (settingsOpen = true)} />
      {/snippet}
    </Sidebar>
  {/if}

  <main>
    <div class="tabbar">
      <button class="bar-button" title="Левая панель" aria-label="Левая панель" aria-pressed={floating ? peek.left : leftOpen} onclick={() => (floating ? pin('left') : (leftOpen = !leftOpen))}>
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
                {#if tabLook(tab.path)?.icon}<span class="tab-icon" style:color={app.icons.css(tabLook(tab.path)?.color)} use:drawIcon={[tabLook(tab.path)?.icon, tab.path]}></span>{/if}
              {/key}
              {tab.title ?? title(tab.path)}
            </button>
            <button class="tab-close" aria-label="Закрыть вкладку" onclick={() => workspace.close(leafById(tab.id))}>
              ×
            </button>
          </div>
        {/each}
        <button class="bar-button" title="Новая вкладка с новой заметкой" aria-label="Новая вкладка" onclick={() => newNote(true)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </button>
      </div>
      <Toolbar place="tab-bar" />
      <button class="bar-button" title="Правая панель" aria-label="Правая панель" aria-pressed={floating ? peek.right : rightOpen} onclick={() => (floating ? pin('right') : (rightOpen = !rightOpen))}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" /><path d="M10 2.5v11" /></svg>
      </button>
    </div>
    {#if crumbs.current.length && look.current.header}
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
            {@const entry = explorer.current && crumbEntry(part.folder)}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (the same folders are reachable from the list of files) -->
            <span class="crumb {entry ? app.explorer.classes(entry) : ''}" class:last={i === crumbs.current.length - 1} onclick={(event) => entry && app.explorer.folderClick(entry, event)}>{part.text}</span>
          {/each}
        </div>
        <Toolbar place="page-header" />
        <button class="bar-button note-menu" title="Действия с заметкой" aria-label="Действия с заметкой" onclick={(event) => (event.stopPropagation(), noteMenu(event))}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2v.01M8 8v.01M8 12.800v.01" stroke-width="2.200" /></svg>
        </button>
      </div>
    {/if}

    <div class="content" use:host={workspace.containerEl}>
      {#if !tabs.current.length}
        <div class="empty">
          <p>Откройте заметку в боковой панели</p>
          <button onclick={() => newNote()}>Новая заметка <kbd>Alt+N</kbd></button>
          <button onclick={openPalette}>Палитра команд <kbd>Ctrl+P</kbd></button>
        </div>
      {/if}
    </div>

    <div use:host={app.statusBar.el}></div>
  </main>

  <!-- An empty right sidebar appears while a widget is dragged, so it can be dropped there. -->
  {#if (floating ? peek.right : rightOpen) && (hasRightPanels.current || drag.panel || drag.note)}
    <Sidebar side="right" {floating} />
  {/if}
  {#if floating}
    <div class="edge right" role="presentation"></div>
  {/if}
  {#if ribbons.current.right && look.current.ribbon}<Toolbar place="right-ribbon" vertical />{/if}
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
    position: relative;
    display: flex;
    height: 100%;
  }

  /* Where the pointer calls a floating sidebar out. */
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 30;
    width: 6px;
  }

  .edge.left {
    left: 0;
  }

  .edge.right {
    right: 0;
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
    border-radius: var(--radius-l) var(--radius-l) 0 0;
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
    border-radius: var(--radius-m);
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
    border-radius: var(--radius-m);
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
    border-radius: var(--radius-s);
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
    border-radius: var(--radius-s);
    color: var(--text-muted);
    font: 11px var(--font-mono);
  }
</style>
