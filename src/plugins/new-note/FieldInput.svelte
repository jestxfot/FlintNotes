<script lang="ts">
  import { optionsOf, type NoteField } from './model'
  let { field, value, onchange, notes = [] }: { field: NoteField; value: string | boolean; onchange: (value: string | boolean) => void; notes?: string[] } = $props()
  const id = $derived(`nn-field-${field.id}`)
</script>

<label class="nn-field" for={id}>
  <span>{field.label}{field.required ? ' *' : ''}</span>
  {#if field.type === 'checkbox'}
    <span class="nn-check"><input {id} type="checkbox" checked={value === true} required={field.required} onchange={(e) => onchange(e.currentTarget.checked)} /> Да</span>
  {:else if field.type === 'textarea'}
    <textarea {id} rows="3" required={field.required} value={String(value)} oninput={(e) => onchange(e.currentTarget.value)}></textarea>
  {:else if field.type === 'select'}
    <select {id} required={field.required} value={String(value)} onchange={(e) => onchange(e.currentTarget.value)}>
      <option value="">Выберите…</option>
      {#each optionsOf(field) as option}<option value={option}>{option}</option>{/each}
    </select>
  {:else}
    <input {id} type={field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} step={field.type === 'number' ? 'any' : undefined} required={field.required} value={String(value)} list={field.type === 'link' ? `${id}-notes` : undefined} placeholder={field.type === 'tags' ? 'Теги через запятую' : field.type === 'url' ? 'https://…' : undefined} oninput={(e) => onchange(e.currentTarget.value)} />
    {#if field.type === 'link'}<datalist id={`${id}-notes`}>{#each notes as note}<option value={note}></option>{/each}</datalist>{/if}
  {/if}
</label>
