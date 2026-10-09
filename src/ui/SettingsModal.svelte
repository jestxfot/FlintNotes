<script lang="ts">
  import { onMount } from 'svelte'
  import { app } from '../instance'
  import { watch } from './reactive.svelte'

  let { onclose }: { onclose: () => void } = $props()

  const PLUGINS = '#plugins'
  const { settings, plugins } = app

  let dialog: HTMLDialogElement
  let tab = $state('core')

  const sections = watch(settings, ['sections'], () => settings.listSections())
  const pluginList = watch(plugins, ['change'], () => plugins.list())
  const changed = watch(settings, ['change'], () => 0)
  // A plugin's section disappears when the plugin is turned off; show the plugin list then.
  const section = $derived(sections.current.find((s) => s.id === tab))

  function value<T>(scope: string, key: string): T {
    void changed.current
    return settings.get<T>(scope, key)
  }

  onMount(() => dialog.showModal())
</script>

<dialog
  bind:this={dialog}
  {onclose}
  onclick={(event) => event.target === dialog && dialog.close()}
  aria-label="Настройки"
>
  <nav>
    {#each sections.current as s (s.id)}
      {#if s.id === 'core'}
        <button class:active={section?.id === s.id} onclick={() => (tab = s.id)}>{s.title}</button>
        <button class:active={!section} onclick={() => (tab = PLUGINS)}>Плагины</button>
      {:else}
        <button class="sub" class:active={section?.id === s.id} onclick={() => (tab = s.id)}>{s.title}</button>
      {/if}
    {/each}
  </nav>

  <div class="body">
    <button class="close" aria-label="Закрыть" onclick={() => dialog.close()}>×</button>

    {#if section}
      <h2>{section.title}</h2>
      {#each section.defs as def (def.key)}
        {@const set = (v: unknown) => settings.set(section.id, def.key, v)}
        <label class="item">
          <span class="info">
            <span>{def.name}</span>
            {#if def.desc}<small>{def.desc}</small>{/if}
          </span>
          {#if def.type === 'toggle'}
            <input
              type="checkbox"
              class="switch"
              checked={value<boolean>(section.id, def.key)}
              onchange={(event) => set(event.currentTarget.checked)}
            />
          {:else if def.type === 'select'}
            <select value={value<string>(section.id, def.key)} onchange={(event) => set(event.currentTarget.value)}>
              {#each def.options as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          {:else if def.type === 'number'}
            <input
              type="number"
              min={def.min}
              max={def.max}
              step={def.step}
              value={value<number>(section.id, def.key)}
              onchange={(event) => {
                const n = event.currentTarget.valueAsNumber
                if (!Number.isNaN(n)) set(Math.min(def.max ?? n, Math.max(def.min ?? n, n)))
              }}
            />
          {:else if def.type === 'lines'}
            <textarea
              rows="4"
              spellcheck="false"
              placeholder={def.placeholder}
              value={value<string>(section.id, def.key)}
              onchange={(event) => set(event.currentTarget.value)}
            ></textarea>
          {:else}
            <input
              type="text"
              placeholder={def.placeholder}
              value={value<string>(section.id, def.key)}
              onchange={(event) => set(event.currentTarget.value)}
            />
          {/if}
        </label>
      {/each}
    {:else}
      <h2>Плагины</h2>
      <p class="hint">
        Всё, кроме редактора и списка файлов, включается здесь. Сторонние плагины кладутся в папку
        <code>.flint/plugins</code> хранилища и получают полный доступ к заметкам.
      </p>
      {#each pluginList.current as { manifest, enabled } (manifest.id)}
        <label class="item">
          <span class="info">
            <span>
              {manifest.name}
              {#if !manifest.builtin}<em>сторонний</em>{/if}
            </span>
            {#if manifest.description}<small>{manifest.description}</small>{/if}
          </span>
          <input
            type="checkbox"
            class="switch"
            checked={enabled}
            onchange={(event) =>
              event.currentTarget.checked ? plugins.enable(manifest.id) : plugins.disable(manifest.id)}
          />
        </label>
      {/each}
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(760px, calc(100vw - 32px));
    height: min(560px, calc(100vh - 32px));
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
    box-shadow: var(--shadow);
  }

  dialog[open] {
    display: flex;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }

  nav {
    display: flex;
    flex-direction: column;
    flex: 0 0 190px;
    gap: 2px;
    padding: 14px 8px;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    background: var(--bg-alt);
  }

  nav button {
    padding: 6px 10px;
    border-radius: 6px;
    color: var(--text-muted);
    text-align: left;
  }

  nav button.sub {
    padding-left: 22px;
  }

  nav button:hover,
  nav button.active {
    background: var(--bg-hover);
    color: var(--text);
  }

  .body {
    position: relative;
    flex: 1;
    min-width: 0;
    padding: 18px 24px;
    overflow-y: auto;
  }

  .close {
    position: absolute;
    top: 10px;
    right: 12px;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 20px;
  }

  .close:hover {
    background: var(--bg-hover);
  }

  h2 {
    margin: 0 0 12px;
    font-size: 18px;
  }

  .hint {
    margin: 0 0 8px;
    color: var(--text-muted);
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }

  .info {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 2px;
    min-width: 0;
  }

  small {
    color: var(--text-muted);
    font-size: 12.5px;
  }

  em {
    margin-left: 6px;
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text-muted);
    font-size: 11px;
    font-style: normal;
  }

  select,
  input[type='number'],
  input[type='text'] {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
  }

  input[type='number'] {
    width: 80px;
  }

  textarea {
    flex: 0 0 55%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: inherit;
    font: 12.5px/1.5 var(--font-mono);
    resize: vertical;
  }

  .switch {
    appearance: none;
    position: relative;
    flex: 0 0 38px;
    height: 22px;
    margin: 0;
    border-radius: 11px;
    background: var(--border);
    cursor: pointer;
    transition: background 0.15s;
  }

  .switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }

  .switch:checked {
    background: var(--accent);
  }

  .switch:checked::after {
    transform: translateX(16px);
  }
</style>
