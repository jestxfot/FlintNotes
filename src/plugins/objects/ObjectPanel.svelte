<script lang="ts">
  import { path, watch, type App } from '../../api'
  import { objectFields, type TypeDef } from './model'
  import type { Registry } from './registry'

  let { app, registry, run }: { app: App; registry: Registry; run: (command: string) => void } = $props()

  let root: HTMLElement
  const shown = () => root
  // svelte-ignore state_referenced_locally (props of a panel are set once, when it is mounted)
  const active = watch(app.workspace, ['active-change', 'layout-change'], () => {
    const note = app.workspace.active?.path
    return note && note.endsWith('.md') && app.vault.get(note) ? note : undefined
  }, { shown })
  // svelte-ignore state_referenced_locally
  const indexed = watch(app.metadata, ['resolved'], () => ({}), { quiet: true, shown })

  const name = (note: string) => path.stripExt(path.basename(note))
  const icon = (node: HTMLElement, look: { icon: string; color?: string }) => {
    const draw = (l: { icon: string; color?: string }) => node.replaceChildren(app.icons.draw(l.icon, l.color))
    draw(look)
    return { update: draw }
  }
  const lookOf = (note: string) => {
    const type = registry.typeOf(note) ?? registry.typeAt(note)
    return type ? { icon: type.icon, color: type.color } : { icon: 'file-text', color: '' }
  }
  const open = (note: string, event?: MouseEvent) => app.workspace.openFile(note, event && (event.ctrlKey || event.metaKey) ? { newTab: true } : {})

  /** Notes grouped by their type, types in the order of the vault's list, plain notes last. */
  function grouped(notes: string[]): { type: TypeDef | null; notes: string[] }[] {
    const groups = new Map<TypeDef | null, string[]>()
    for (const note of notes) {
      const type = registry.typeOf(note) ?? null
      const list = groups.get(type)
      if (list) list.push(note)
      else groups.set(type, [note])
    }
    const order = registry.types()
    return [...groups]
      .map(([type, list]) => ({ type, notes: list.sort((a, b) => name(a).localeCompare(name(b))) }))
      .sort((a, b) => (a.type ? order.indexOf(a.type) : 1e9) - (b.type ? order.indexOf(b.type) : 1e9))
  }

  const view = $derived.by(() => {
    void indexed.current
    const note = active.current
    if (!note) return null
    const asType = registry.typeAt(note)
    const type = registry.typeOf(note)
    const meta = app.metadata.get(note)
    const frontmatter = meta?.frontmatter ?? {}
    // What the note links to that is an object, from its text and its properties alike.
    const out = [...new Set((meta?.links ?? []).map((link) => app.metadata.resolve(link.target, note)).filter((dest): dest is string => !!dest && dest !== note && !!registry.typeOf(dest)))]
    const back = [...app.metadata.backlinks(note).keys()].filter((source) => source !== note && !(asType && registry.typeOf(source) === asType))
    const fields = type
      ? objectFields(type).map((field) => {
          const value = frontmatter[field]
          const relation = registry.relationOf(field)
          const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)
          return { field, value: empty ? '' : Array.isArray(value) ? value.join(', ') : String(value), relation }
        })
      : []
    return { note, asType, type, out: grouped(out), back: grouped(back), fields, objects: asType ? registry.objects(asType) : [] }
  })

  /** A value as text, links by the name of what they lead to. */
  const plain = (value: string) => value.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias ?? target.split('/').pop()!)
</script>

<div class="obj-panel" bind:this={root}>
  {#if !view}
    <p class="obj-muted">Откройте заметку, чтобы увидеть её как объект.</p>
  {:else}
    {#if view.asType}
      <header class="obj-panel-head">
        <span class="obj-panel-icon" use:icon={{ icon: view.asType.icon, color: view.asType.color }}></span>
        <div><strong>{view.asType.name}</strong><small>тип · {view.objects.length} {view.objects.length === 1 ? 'объект' : 'объектов'}</small></div>
      </header>
      <div class="obj-actions">
        <button type="button" onclick={() => run('new-object-here')}>+ Новый объект</button>
        <button type="button" onclick={() => run('add-missing-fields')} title="Дописать в объекты поля, которых у них нет">Дописать поля</button>
      </div>
      {#if view.asType.fields.length || view.asType.myLife}
        <p class="obj-muted">Поля: {objectFields(view.asType).join(', ')}</p>
      {/if}
      <ul class="obj-list">
        {#each view.objects as one (one)}
          <li><button type="button" onclick={(e) => open(one, e)}><span use:icon={lookOf(one)}></span>{name(one)}</button></li>
        {:else}
          <li class="obj-muted">Объектов пока нет. Наберите в заметке @{view.asType.name}/ и имя.</li>
        {/each}
      </ul>
    {:else if view.type}
      <header class="obj-panel-head">
        <span class="obj-panel-icon" use:icon={{ icon: view.type.icon, color: view.type.color }}></span>
        <div><strong>{name(view.note)}</strong>
          <button type="button" class="obj-type-chip" style:color={app.icons.css(view.type.color)} onclick={(e) => view.type?.path && open(view.type.path, e)}>{view.type.name}</button></div>
      </header>
      {#if view.fields.length}
        <dl class="obj-fields">
          {#each view.fields as one (one.field)}
            <dt>{#if one.relation}<span use:icon={{ icon: one.relation.icon, color: one.relation.color }}></span>{/if}{one.field}</dt>
            <dd class:obj-muted={!one.value}>{one.value ? plain(one.value) : 'пусто'}</dd>
          {/each}
        </dl>
      {/if}
      <div class="obj-actions"><button type="button" onclick={() => run('set-type')}>Сменить тип</button></div>
    {:else}
      <p class="obj-muted">Эта заметка — не объект.</p>
      <div class="obj-actions"><button type="button" onclick={() => run('set-type')}>Сделать объектом…</button></div>
    {/if}

    {#if view.out.length}
      <h4>Связан с</h4>
      {#each view.out as group (group.type?.path ?? '')}
        <div class="obj-group">
          <span class="obj-group-name">{group.type?.name ?? 'Заметки'}</span>
          {#each group.notes as one (one)}<button type="button" class="obj-chip" onclick={(e) => open(one, e)}><span use:icon={lookOf(one)}></span>{name(one)}</button>{/each}
        </div>
      {/each}
    {/if}

    {#if !view.asType || view.back.length}
      <h4>Упоминания <span>{view.back.reduce((n, g) => n + g.notes.length, 0)}</span></h4>
      {#each view.back as group (group.type?.path ?? '')}
        <div class="obj-group">
          <span class="obj-group-name">{group.type?.name ?? 'Заметки'}</span>
          {#each group.notes as one (one)}<button type="button" class="obj-chip" onclick={(e) => open(one, e)}><span use:icon={lookOf(one)}></span>{name(one)}</button>{/each}
        </div>
      {:else}
        <p class="obj-muted">Сюда пока никто не ссылается.</p>
      {/each}
    {/if}
  {/if}
</div>
