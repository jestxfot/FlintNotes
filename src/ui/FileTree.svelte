<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { errorMessage } from '../core/notice'
  import { basename, dirname, extname, join, stripExt } from '../core/path'
  import type { VaultEntry } from '../core/vault'
  import { app } from '../instance'
  import { watch } from './reactive.svelte'

  interface Node {
    entry: VaultEntry
    name: string
    children: Node[]
  }

  const STORAGE_KEY = app.vault.storageKey('expanded')
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const { vault, workspace } = app

  const entries = watch(vault, ['create', 'delete', 'rename'], () => vault.all())
  const activePath = watch(workspace, ['active-change', 'layout-change'], () => workspace.active?.path)
  const tree = $derived(build(entries.current))

  const expanded = new SvelteSet<string>(readExpanded())
  let renaming = $state<string | null>(null)
  let draft = $state('')
  let menu = $state<{ x: number; y: number; entry: VaultEntry | null } | null>(null)

  function readExpanded(): string[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    } catch {
      return []
    }
  }

  $effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]))
    } catch {
      // Remembering open folders is optional.
    }
  })

  onMount(() =>
    vault.on('rename', (entry, oldPath) => {
      if (expanded.delete(oldPath)) expanded.add(entry.path)
    }),
  )

  function build(list: VaultEntry[]): Node[] {
    const nodes = new Map<string, Node>()
    for (const entry of list) nodes.set(entry.path, { entry, name: basename(entry.path), children: [] })
    const roots: Node[] = []
    for (const node of nodes.values()) {
      const parent = nodes.get(dirname(node.entry.path))
      ;(parent ? parent.children : roots).push(node)
    }
    const sort = (list: Node[]) => {
      list.sort((a, b) =>
        a.entry.kind === b.entry.kind ? collator.compare(a.name, b.name) : a.entry.kind === 'folder' ? -1 : 1,
      )
      list.forEach((node) => sort(node.children))
    }
    sort(roots)
    return roots
  }

  /** Extension as written in the file name, dot included (`.md`, `.PNG`), or `''`. */
  const rawExt = (name: string) => name.slice(stripExt(name).length)

  function click(entry: VaultEntry) {
    if (entry.kind === 'file') workspace.openFile(entry.path)
    else if (!expanded.delete(entry.path)) expanded.add(entry.path)
  }

  function openMenu(event: MouseEvent, entry: VaultEntry | null) {
    event.preventDefault()
    event.stopPropagation()
    menu = { x: event.clientX, y: event.clientY, entry }
  }

  /** Folder a new item goes into when created from the given entry. */
  const folderFor = (entry: VaultEntry | null) =>
    !entry ? '' : entry.kind === 'folder' ? entry.path : dirname(entry.path)

  function startRename(entry: VaultEntry) {
    const name = basename(entry.path)
    draft = entry.kind === 'file' ? stripExt(name) : name
    renaming = entry.path
  }

  async function create(kind: VaultEntry['kind'], folder: string) {
    try {
      const entry =
        kind === 'file'
          ? await vault.create(vault.uniquePath(folder, 'Без названия', 'md'))
          : await vault.createFolder(vault.uniquePath(folder, 'Новая папка'))
      if (folder) expanded.add(folder)
      // The name field keeps the focus so the new item can be named right away.
      if (kind === 'file') workspace.openFile(entry.path, { focus: false })
      startRename(entry)
    } catch (err) {
      app.notice(`Не удалось создать: ${errorMessage(err)}`)
    }
  }

  async function commitRename() {
    const from = renaming
    if (!from) return
    renaming = null
    // After naming a note that is open, typing continues in its editor.
    if (workspace.active?.path === from) queueMicrotask(() => workspace.active?.view?.focus?.())
    const entry = vault.get(from)
    const name = draft.trim()
    if (!entry || !name) return
    if (/[\\/:*?"<>|]/.test(name)) {
      app.notice('Имя не может содержать символы \\ / : * ? " < > |')
      return
    }
    const ext = entry.kind === 'file' ? rawExt(basename(from)) : ''
    const to = join(dirname(from), name + ext)
    if (to === from) return
    if (vault.get(to)) {
      app.notice(`«${name + ext}» уже существует`)
      return
    }
    try {
      await vault.rename(from, to)
    } catch (err) {
      app.notice(`Не удалось переименовать: ${errorMessage(err)}`)
    }
  }

  function renameKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      // Committing moves the focus to the editor mid-keypress; without this the
      // browser would insert the Enter's line break into the note.
      event.preventDefault()
      void commitRename()
    } else if (event.key === 'Escape') renaming = null
  }

  // ---- moving by drag and drop ----

  let dragged = $state<string | null>(null)
  let dropTarget = $state<string | null>(null)

  /** The folder a drop on this entry goes into; `null` if the dragged item cannot go there. */
  function destination(entry: VaultEntry | null): string | null {
    if (dragged === null) return null
    const folder = folderFor(entry)
    // Not onto itself, not into its own subfolders, and not where it already is.
    if (folder === dragged || folder.startsWith(`${dragged}/`) || folder === dirname(dragged)) return null
    return folder
  }

  function dragOver(event: DragEvent, entry: VaultEntry | null) {
    const folder = destination(entry)
    if (folder === null) return
    event.preventDefault()
    event.stopPropagation()
    dropTarget = folder
  }

  async function drop(event: DragEvent, entry: VaultEntry | null) {
    const from = dragged
    const folder = destination(entry)
    dragged = dropTarget = null
    if (from === null || folder === null) return
    event.preventDefault()
    event.stopPropagation()
    const to = join(folder, basename(from))
    if (vault.get(to)) {
      app.notice(`В папке «${folder || vault.name}» уже есть «${basename(from)}»`)
      return
    }
    try {
      await vault.rename(from, to)
      if (folder) expanded.add(folder)
    } catch (err) {
      app.notice(`Не удалось переместить: ${errorMessage(err)}`)
    }
  }

  async function trash(entry: VaultEntry) {
    if (!confirm(`Переместить «${basename(entry.path)}» в корзину?`)) return
    try {
      await vault.trash(entry.path)
    } catch (err) {
      app.notice(`Не удалось удалить: ${errorMessage(err)}`)
    }
  }

  function selectAll(node: HTMLInputElement) {
    node.focus()
    node.select()
  }
</script>

<svelte:window
  onclick={() => (menu = null)}
  onkeydown={(event) => event.key === 'Escape' && (menu = null)}
/>

<div class="header">
  <span class="title">Файлы</span>
  <button title="Новая заметка" aria-label="Новая заметка" onclick={() => create('file', '')}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
  </button>
  <button title="Новая папка" aria-label="Новая папка" onclick={() => create('folder', '')}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5h4l1.5 1.5H14v6.5H2z" /></svg>
  </button>
</div>

{#snippet rows(nodes: Node[], depth: number)}
  {#each nodes as node (node.entry.path)}
    {@const entry = node.entry}
    {@const isFolder = entry.kind === 'folder'}
    {#if renaming === entry.path}
      <input
        class="rename"
        style:margin-left="{8 + depth * 14}px"
        aria-label="Новое имя"
        bind:value={draft}
        use:selectAll
        onkeydown={renameKey}
        onblur={commitRename}
      />
    {:else}
      <button
        class="row"
        class:active={entry.path === activePath.current}
        class:drop-target={isFolder && dropTarget === entry.path}
        style:padding-left="{8 + depth * 14}px"
        draggable="true"
        ondragstart={(event) => {
          dragged = entry.path
          event.dataTransfer?.setData('text/plain', entry.path)
        }}
        ondragend={() => (dragged = dropTarget = null)}
        ondragover={(event) => dragOver(event, entry)}
        ondrop={(event) => drop(event, entry)}
        aria-expanded={isFolder ? expanded.has(entry.path) : undefined}
        onclick={() => click(entry)}
        oncontextmenu={(event) => openMenu(event, entry)}
      >
        <span class="chevron" class:open={expanded.has(entry.path)}>{isFolder ? '›' : ''}</span>
        <span class="name">{extname(entry.path) === 'md' ? stripExt(node.name) : node.name}</span>
      </button>
    {/if}
    {#if isFolder && expanded.has(entry.path)}
      {@render rows(node.children, depth + 1)}
    {/if}
  {/each}
{/snippet}

<!-- Dropping on the empty part of the tree moves the item to the top level. -->
<div
  class="tree"
  class:drop-target={dropTarget === ''}
  role="tree"
  tabindex="-1"
  oncontextmenu={(event) => openMenu(event, null)}
  ondragover={(event) => dragOver(event, null)}
  ondragleave={() => (dropTarget = null)}
  ondrop={(event) => drop(event, null)}
>
  {@render rows(tree, 0)}
</div>

{#if menu}
  {@const entry = menu.entry}
  <div class="menu" role="menu" style:left="{menu.x}px" style:top="{menu.y}px">
    <button role="menuitem" onclick={() => create('file', folderFor(entry))}>Новая заметка</button>
    <button role="menuitem" onclick={() => create('folder', folderFor(entry))}>Новая папка</button>
    {#if entry}
      <hr />
      <button role="menuitem" onclick={() => startRename(entry)}>Переименовать</button>
      <button role="menuitem" onclick={() => trash(entry)}>Удалить</button>
    {/if}
  </div>
{/if}

<style>
  .header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 8px 6px 12px;
  }

  .title {
    flex: 1;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .header button {
    width: 26px;
    height: 26px;
    border-radius: 5px;
    color: var(--text-muted);
  }

  .header svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
    stroke-linecap: round;
    vertical-align: middle;
  }

  .header button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .tree {
    flex: 1;
    overflow-y: auto;
    padding: 0 6px 12px;
  }

  .row {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 4px 8px;
    border-radius: 5px;
    color: var(--text-muted);
    text-align: left;
  }

  .row:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .row.drop-target,
  .tree.drop-target {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
  }

  .row.active {
    background: var(--bg-hover);
    color: var(--text);
  }

  .chevron {
    flex: 0 0 14px;
    color: var(--text-faint);
    transition: transform 0.1s;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename {
    display: block;
    width: calc(100% - 30px);
    margin: 1px 0;
    padding: 3px 6px;
    border: 1px solid var(--accent);
    border-radius: 5px;
    background: var(--bg);
    outline: none;
  }

  .menu {
    position: fixed;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    box-shadow: var(--shadow);
  }

  .menu button {
    padding: 5px 10px;
    border-radius: 5px;
    text-align: left;
  }

  .menu button:hover {
    background: var(--bg-hover);
  }

  .menu hr {
    width: 100%;
    margin: 4px 0;
    border: none;
    border-top: 1px solid var(--border);
  }
</style>
