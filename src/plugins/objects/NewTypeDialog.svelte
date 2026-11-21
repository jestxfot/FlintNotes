<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { errorMessage, pickLook, type App } from '../../api'
  import { fileName, folderFor, type TypeDef, type World } from './model'
  import type { Registry } from './registry'

  let { app, registry, name: given, inner, outer, onclose }: {
    app: App; registry: Registry; name: string; inner: string; outer: string
    onclose: (type: TypeDef | null) => void
  } = $props()

  let dialog: HTMLDialogElement
  let nameInput: HTMLInputElement
  let name = $state(untrack(() => given))
  let world = $state<World>('outer')
  let folderEdited = $state(false)
  let folder = $state('')
  let icon = $state('box')
  let color = $state('')
  let fields = $state('')
  let myLife = $state(true)
  let error = $state('')
  let busy = $state(false)
  let iconNames = $state<string[]>([])
  let made: TypeDef | null = null

  const root = $derived(world === 'inner' ? inner : outer)
  // Until the folder is typed in, it follows the name: «Tool» goes to «Tools».
  const shownFolder = $derived(folderEdited ? folder : folderFor(name))
  const fullFolder = $derived([root, shownFolder.trim().replace(/^\/+|\/+$/g, '')].filter(Boolean).join('/'))
  const relations = $derived(
    fields.split(',').map((f) => f.trim()).filter(Boolean).flatMap((field) => {
      const type = registry.relationOf(field)
      return type ? [{ field, type: type.name }] : []
    }),
  )
  const matchingIcons = $derived(icon.trim() ? iconNames.filter((n) => n.includes(icon.trim().toLowerCase())).slice(0, 8) : [])
  const preview = $derived.by(() => {
    const el = app.icons.draw(icon || 'box', color)
    return el.outerHTML
  })

  onMount(() => {
    dialog.showModal()
    nameInput.focus()
    nameInput.select()
    void app.icons.load().then(() => (iconNames = app.icons.names()))
  })

  async function create() {
    error = ''
    const clean = fileName(name)
    if (!clean) return void (error = 'Назовите тип')
    if (registry.find(clean)) return void (error = `Тип «${clean}» уже есть`)
    busy = true
    try {
      const list = fields.split(',').map((f) => f.trim()).filter(Boolean)
      made = await registry.createType({
        name: clean, aliases: [], icon: icon.trim() || 'box', color, world, folder: fullFolder || clean,
        fields: [...new Set(list)], myLife, key: clean.toLowerCase(), description: '', path: '',
      })
      dialog.close()
    } catch (err) {
      error = errorMessage(err)
    } finally {
      busy = false
    }
  }

  async function chooseLook() {
    const look = await pickLook(app, 'Значок типа', { icon, color })
    if (!look) return
    icon = look.icon?.replace(/^lucide-/, '') || 'box'
    color = look.color ?? ''
  }

  /** Enter goes to the next field, Ctrl+Enter makes the type. */
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) return void create()
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>('input:not([type=checkbox])')]
    const at = inputs.indexOf(event.target as HTMLInputElement)
    if (at >= 0 && at < inputs.length - 1) inputs[at + 1].focus()
    else void create()
  }
</script>

<dialog bind:this={dialog} class="obj-dialog" aria-label="Новый тип" onclose={() => onclose(made)}>
  <header class="obj-dialog-head">
    <div>
      <h2>Новый тип</h2>
      <p>Новый вид объектов вашего хранилища: инструмент, рецепт, поездка. Сразу после создания его можно связывать через @.</p>
    </div>
    <button type="button" class="obj-close" aria-label="Закрыть" onclick={() => dialog.close()}>×</button>
  </header>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <form class="obj-form" onsubmit={(e) => { e.preventDefault(); void create() }} onkeydown={keydown}>
    <label class="obj-field"><span>Имя <small>в единственном числе, например «Инструмент»</small></span>
      <input bind:this={nameInput} bind:value={name} aria-label="Имя типа" /></label>

    <div class="obj-field"><span>Где он живёт</span>
      <div class="obj-worlds" role="radiogroup" aria-label="Мир">
        <button type="button" role="radio" aria-checked={world === 'inner'} class:active={world === 'inner'} onclick={() => (world = 'inner')}>Внутренний мир: ваше</button>
        <button type="button" role="radio" aria-checked={world === 'outer'} class:active={world === 'outer'} onclick={() => (world = 'outer')}>Внешний мир: создано другими</button>
      </div>
    </div>

    <label class="obj-field"><span>Папка <small>внутри «{root || 'корня хранилища'}»</small></span>
      <input aria-label="Папка" value={shownFolder} oninput={(e) => { folderEdited = true; folder = e.currentTarget.value }} /></label>

    <div class="obj-field"><span>Значок <small>начните вводить, чтобы найти</small></span>
      <div class="obj-icon-row">
        <button type="button" class="obj-icon-preview" title="Выбрать значок и цвет" aria-label="Выбрать значок и цвет" onclick={chooseLook}>{@html preview}</button>
        <input aria-label="Значок" bind:value={icon} list="obj-icon-names" />
        <datalist id="obj-icon-names">{#each matchingIcons as one}<option value={one}></option>{/each}</datalist>
      </div>
    </div>

    <label class="obj-field"><span>Поля <small>необязательно, через запятую</small></span>
      <input aria-label="Поля" bind:value={fields} placeholder="website, category" /></label>
    {#if relations.length}
      <p class="obj-hint">{#each relations as one, i}{i ? ', ' : ''}«{one.field}» будет ссылкой на {one.type}{/each}</p>
    {/if}

    <label class="obj-check"><input type="checkbox" bind:checked={myLife} aria-label="Связь с «Моей жизнью»" />
      <span><strong>Связь с «Моей жизнью»</strong><small>Можно связывать с проектами, ключевыми элементами и темами</small></span></label>

    <p class="obj-path"><small>Объекты будут в</small> {fullFolder || '/'}</p>
    {#if error}<p class="obj-error" role="alert">{error}</p>{/if}
    <footer class="obj-dialog-foot">
      <small>Enter — дальше · Ctrl+Enter — создать</small>
      <button type="button" class="obj-secondary" onclick={() => dialog.close()}>Отмена</button>
      <button type="submit" class="obj-primary" disabled={busy}>Создать</button>
    </footer>
  </form>
</dialog>
