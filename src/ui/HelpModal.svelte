<script lang="ts">
  import { onMount } from 'svelte'
  import { formatHotkey } from '../core/commands'
  import { app } from '../instance'

  let { onclose }: { onclose: () => void } = $props()

  let dialog: HTMLDialogElement
  // Every command that has a shortcut, including those added by enabled plugins.
  const hotkeys = app.commands
    .list()
    .filter((command) => app.commands.hotkeyOf(command))
    .sort((a, b) => a.name.localeCompare(b.name))

  const SYNTAX: [string, string][] = [
    ['# Заголовок', 'заголовки от # до ######'],
    ['**жирный** *курсив* ~~зачёркнутый~~ ==выделение==', 'оформление текста'],
    ['- пункт   1. пункт   - [ ] задача', 'списки и задачи'],
    ['[текст](адрес)   ![подпись](картинка.png)', 'ссылки и картинки'],
    ['> цитата   > [!note] Заголовок', 'цитаты и выноски'],
    ['```js … ```', 'блок кода с подсветкой'],
    ['--- свойства --- в первой строке', 'свойства заметки (YAML)'],
  ]

  onMount(() => dialog.showModal())
</script>

<dialog bind:this={dialog} {onclose} onclick={(event) => event.target === dialog && dialog.close()} aria-label="Справка">
  <button class="close" aria-label="Закрыть" onclick={() => dialog.close()}>×</button>
  <h2>Справка</h2>
  <p class="hint">
    Всё, кроме редактора и списка файлов, включается в настройках в разделе «Плагины». Любую команду можно найти по
    названию в палитре.
  </p>

  <h3>Горячие клавиши</h3>
  <div class="grid">
    {#each hotkeys as command (command.id)}
      <kbd>{formatHotkey(app.commands.hotkeyOf(command)!)}</kbd><span>{command.name}</span>
    {/each}
  </div>

  <h3>Разметка</h3>
  <div class="grid">
    {#each SYNTAX as [code, meaning] (code)}
      <code>{code}</code><span>{meaning}</span>
    {/each}
  </div>
</dialog>

<style>
  dialog {
    width: min(640px, calc(100vw - 32px));
    max-height: min(680px, calc(100vh - 32px));
    padding: 20px 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    background: var(--bg);
    color: var(--text);
    box-shadow: var(--shadow);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 18px;
  }

  h3 {
    margin: 18px 0 8px;
    color: var(--text-muted);
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .hint {
    margin: 0;
    color: var(--text-muted);
  }

  .close {
    position: absolute;
    top: 10px;
    right: 12px;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-m);
    color: var(--text-muted);
    font-size: 20px;
  }

  .grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    align-items: baseline;
  }

  kbd,
  code {
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    background: var(--bg-alt);
    font: 12px var(--font-mono);
    white-space: nowrap;
  }

  code {
    max-width: 340px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
