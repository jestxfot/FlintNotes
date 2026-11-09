<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { moment, path, type Draft } from '../../api'
  import FieldInput from './FieldInput.svelte'
  import { blankTemplate, initialValues, renderNote, splitTags, type Values } from './model'
  import type { TemplateStore } from './store'

  let { store, targetPath, source, templateId, explicitFolder, onclose, oncreate, onbuilder }: {
    store: TemplateStore; targetPath: string; source: string; templateId?: string; explicitFolder: boolean
    onclose: () => void; oncreate: (draft: Draft) => void; onbuilder: () => void
  } = $props()
  const date = moment()
  const plain = $state(blankTemplate())
  let dialog: HTMLDialogElement
  let templates = $state(untrack(() => store.list()))
  let selected = $state(untrack(() => templateId ?? ''))
  let query = $state('')
  let category = $state('')
  let title = $state(untrack(() => /^Без названия(?: \d+)?$/.test(path.stripExt(path.basename(targetPath))) ? '' : path.stripExt(path.basename(targetPath))))
  let values = $state<Values>({})
  let tags = $state('')
  let folder = $state('')
  let showPreview = $state(false)
  let submitted = $state(false)
  const template = $derived(templates.find((item) => item.id === selected) ?? plain)
  const categories = $derived([...new Set(templates.map((t) => t.category).filter(Boolean))])
  const shown = $derived(templates.filter((t) => (!category || t.category === category) && `${t.name} ${t.description} ${t.tags}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())))
  const notes = untrack(() => store.app.vault.files().filter((file) => file.path.endsWith('.md')).map((file) => path.stripExt(file.path)))
  const knownTags = untrack(() => store.app.metadata.tags().map((entry) => entry.tag))
  const result = $derived.by(() => {
    const made = renderNote({ template: selected ? template : { ...template, body: '' }, title, values, tags, folder, date, source, uniquePath: (folder, name, ext) => store.app.vault.uniquePath(folder, name, ext) })
    if (!selected) made.text += plain.body
    return made
  })
  const suggested = $derived(knownTags.filter((tag) => !splitTags(tags).includes(tag)).slice(0, 16))

  $effect(() => {
    const next = template
    untrack(() => {
      values = initialValues(next, date, source, title)
      tags = next.tags
      folder = explicitFolder ? path.dirname(targetPath) : next.folder || path.dirname(targetPath)
      submitted = false
    })
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    submitted = true
    if (result.errors.length) return
    oncreate({ path: result.path, text: result.text })
  }
  function toggleTag(tag: string) {
    const all = splitTags(tags)
    tags = (all.includes(tag) ? all.filter((t) => t !== tag) : [...all, tag]).join(', ')
  }
  onMount(() => {
    dialog.showModal()
    return store.app.settings.on('change', (scope, key) => { if (scope === 'new-note' && key === 'library') templates = store.list() })
  })
</script>

<dialog bind:this={dialog} class="nn-dialog nn-create" aria-label="Новая заметка" {onclose}>
  <header class="nn-header">
    <div><h2>Новая заметка</h2><p>Выберите тематику и заполните нужные поля</p></div>
    <button type="button" class="nn-close" aria-label="Закрыть" onclick={() => dialog.close()}>×</button>
  </header>
  <div class="nn-create-layout">
    <aside class="nn-choices">
      <input type="search" aria-label="Найти тематику" placeholder="Найти тематику…" bind:value={query} />
      {#if categories.length}<select aria-label="Категория" bind:value={category}><option value="">Все категории</option>{#each categories as name}<option>{name}</option>{/each}</select>{/if}
      <button type="button" class="nn-choice" class:active={!selected} onclick={() => selected = ''}><strong>Обычная заметка</strong><small>Название, теги и свободный текст</small></button>
      {#each shown as item (item.id)}
        <button type="button" class="nn-choice" class:active={selected === item.id} onclick={() => selected = item.id}><strong>{item.name}</strong><small>{item.description || item.category}</small></button>
      {/each}
      {#if !shown.length}<p class="nn-muted">Шаблоны не найдены. Создайте свой в конструкторе.</p>{/if}
      <button type="button" class="nn-secondary" onclick={onbuilder}>Конструктор шаблонов</button>
    </aside>
    <form class="nn-create-form" onsubmit={submit}>
      <div class="nn-scroll">
        <h3>{template.name}</h3>
        {#if template.description}<p class="nn-muted">{template.description}</p>{/if}
        <label class="nn-field"><span>Название заметки *</span><input name="title" required bind:value={title} placeholder="О чём эта заметка?" /></label>
        {#each template.fields.filter((f) => !f.hidden) as field (field.id)}
          <FieldInput {field} value={values[field.key] ?? ''} onchange={(value) => values[field.key] = value} {notes} />
        {/each}
        {#if !selected}<label class="nn-field"><span>Текст заметки</span><textarea rows="5" bind:value={plain.body}></textarea></label>{/if}
        <label class="nn-field"><span>Теги</span><input aria-label="Теги" bind:value={tags} placeholder="Через запятую: идеи, видео" /></label>
        <div class="nn-tags" aria-label="Выбранные теги">{#each splitTags(tags) as tag}<button type="button" class="nn-tag active" aria-label={`Убрать тег ${tag}`} onclick={() => toggleTag(tag)}>#{tag} ×</button>{/each}</div>
        {#if suggested.length}<div class="nn-tags"><small>Добавить:</small>{#each suggested as tag}<button type="button" class="nn-tag" onclick={() => toggleTag(tag)}>#{tag}</button>{/each}</div>{/if}
        <label class="nn-field"><span>Папка</span><input aria-label="Папка" bind:value={folder} list="nn-folders" placeholder="Корень хранилища" /><small>Можно выбрать существующую или указать новую. Даты подставятся автоматически.</small></label>
        <datalist id="nn-folders">{#each store.app.vault.all().filter((entry) => entry.kind === 'folder' && !entry.path.startsWith('.')) as entry}<option value={entry.path}></option>{/each}</datalist>
        <div class="nn-path"><small>Файл</small><span>{result.path}</span></div>
        <button type="button" class="nn-text-button" onclick={() => showPreview = !showPreview}>{showPreview ? 'Скрыть предпросмотр' : 'Предпросмотр заметки'}</button>
        {#if showPreview}<pre class="nn-preview">{result.text || 'Пустая заметка'}</pre>{/if}
        {#if submitted && result.errors.length}<div class="nn-errors" role="alert">{#each result.errors as error}<p>{error}</p>{/each}</div>{/if}
      </div>
      <footer class="nn-footer"><button type="button" class="nn-secondary" onclick={() => dialog.close()}>Отмена</button><button type="submit" class="nn-primary">Создать заметку</button></footer>
    </form>
  </div>
</dialog>
