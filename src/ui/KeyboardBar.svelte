<script lang="ts">
  import { FORMAT_COMMANDS } from '../core/editor/format'
  import { app } from '../instance'
  import { watch } from './reactive.svelte'

  // The bar over a phone's keyboard while a note is typed in: what a phone has no keys for (undo, Tab), marks of
  // Markdown, and the buttons the user put here (Быстрые кнопки → «Над клавиатурой телефона»). A tap keeps the
  // keyboard up: the button never takes the focus from the note.
  const own = watch(app.toolbars, ['change'], () => app.toolbars.list('keyboard'))

  function icon(node: HTMLElement, name: string) {
    node.append(app.icons.draw(name))
  }
</script>

<div class="keyboard-bar" role="toolbar" aria-label="Правка" tabindex="-1" onpointerdown={(event) => event.preventDefault()}>
  <div class="keys">
    {#each own.current as button (button.id)}
      <button class="key" title={button.title} aria-label={button.title} style:color={button.color ? app.icons.css(button.color) : null} onclick={(event) => button.onClick(event)} use:icon={button.icon}></button>
    {/each}
    {#each FORMAT_COMMANDS as command (command.id)}
      <button class="key" title={command.name} aria-label={command.name} data-command={command.id} onclick={() => app.commands.run(command.id)} use:icon={command.icon}></button>
    {/each}
  </div>
  <button class="key hide" title="Убрать клавиатуру" aria-label="Убрать клавиатуру" onclick={() => (document.activeElement as HTMLElement | null)?.blur()} use:icon={'keyboard-off'}></button>
</div>

<style>
  .keyboard-bar {
    display: flex;
    flex: none;
    align-items: center;
    height: 46px;
    border-top: 1px solid var(--border);
    background: var(--bg-alt);
  }

  .keys {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 2px;
    min-width: 0;
    height: 100%;
    padding: 0 6px;
    overflow-x: auto;
    scrollbar-width: none;
    mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
  }

  .key {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 36px;
    border-radius: 10px;
    color: var(--text-muted);
    font-size: 19px;
  }

  .key:active {
    background: var(--bg-hover);
    color: var(--text);
  }

  .hide {
    margin: 0 4px;
    border-left: 1px solid var(--border);
    border-radius: 0;
  }
</style>
