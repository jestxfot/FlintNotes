<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { moment } from '../../api'
  import { FIELD_TYPES, initialValues, newField, newTemplate, renderNote, templateErrors, type NoteTemplate } from './model'
  import type { TemplateStore } from './store'

  let { store }: { store: TemplateStore } = $props()
  let templates = $state(untrack(() => store.list()))
  let draft = $state<NoteTemplate>(untrack(() => JSON.parse(JSON.stringify(templates[0] ?? newTemplate()))))
  let baseline = $state(untrack(() => JSON.stringify(draft)))
  let errors = $state<string[]>([])
  let message = $state('')
  let pending = $state<(() => void) | null>(null)
  let deleting = $state(false)
  let preview = $state(false)
  let tokenTarget = $state<'body' | 'filename' | 'folder'>('body')
  let dateFormat = $state('YYYY-MM-DD')
  let bodyArea: HTMLTextAreaElement
  const dirty = $derived(JSON.stringify(draft) !== baseline)
  const isSaved = $derived(templates.some((t) => t.id === draft.id))
  const sample = $derived(renderNote({ template: draft, title: 'Пример заметки', values: initialValues(draft, moment(), store.app.creation.activeNote()), tags: draft.tags, folder: draft.folder, date: moment(), source: store.app.creation.activeNote(), uniquePath: (folder, name, ext) => store.app.vault.uniquePath(folder, name, ext) }))

  function load(template: NoteTemplate) {
    draft = JSON.parse(JSON.stringify(template))
    baseline = JSON.stringify(draft)
    errors = []
    message = ''
    deleting = false
  }
  function guard(action: () => void) {
    if (dirty) pending = action
    else action()
  }
  function save() {
    errors = templateErrors(draft)
    if (errors.length) return
    store.save(draft)
    baseline = JSON.stringify(draft)
    message = 'Шаблон сохранён'
  }
  function remove() {
    store.remove(draft.id)
    load(store.list()[0] ?? newTemplate())
  }
  function addField() {
    let index = draft.fields.length + 1
    while (draft.fields.some((f) => f.key === `field_${index}`)) index++
    draft.fields.push(newField(`field_${index}`))
    message = ''
  }
  function moveField(index: number, shift: number) {
    const next = index + shift
    if (next < 0 || next >= draft.fields.length) return
    const fields = [...draft.fields]
    ;[fields[index], fields[next]] = [fields[next], fields[index]]
    draft.fields = fields
  }
  function insert(token: string) {
    if (tokenTarget === 'body' && bodyArea) {
      const at = bodyArea.selectionStart
      draft.body = draft.body.slice(0, at) + token + draft.body.slice(bodyArea.selectionEnd)
      requestAnimationFrame(() => { bodyArea.focus(); bodyArea.setSelectionRange(at + token.length, at + token.length) })
    } else draft[tokenTarget] += token
  }
  onMount(() => store.app.settings.on('change', (scope, key) => {
    if (scope === 'new-note' && key === 'library') templates = store.list()
  }))
</script>

<div class="nn-builder">
  <div class="nn-builder-toolbar">
    <label class="nn-field"><span>Шаблон</span><select aria-label="Редактируемый шаблон" value={isSaved ? draft.id : ''} onchange={(e) => { const chosen = templates.find((t) => t.id === e.currentTarget.value); e.currentTarget.value = isSaved ? draft.id : ''; if (chosen) guard(() => load(chosen)) }}>
      {#if !isSaved}<option value="">Новый, ещё не сохранён</option>{/if}
      {#each templates as template (template.id)}<option value={template.id}>{template.name}</option>{/each}
    </select></label>
    <button type="button" class="nn-secondary" onclick={() => guard(() => load(newTemplate()))}>+ Шаблон</button>
    <button type="button" class="nn-secondary" onclick={() => guard(() => load(store.duplicate(draft)))}>Копия</button>
  </div>
  {#if pending}<div class="nn-confirm" role="alert"><p>Есть несохранённые изменения. Перейти без сохранения?</p><button type="button" class="nn-secondary" onclick={() => pending = null}>Остаться</button><button type="button" class="nn-secondary" onclick={() => { const action = pending; pending = null; action?.() }}>Перейти без сохранения</button></div>{/if}

  <div class="nn-grid">
    <label class="nn-field"><span>Название шаблона *</span><input aria-label="Название шаблона" bind:value={draft.name} /></label>
    <label class="nn-field"><span>Категория</span><input aria-label="Категория шаблона" bind:value={draft.category} placeholder="Медиа, Работа, Личное…" /></label>
  </div>
  <label class="nn-field"><span>Описание</span><input aria-label="Описание шаблона" bind:value={draft.description} placeholder="Для чего подходит этот шаблон" /></label>

  <details open>
    <summary>Папка, имя файла и теги</summary>
    <label class="nn-field"><span>Папка новых заметок</span><input aria-label="Папка шаблона" bind:value={draft.folder} list="nn-builder-folders" placeholder="Как выбрано при создании" /><small>Новая папка создастся с первой заметкой. Папка из контекстного меню главнее шаблона; её можно изменить в форме.</small></label>
    <datalist id="nn-builder-folders">{#each store.app.vault.all().filter((entry) => entry.kind === 'folder' && !entry.path.startsWith('.')) as entry}<option value={entry.path}></option>{/each}</datalist>
    <label class="nn-field"><span>Имя файла</span><input aria-label="Имя файла" bind:value={draft.filename} /><small>Без расширения. При совпадении имён добавляется номер.</small></label>
    <label class="nn-field"><span>Теги по умолчанию</span><input aria-label="Теги шаблона" bind:value={draft.tags} placeholder="youtube, идеи" /></label>
  </details>

  <details open>
    <summary>Поля формы <small>({draft.fields.length})</small></summary>
    <p class="nn-muted">Поле может стать свойством заметки и подставляться в текст или имя файла. Автоматическое поле заполняется значением по умолчанию и скрыто в форме.</p>
    {#each draft.fields as field, index (field.id)}
      <div class="nn-field-card" data-field={field.key}>
        <div class="nn-field-head"><strong>Поле {index + 1}</strong><div><button type="button" title="Выше" aria-label={`Поднять поле ${index + 1}`} disabled={index === 0} onclick={() => moveField(index, -1)}>↑</button><button type="button" title="Ниже" aria-label={`Опустить поле ${index + 1}`} disabled={index === draft.fields.length - 1} onclick={() => moveField(index, 1)}>↓</button><button type="button" aria-label={`Удалить поле ${index + 1}`} onclick={() => draft.fields = draft.fields.filter((f) => f.id !== field.id)}>×</button></div></div>
        <div class="nn-grid">
          <label class="nn-field"><span>Подпись</span><input aria-label={`Подпись поля ${index + 1}`} bind:value={field.label} /></label>
          <label class="nn-field"><span>Тип</span><select aria-label={`Тип поля ${index + 1}`} bind:value={field.type}>{#each FIELD_TYPES as [value, name]}<option {value}>{name}</option>{/each}</select></label>
          <label class="nn-field"><span>Ключ / имя свойства</span><input aria-label={`Ключ поля ${index + 1}`} bind:value={field.key} /><small>Буквы, цифры, дефис и подчёркивание. Ключ должен быть уникальным.</small></label>
          <label class="nn-field"><span>Значение по умолчанию</span><input aria-label={`Значение поля ${index + 1}`} bind:value={field.defaultValue} placeholder={field.type === 'date' ? '{{date}}' : field.type === 'checkbox' ? 'true или false' : 'Можно вставить дату или переменную'} /></label>
        </div>
        <label class="nn-field"><span>Подставить автоматически</span><select aria-label={`Автозаполнение поля ${index + 1}`} value="" onchange={(e) => { if (e.currentTarget.value) field.defaultValue = e.currentTarget.value; e.currentTarget.value = '' }}><option value="">Выберите значение…</option><option value={'{{date}}'}>Сегодняшняя дата</option><option value={'{{date:YYYY-MM-DD HH:mm}}'}>Дата и время</option><option value={'{{title}}'}>Название новой заметки</option><option value={'{{source}}'}>Название открытой заметки</option><option value={'{{sourceFolder}}'}>Папка открытой заметки</option></select></label>
        {#if field.type === 'select'}<label class="nn-field"><span>Варианты — по одному в строке</span><textarea aria-label={`Варианты поля ${index + 1}`} rows="3" bind:value={field.options}></textarea></label>{/if}
        <div class="nn-checks">
          <label><input type="checkbox" bind:checked={field.required} /> Обязательное</label>
          <label><input type="checkbox" bind:checked={field.property} /> Записать в свойства</label>
          <label><input type="checkbox" bind:checked={field.hidden} /> Автоматическое</label>
        </div>
      </div>
    {/each}
    <button type="button" class="nn-secondary" onclick={addField}>+ Добавить поле</button>
  </details>

  <details open>
    <summary>Содержание заметки</summary>
    <label class="nn-field"><span>Текст и разделы</span><textarea class="nn-body-editor" aria-label="Содержание шаблона" rows="9" bind:this={bodyArea} bind:value={draft.body}></textarea></label>
    <div class="nn-inline"><button type="button" class="nn-secondary" onclick={() => draft.body += '\n## Новый раздел\n\n'}>+ Раздел</button><button type="button" class="nn-secondary" onclick={() => draft.body += '\n- [ ] '}>+ Пункт списка дел</button></div>
  </details>

  <div class="nn-variables">
    <div class="nn-inline"><strong>Вставить переменную</strong><select aria-label="Куда вставить переменную" bind:value={tokenTarget}><option value="body">В текст у курсора</option><option value="filename">В имя файла</option><option value="folder">В папку</option></select></div>
    <div class="nn-tags"><button type="button" class="nn-tag" onclick={() => insert('{{title}}')}>Название заметки</button><button type="button" class="nn-tag" onclick={() => insert('{{time:HH-mm}}')}>Время</button><button type="button" class="nn-tag" onclick={() => insert('{{source}}')}>Название открытой заметки</button><button type="button" class="nn-tag" onclick={() => insert('{{sourceFolder}}')}>Папка открытой заметки</button>{#each draft.fields as field (field.id)}<button type="button" class="nn-tag" onclick={() => insert(`{{${field.key}}}`)}>{field.label}</button>{/each}</div>
    <div class="nn-inline"><label class="nn-field"><span>Формат даты</span><input aria-label="Формат даты" bind:value={dateFormat} list="nn-date-formats" /></label><button type="button" class="nn-secondary" onclick={() => insert(`{{date:${dateFormat || 'YYYY-MM-DD'}}}`)}>Вставить дату</button></div>
    <datalist id="nn-date-formats"><option value="YYYY-MM-DD"></option><option value="YYYY/MM"></option><option value="DD.MM.YYYY"></option><option value="YYYY-MM-DD HH-mm"></option></datalist>
    <small>YYYY — год, MM — месяц, DD — день. Например, папка «Медиа/2026/11» или имя «2026-11-09 — Название».</small>
  </div>

  {#if errors.length}<div class="nn-errors" role="alert">{#each errors as error}<p>{error}</p>{/each}</div>{/if}
  {#if preview}<div class="nn-path"><small>Пример пути</small><span>{sample.path}</span></div><pre class="nn-preview">{sample.text || 'Пустая заметка'}</pre><p class="nn-muted">Пример с названием «Пример заметки» и значениями по умолчанию. Остальные поля заполняются при создании.</p>{/if}
  {#if deleting}<div class="nn-confirm" role="alert"><p>Удалить шаблон «{draft.name}»? Созданные заметки сохранятся.</p><button type="button" class="nn-secondary" onclick={() => deleting = false}>Отмена</button><button type="button" class="nn-danger" onclick={remove}>Удалить шаблон</button></div>{/if}
  <div class="nn-builder-footer">
    {#if isSaved}<button type="button" class="nn-danger" onclick={() => deleting = true}>Удалить</button>{/if}
    <button type="button" class="nn-secondary" onclick={() => preview = !preview}>{preview ? 'Скрыть пример' : 'Предпросмотр'}</button>
    <span class="nn-save-status" role="status">{dirty ? 'Есть изменения' : message}</span>
    <button type="button" class="nn-primary" onclick={save}>Сохранить шаблон</button>
  </div>
</div>
