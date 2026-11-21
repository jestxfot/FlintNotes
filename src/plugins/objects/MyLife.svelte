<script lang="ts">
  import { path, watch, type App } from '../../api'
  import { LIFE_FIELDS, LIFE_PARTS, type TypeDef } from './model'
  import type { Registry } from './registry'

  let { app, registry, place, create }: {
    app: App; registry: Registry
    /** Asks where on the map a note belongs and writes it there. */
    place: (note: string) => void
    /** Makes an object of a part of the map. */
    create: (type: TypeDef) => void
  } = $props()

  // svelte-ignore state_referenced_locally (props of a view are set once)
  const indexed = watch(app.metadata, ['resolved'], () => ({}), { quiet: true })

  const TITLES: Record<string, string> = { 'key element': 'Ключевые элементы', project: 'Проекты', topic: 'Темы', habit: 'Привычки' }
  const name = (note: string) => path.stripExt(path.basename(note))
  const icon = (node: HTMLElement, look: { icon: string; color?: string }) => {
    const draw = (l: { icon: string; color?: string }) => node.replaceChildren(app.icons.draw(l.icon, l.color))
    draw(look)
    return { update: draw }
  }
  const open = (note: string, event?: MouseEvent) => app.workspace.openFile(note, event && (event.ctrlKey || event.metaKey) ? { newTab: true } : {})
  const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)

  const map = $derived.by(() => {
    void indexed.current
    const parts = LIFE_PARTS.map((part) => {
      const type = registry.types().find((one) => one.lifePart === part)
      const items = type
        ? registry.objects(type).map((note) => {
            // How much hangs on it: the objects linking to it.
            const linked = [...app.metadata.backlinks(note).keys()].filter((source) => source !== note && registry.typeOf(source)).length
            return { note, linked }
          })
        : []
      return { part, title: TITLES[part], type, items }
    })
    // Objects that may have a place on the map and have none yet: captured, but not placed.
    const unplaced = registry
      .allObjects()
      .filter((note) => {
        const type = registry.typeOf(note)
        if (!type?.myLife) return false
        const frontmatter = app.metadata.get(note)?.frontmatter ?? {}
        return LIFE_FIELDS.every((field) => isEmpty(frontmatter[field]))
      })
      .sort((a, b) => (app.vault.get(b)?.mtime ?? 0) - (app.vault.get(a)?.mtime ?? 0))
    return { parts, unplaced }
  })
</script>

<div class="obj-life">
  <header class="obj-life-head">
    <h1>Моя жизнь</h1>
    <p>Карта вашей жизни: ключевые элементы, проекты, темы и привычки — все на одном уровне. Мысль, у которой есть место на карте, всегда найдётся.</p>
  </header>
  <div class="obj-life-grid">
    {#each map.parts as part (part.part)}
      <section class="obj-life-part">
        <h2>
          {#if part.type}<span use:icon={{ icon: part.type.icon, color: part.type.color }}></span>{/if}
          {part.title} <span class="obj-count">{part.items.length}</span>
          {#if part.type}<button type="button" class="obj-add" title="Добавить" aria-label={`Добавить: ${part.title}`} onclick={() => part.type && create(part.type)}>+</button>{/if}
        </h2>
        {#if !part.type}
          <p class="obj-muted">Нет типа для этой части карты: укажите в заметке типа <code>life part: {part.part}</code>.</p>
        {/if}
        <ul class="obj-list">
          {#each part.items as item (item.note)}
            <li><button type="button" onclick={(e) => open(item.note, e)}>{name(item.note)}{#if item.linked}<span class="obj-count">{item.linked}</span>{/if}</button></li>
          {:else}
            {#if part.type}<li class="obj-muted">Пока пусто</li>{/if}
          {/each}
        </ul>
      </section>
    {/each}
  </div>
  <section class="obj-life-unplaced">
    <h2>Без места <span class="obj-count">{map.unplaced.length}</span></h2>
    <p class="obj-muted">Объекты, которые ещё не связаны ни с ключевым элементом, ни с проектом, ни с темой.</p>
    <ul class="obj-list">
      {#each map.unplaced as note (note)}
        {@const type = registry.typeOf(note)}
        <li>
          <button type="button" onclick={(e) => open(note, e)}>{#if type}<span use:icon={{ icon: type.icon, color: type.color }}></span>{/if}{name(note)}</button>
          <button type="button" class="obj-place" onclick={() => place(note)}>Разместить…</button>
        </li>
      {:else}
        <li class="obj-muted">Всё на своих местах.</li>
      {/each}
    </ul>
  </section>
</div>
