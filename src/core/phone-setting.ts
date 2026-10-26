import type { App } from './app'
import type { SettingsSection } from './settings'
import { vaultAddress, type PhoneAccess } from './vault'

const LOCAL = ['localhost', '127.0.0.1', '[::1]']

/**
 * FlintNotes on a phone of the home network (the server's «a phone on the home network»): switched on here, it
 * gives the address with its key as a link and as a QR code for the phone's camera. The program's setting, not
 * the vault's: the server keeps it with the list of vaults.
 */
export const phoneSetting = (app: App): SettingsSection['defs'][number] => ({
  key: 'phone',
  group: 'Программа',
  section: 'Телефон',
  name: 'Доступ с телефона',
  desc: 'Заметки на телефоне или планшете в той же сети Wi‑Fi. Они остаются на этом компьютере: телефон открывает их, пока FlintNotes здесь запущен',
  type: 'custom',
  render: (el) => {
    const box = el.appendChild(document.createElement('div'))
    box.className = 'phone-setting'
    // Opened on the phone itself: the computer decides.
    if (!LOCAL.includes(location.hostname) && location.protocol !== 'flint:') {
      box.textContent = 'Эта страница открыта не на компьютере с FlintNotes. Доступ с телефона включается и выключается там'
      return () => box.remove()
    }
    const head = box.appendChild(document.createElement('label'))
    head.className = 'phone-switch-row'
    const toggle = head.appendChild(document.createElement('input'))
    toggle.type = 'checkbox'
    toggle.className = 'switch phone-switch'
    toggle.disabled = true
    const state = head.appendChild(document.createElement('small'))
    const body = box.appendChild(document.createElement('div'))
    body.className = 'phone-body'

    let chosen = 0
    const fail = (err: unknown) => {
      state.textContent = err instanceof Error ? err.message : String(err)
      toggle.disabled = false
    }
    const change = (asked: Parameters<typeof app.vault.setPhone>[0], doing: string) => {
      toggle.disabled = true
      state.textContent = doing
      void app.vault.setPhone(asked).then(show, fail)
    }

    function show(next: PhoneAccess) {
      toggle.disabled = false
      toggle.checked = next.on
      state.textContent = next.error ?? (next.on ? `Включено, порт ${next.port}` : 'Выключено')
      body.replaceChildren()
      if (!next.on || next.error || !next.key) return
      if (!next.addresses.length) {
        body.append(text('p', 'У компьютера сейчас нет адреса в сети: подключите его к Wi‑Fi или к роутеру кабелем'))
        return
      }
      chosen = Math.min(chosen, next.addresses.length - 1)
      const link = `${next.addresses[chosen]}${vaultAddress(app.vault.urlName || app.vault.name)}?key=${next.key}`

      const qr = body.appendChild(document.createElement('div'))
      qr.className = 'phone-qr'
      qr.setAttribute('role', 'img')
      qr.setAttribute('aria-label', 'QR-код адреса для телефона')
      void import('uqr').then(({ renderSVG }) => (qr.innerHTML = renderSVG(link, { ecc: 'M', border: 2, pixelSize: 6 })))

      const steps = body.appendChild(document.createElement('div'))
      steps.className = 'phone-steps'
      const list = steps.appendChild(document.createElement('ol'))
      list.append(text('li', 'Подключите телефон к той же сети Wi‑Fi'), text('li', 'Наведите камеру на код или откройте ссылку'), text('li', 'В меню браузера — «Добавить на главный экран»'))
      const row = steps.appendChild(document.createElement('div'))
      row.className = 'phone-link-row'
      const anchor = row.appendChild(document.createElement('a'))
      anchor.className = 'phone-link'
      anchor.href = link
      anchor.target = '_blank'
      anchor.title = link
      anchor.textContent = link.replace(/^https?:\/\//, '')
      const copy = row.appendChild(document.createElement('button'))
      copy.className = 'setting-button'
      copy.append(app.icons.draw('copy'), 'Копировать')
      copy.onclick = () =>
        void navigator.clipboard.writeText(link).then(
          () => copy.replaceChildren(app.icons.draw('check'), 'Скопировано'),
          () => copy.replaceChildren('Не удалось'),
        )
      if (next.addresses.length > 1) {
        const pick = steps.appendChild(document.createElement('label'))
        pick.className = 'phone-row'
        pick.append(text('span', 'Адрес компьютера'))
        const select = pick.appendChild(document.createElement('select'))
        next.addresses.forEach((address, i) => select.append(new Option(address.replace(/^http:\/\//, ''), String(i), false, i === chosen)))
        select.onchange = () => {
          chosen = Number(select.value)
          show(next)
        }
      }
      const portRow = steps.appendChild(document.createElement('div'))
      portRow.className = 'phone-row'
      portRow.append(text('span', 'Порт'))
      const port = portRow.appendChild(document.createElement('input'))
      port.type = 'number'
      port.min = '1024'
      port.max = '65535'
      port.value = String(next.port)
      const apply = portRow.appendChild(document.createElement('button'))
      apply.className = 'setting-button'
      apply.textContent = 'Применить'
      apply.hidden = true
      port.oninput = () => (apply.hidden = Number(port.value) === next.port)
      apply.onclick = () => change({ port: Number(port.value) }, 'Перехожу на новый порт…')
      const renew = portRow.appendChild(document.createElement('button'))
      renew.className = 'setting-button'
      renew.append(app.icons.draw('key-round'), 'Новый ключ')
      renew.title = 'Телефоны, которые входили раньше, больше не войдут, пока снова не откроют код'
      renew.onclick = () => change({ newKey: true }, 'Делаю новый ключ…')
      const warn = steps.appendChild(document.createElement('div'))
      warn.className = 'phone-note'
      warn.append(app.icons.draw('shield'), text('span', 'Ссылка с ключом открывает заметки — не пересылайте её. Не открывается? Проверьте, что сеть одна, и разрешите FlintNotes в брандмауэре Windows для частных сетей'))
    }

    toggle.onchange = () => change({ on: toggle.checked }, toggle.checked ? 'Включаю…' : 'Выключаю…')
    void app.vault.phone().then(show, fail)
    return () => box.remove()
  },
})

function text(tag: string, content: string): HTMLElement {
  const el = document.createElement(tag)
  el.textContent = content
  return el
}
