<script lang="ts">
  import { onMount } from 'svelte'
  import { eventHotkey, formatHotkey, type Command } from '../core/commands'
  import type { SettingDef } from '../core/settings'
  import { app } from '../instance'
  import { watch } from './reactive.svelte'

  let { onclose }: { onclose: () => void } = $props()

  const PLUGINS = '#plugins'
  const HOTKEYS = '#hotkeys'
  const GENERAL = 'Общие'
  /** Pages of the core's own settings, in the order of Obsidian's, with their icons. */
  const CORE_PAGES: [name: string, icon: string][] = [
    [GENERAL, 'circle-user'],
    ['Оформление', 'palette'],
    ['Интерфейс', 'monitor'],
    ['Редактор', 'pencil'],
    ['Файлы и ссылки', 'folder-open'],
  ]
  const { settings, plugins, commands } = app

  let dialog: HTMLDialogElement
  let tab = $state('Оформление')
  let query = $state('')
  /** The command whose shortcut is being recorded. */
  let recording = $state<string | null>(null)

  const sections = watch(settings, ['sections'], () => settings.listSections())
  const pluginList = watch(plugins, ['change'], () => plugins.list())
  // Fresh rows on every change, so a new shortcut shows at once.
  const commandList = watch(commands, ['change'], () =>
    commands
      .list()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((command) => ({ command, hotkey: commands.hotkeyOf(command), custom: Object.hasOwn(commands.customHotkeys(), command.id) })),
  )
  const changed = watch(settings, ['change'], () => 0)

  const core = $derived(sections.current.find((s) => s.id === 'core'))
  const pluginSections = $derived(sections.current.filter((s) => s.id !== 'core' && s.defs.length))
  // Only pages that have something on them are listed.
  const corePages = $derived(CORE_PAGES.filter(([name]) => core?.defs.some((def) => (def.group ?? GENERAL) === name)))
  const matches = (text: string | undefined) => !!text && text.toLowerCase().includes(query.trim().toLowerCase())

  interface Card {
    scope: string
    title: string
    /** A page's own heading is shown once; panels under it carry the names of their sections. */
    heading: string
    defs: SettingDef[]
  }
  /** Splits a page into panels, one per section named by its settings, in the order they first appear. */
  const panels = (scope: string, title: string, defs: SettingDef[]): Card[] => {
    const names = [...new Set(defs.map((def) => def.section ?? ''))]
    return names.map((name) => ({ scope, title, heading: name, defs: defs.filter((def) => (def.section ?? '') === name) }))
  }
  /** What the right side shows: the chosen page, or every setting that matches the search. */
  const cards = $derived.by((): Card[] => {
    const all: Card[] = [
      ...CORE_PAGES.flatMap(([name]) => panels('core', name, core?.defs.filter((def) => (def.group ?? GENERAL) === name) ?? [])),
      ...pluginSections.flatMap((s) => panels(s.id, s.title, s.defs)),
    ]
    if (query.trim()) return all.map((card) => ({ ...card, defs: card.defs.filter((def) => matches(def.name) || matches(def.desc) || matches(card.title)) })).filter((card) => card.defs.length)
    return all.filter((card) => (card.scope === 'core' ? card.title === tab : card.scope === tab))
  })
  // A plugin's page disappears when the plugin is turned off; show the plugin list then.
  const page = $derived(query.trim() ? 'search' : tab === PLUGINS || tab === HOTKEYS ? tab : cards.length ? 'cards' : PLUGINS)

  function value<T>(scope: string, key: string): T {
    void changed.current
    return settings.get<T>(scope, key)
  }

  function icon(node: HTMLElement, name: string) {
    node.append(app.icons.draw(name))
  }

  /** A plugin's own editor for a setting that one field cannot hold. */
  function custom(node: HTMLElement, render: (el: HTMLElement) => (() => void) | void) {
    const off = render(node)
    return { destroy: () => off?.() }
  }

  function go(next: string) {
    tab = next
    query = ''
    recording = null
  }

  // ---- shortcuts
  function saveHotkey(command: Command, hotkey: string | null) {
    const custom = commands.customHotkeys()
    // `null` returns the command to its own shortcut; an empty one means "no shortcut".
    if (hotkey === null) delete custom[command.id]
    else custom[command.id] = hotkey
    commands.setCustomHotkeys(custom)
    settings.set('core', 'hotkeys', custom)
    recording = null
  }

  function record(event: KeyboardEvent, command: Command) {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') return void (recording = null)
    if (event.key === 'Backspace' || event.key === 'Delete') return saveHotkey(command, '')
    // Wait for a real key: Ctrl or Shift alone is only the beginning of a shortcut.
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
    const hotkey = eventHotkey(event)
    const taken = commands.list().find((other) => other.id !== command.id && commands.hotkeyOf(other) === hotkey)
    if (taken) app.notice(`${formatHotkey(hotkey)} уже у команды «${taken.name}» — теперь сработает эта`)
    saveHotkey(command, hotkey)
  }

  onMount(() => dialog.showModal())
</script>

<dialog
  bind:this={dialog}
  {onclose}
  onclick={(event) => event.target === dialog && dialog.close()}
  aria-label="Настройки"
>
  <nav>
    <input class="search" type="search" placeholder="Поиск настроек…" aria-label="Поиск настроек" bind:value={query} />
    <div class="nav-title">Настройки</div>
    {#each corePages as [name, glyph] (name)}
      <button class:active={page === 'cards' && tab === name} onclick={() => go(name)}><span class="nav-icon" use:icon={glyph}></span>{name}</button>
    {/each}
    <button class:active={page === HOTKEYS} onclick={() => go(HOTKEYS)}><span class="nav-icon" use:icon={'command'}></span>Сочетания клавиш</button>
    <button class:active={page === PLUGINS} onclick={() => go(PLUGINS)}><span class="nav-icon" use:icon={'puzzle'}></span>Плагины</button>
    {#if pluginSections.length}
      <div class="nav-title">Включённые плагины</div>
      {#each pluginSections as s (s.id)}
        <button class="sub" class:active={page === 'cards' && tab === s.id} onclick={() => go(s.id)}><span class="nav-icon" use:icon={'blocks'}></span>{s.title}</button>
      {/each}
    {/if}
  </nav>

  <div class="body">
    <button class="close" aria-label="Закрыть" onclick={() => dialog.close()}>×</button>

    {#if page === 'cards' || page === 'search'}
      {#each cards as card, i (card.scope + card.title + card.heading)}
        {#if i === 0 || cards[i - 1].title !== card.title || cards[i - 1].scope !== card.scope}<h2>{card.title}</h2>{/if}
        {#if card.heading}<h3>{card.heading}</h3>{/if}
        <div class="card">
          {#each card.defs as def (def.key)}
            {@const set = (v: unknown) => settings.set(card.scope, def.key, v)}
            {#if def.type === 'custom'}
              <div class="item custom">
                <span class="info">
                  <span>{def.name}</span>
                  {#if def.desc}<small>{def.desc}</small>{/if}
                </span>
                <div class="custom-body" use:custom={def.render}></div>
              </div>
            {:else}
            <label class="item">
              <span class="info">
                <span>{def.name}</span>
                {#if def.desc}<small>{def.desc}</small>{/if}
              </span>
              {#if def.type === 'toggle'}
                <input type="checkbox" class="switch" checked={value<boolean>(card.scope, def.key)} onchange={(event) => set(event.currentTarget.checked)} />
              {:else if def.type === 'select'}
                <select value={value<string>(card.scope, def.key)} onchange={(event) => set(event.currentTarget.value)}>
                  {#each def.options as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              {:else if def.type === 'number'}
                <input
                  type="number"
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={value<number>(card.scope, def.key)}
                  onchange={(event) => {
                    const n = event.currentTarget.valueAsNumber
                    if (!Number.isNaN(n)) set(Math.min(def.max ?? n, Math.max(def.min ?? n, n)))
                  }}
                />
              {:else if def.type === 'lines'}
                <textarea rows="4" spellcheck="false" placeholder={def.placeholder} value={value<string>(card.scope, def.key)} onchange={(event) => set(event.currentTarget.value)}></textarea>
              {:else}
                <input type="text" placeholder={def.placeholder} value={value<string>(card.scope, def.key)} onchange={(event) => set(event.currentTarget.value)} />
              {/if}
            </label>
            {/if}
          {/each}
        </div>
      {:else}
        <p class="hint">Ничего не найдено.</p>
      {/each}
    {:else if page === HOTKEYS}
      <h2>Сочетания клавиш</h2>
      <p class="hint">Щёлкните по сочетанию и нажмите новое. Backspace убирает сочетание, Esc отменяет.</p>
      <div class="card">
        {#each commandList.current as { command, hotkey, custom } (command.id)}
          <div class="item key-row">
            <span class="info"><span>{command.name}</span></span>
            {#if custom}
              <button class="reset" title="Вернуть исходное сочетание" aria-label="Вернуть исходное сочетание" onclick={() => saveHotkey(command, null)}>↺</button>
            {/if}
            <button class="hotkey" class:recording={recording === command.id} onclick={() => (recording = command.id)} onkeydown={(event) => recording === command.id && record(event, command)} onblur={() => recording === command.id && (recording = null)}>
              {recording === command.id ? 'Нажмите клавиши…' : hotkey ? formatHotkey(hotkey) : 'Не задано'}
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <h2>Плагины</h2>
      <p class="hint">
        Всё, кроме редактора и списка файлов, включается здесь. Сторонние плагины кладутся в папку
        <code>.flint/plugins</code> хранилища и получают полный доступ к заметкам.
      </p>
      <div class="card">
        {#each pluginList.current as { manifest, enabled } (manifest.id)}
          <label class="item">
            <span class="info">
              <span>
                {manifest.name}
                {#if !manifest.builtin}<em>сторонний</em>{/if}
              </span>
              {#if manifest.description}<small>{manifest.description}</small>{/if}
            </span>
            <input
              type="checkbox"
              class="switch"
              checked={enabled}
              onchange={(event) => (event.currentTarget.checked ? plugins.enable(manifest.id) : plugins.disable(manifest.id))}
            />
          </label>
        {/each}
      </div>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(1000px, calc(100vw - 48px));
    height: min(760px, calc(100vh - 48px));
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
    box-shadow: var(--shadow);
  }

  dialog[open] {
    display: flex;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }

  nav {
    display: flex;
    flex-direction: column;
    flex: 0 0 226px;
    gap: 1px;
    padding: 12px 10px;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    background: var(--bg-alt);
  }

  .search {
    margin-bottom: 4px;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
  }

  .search:focus {
    border-color: var(--accent);
    outline: none;
  }

  .nav-title {
    padding: 14px 10px 6px;
    color: var(--text-faint);
    font-size: 12.5px;
  }

  nav button {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 5px 10px;
    border-radius: 6px;
    color: var(--text-muted);
    text-align: left;
  }

  .nav-icon {
    display: flex;
    font-size: 16px;
  }

  nav button:hover,
  nav button.active {
    background: var(--bg-hover);
    color: var(--text);
  }

  .body {
    position: relative;
    flex: 1;
    min-width: 0;
    padding: 20px 34px 34px;
    overflow-y: auto;
  }

  .close {
    position: absolute;
    top: 10px;
    right: 12px;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 20px;
  }

  .close:hover {
    background: var(--bg-hover);
  }

  h2 {
    margin: 14px 0 10px;
    font-size: 16px;
  }

  h2:first-of-type {
    margin-top: 2px;
  }

  h3 {
    margin: 22px 4px 10px;
    font-size: 15px;
  }

  .hint {
    margin: 0 0 10px;
    color: var(--text-muted);
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  /* Settings of one page sit in a panel, one under another with a line between. */
  .card {
    padding: 0 18px;
    border-radius: 10px;
    background: var(--bg-alt);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 0;
  }

  .item + .item {
    border-top: 1px solid var(--border);
  }

  .item.custom {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .info {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 3px;
    min-width: 0;
    font-size: 14px;
  }

  small {
    color: var(--text-muted);
    font-size: 12.5px;
  }

  em {
    margin-left: 6px;
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text-muted);
    font-size: 11px;
    font-style: normal;
  }

  select,
  input[type='number'],
  input[type='text'] {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-hover);
  }

  input[type='number'] {
    width: 84px;
  }

  textarea {
    flex: 0 0 55%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: inherit;
    font: 12.5px/1.5 var(--font-mono);
    resize: vertical;
  }

  .key-row {
    padding: 8px 0;
  }

  .hotkey {
    min-width: 96px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 12.5px;
  }

  .hotkey.recording {
    border-color: var(--accent);
    color: var(--accent);
  }

  .reset {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    color: var(--text-faint);
  }

  .reset:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .switch {
    appearance: none;
    position: relative;
    flex: 0 0 40px;
    height: 22px;
    margin: 0;
    border-radius: 11px;
    background: var(--border);
    cursor: pointer;
    transition: background 0.15s;
  }

  .switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }

  .switch:checked {
    background: var(--accent);
  }

  .switch:checked::after {
    transform: translateX(18px);
  }
</style>
