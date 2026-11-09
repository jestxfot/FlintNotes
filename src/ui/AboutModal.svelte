<script lang="ts">
  import { onMount } from 'svelte'
  import { version } from '../../package.json'
  import { desktop, type DesktopUpdates } from '../core/desktop'
  import { errorMessage } from '../core/notice'
  import { app } from '../instance'

  let { onclose }: { onclose: () => void } = $props()
  let dialog: HTMLDialogElement
  let info = $state<DesktopUpdates | null>(null)
  let error = $state('')
  let installing = $state(false)
  const busy = $derived(!!info?.checking || !!info?.progress)
  const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} МБ`
  const status = $derived.by(() => {
    if (error) return error
    if (!desktop) return 'Вы открыли FlintNotes в браузере. Автообновление доступно в установленном приложении.'
    if (!info) return 'Загружаю сведения об обновлениях…'
    if (!info.supported) return 'Для получения обновлений установите FlintNotes из релиза.'
    if (installing) return 'Сохраняю заметки и перезапускаю…'
    if (info.progress) {
      const { loaded, total, version } = info.progress
      return `Загружаю версию ${version}: ${mb(loaded)}${total ? ` из ${mb(total)}` : ''}`
    }
    if (info.checking) return 'Проверяю наличие обновлений…'
    if (info.ready) return `Версия ${info.ready} загружена и готова к установке.`
    return info.result || 'Проверьте, доступна ли новая версия FlintNotes.'
  })

  function check() {
    if (busy || !desktop) return
    error = ''
    info = { ...info, supported: true, enabled: info?.enabled ?? true, checking: true }
    app.commands.run('core:check-updates')
  }
  async function install() {
    if (installing || !desktop) return
    installing = true
    error = ''
    try {
      // Shared with the registered install command and the settings screen.
      if (!await desktop.installUpdate()) {
        installing = false
        info = await desktop.updates()
        error = 'Загруженное обновление недоступно. Проверьте наличие новых версий ещё раз.'
      }
    } catch (err) { installing = false; error = errorMessage(err) }
  }

  onMount(() => {
    dialog.showModal()
    let gone = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const next = await desktop?.updates()
        if (!gone && next) info = next
      } catch (err) { if (!gone) error = errorMessage(err) }
      // Manual checks from the tray and checks already running share this state.
      if (!gone && desktop) timer = setTimeout(() => void read(), 500)
    }
    void read()
    return () => { gone = true; clearTimeout(timer) }
  })
</script>

<dialog bind:this={dialog} class="about-dialog" aria-label="О программе" {onclose}>
  <button class="close" aria-label="Закрыть" onclick={() => dialog.close()}>×</button>
  <img src="/favicon.svg" width="64" height="64" alt="" />
  <h2>FlintNotes</h2>
  <p class="version">Версия {info?.version || version}</p>
  <p class="description">Ваши заметки, знания и дела в одном месте.</p>
  <div class="updates">
    <h3>Обновления</h3>
    <p class="status" class:error={!!error || info?.result?.startsWith('Не удалось')} role="status">{status}</p>
    {#if info?.progress}
      <progress aria-label="Загрузка обновления" max={info.progress.total || 1} value={info.progress.total ? info.progress.loaded : undefined}></progress>
    {/if}
    {#if info?.checkedAt && !busy}<small>Последняя проверка: {new Date(info.checkedAt).toLocaleString('ru')}</small>{/if}
    {#if desktop}
      <div class="actions">
        <button class="primary" disabled={info?.supported === false || busy || installing} onclick={check}>{info?.progress ? 'Загружаю…' : busy ? 'Проверяю…' : 'Проверить обновления'}</button>
        {#if info?.ready}<button class="primary" disabled={busy || installing} onclick={install}>Перезапустить и обновить</button>{/if}
      </div>
    {/if}
  </div>
  <a href="https://github.com/jestxfot/FlintNotes/releases" target="_blank" rel="noreferrer">Все версии и описание изменений ↗</a>
</dialog>

<style>
  dialog { position: relative; width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 30px; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--bg); color: var(--text); box-shadow: var(--shadow); overflow-y: auto; text-align: center; }
  dialog::backdrop { background: rgb(0 0 0 / .4); }
  img { margin-bottom: 8px; }
  h2 { margin: 0; font-size: 26px; }
  .version { margin: 6px 0 0; color: var(--text-muted); }
  .description { margin: 18px 0 24px; color: var(--text-muted); font-size: 14px; }
  .close { position: absolute; top: 10px; right: 12px; width: 30px; height: 30px; border-radius: var(--radius-m); font-size: 24px; color: var(--text-muted); }
  .close:hover { background: var(--bg-hover); }
  .updates { padding: 18px; margin-bottom: 20px; border: 1px solid var(--border); border-radius: var(--radius-l); background: var(--bg-alt); text-align: left; }
  h3 { margin: 0; font-size: 14px; }
  .status { margin: 8px 0; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
  .error { color: #cf4242; }
  small { display: block; color: var(--text-muted); font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .primary { padding: 8px 12px; border-radius: var(--radius-m); background: var(--accent); color: var(--accent-text); font-size: 13px; }
  button:disabled { opacity: .6; cursor: default; }
  a { color: var(--accent); font-size: 13px; }
  progress { width: 100%; accent-color: var(--accent); }
  @media (max-width: 500px) { dialog { padding: 24px 18px; } }
</style>
