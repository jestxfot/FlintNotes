<script lang="ts">
  import { onMount } from 'svelte'
  import Builder from './Builder.svelte'
  import type { TemplateStore } from './store'
  let { store, onclose }: { store: TemplateStore; onclose: () => void } = $props()
  let dialog: HTMLDialogElement
  onMount(() => dialog.showModal())
</script>

<dialog bind:this={dialog} class="nn-dialog nn-builder-dialog" aria-label="Конструктор шаблонов" {onclose}>
  <header class="nn-header"><div><h2>Конструктор шаблонов</h2><p>Настройте новую тематику заметок</p></div><button class="nn-close" type="button" aria-label="Закрыть конструктор" onclick={() => dialog.close()}>×</button></header>
  <div class="nn-builder-scroll"><Builder {store} /></div>
</dialog>
