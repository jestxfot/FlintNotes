import { parse } from 'yaml'
import { cm, errorMessage, Plugin, type CodeBlockProcessor } from '../../api'
import './style.css'

const WEB = /^https?:\/\//i
const PICTURES = '.flint/embed-pictures.json'
/** Paths of t.me that are not a name: invitations, stickers, sharing and the like. */
const TELEGRAM_PATHS = new Set(['joinchat', 'addstickers', 'addemoji', 'addlist', 'addtheme', 'share', 'proxy', 'socks', 'setlanguage', 'login', 'boost', 'contact', 'iv', 'invoice', 'giftcode', 'confirmphone'])

/**
 * ```embed
 * title: "…"
 * image: "https://…"
 * description: "…"
 * url: "https://…"
 * favicon: "https://…"
 * aspectRatio: "52.5"
 * ```
 */
export default class LinkEmbed extends Plugin {
  /** Pictures found for cards that were saved without one: address of the page -> address of its picture (`''` if it has none). */
  private pictures: Record<string, string> = {}
  private saving: ReturnType<typeof setTimeout> | undefined
  private waiting: (() => void)[] = []
  private busy = 0

  /** A picture that can be told from the address alone, or one found earlier. */
  private knownPicture(url: string): string {
    // A video's preview has a fixed address; no need to ask the page.
    return this.videoPictures(url)[0] ?? (this.pictures[url] || '')
  }

  /**
   * The preview frames of a video, best first. The large one does not exist for every
   * video (a small grey stand-in comes instead); the medium one always does and, unlike
   * the old default, has no black bars above and below.
   */
  private videoPictures(url: string): string[] {
    const video = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url)
    return video ? [`https://i.ytimg.com/vi/${video[1]}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${video[1]}/mqdefault.jpg`] : []
  }

  /**
   * The channel, group or person a Telegram address is of, and its picture, which Telegram gives
   * by the name alone: a card shows it even when the server could not read the page.
   */
  private telegram(url: string): { name: string; post?: string; picture: string } | null {
    const match = /^https?:\/\/(?:www\.)?(?:t\.me|telegram\.(?:me|dog))\/(?:s\/)?([A-Za-z]\w{3,31})(?:\/(\d+))?\/?(?:[?#]|$)/i.exec(url)
    if (!match || TELEGRAM_PATHS.has(match[1].toLowerCase())) return null
    return { name: match[1], ...(match[2] ? { post: match[2] } : {}), picture: `https://t.me/i/userpic/320/${match[1]}.jpg` }
  }

  /** Asks the page for its picture, a few pages at a time, and remembers the answer. */
  private async findPicture(url: string): Promise<string> {
    if (this.pictures[url] !== undefined) return this.pictures[url]
    if (this.busy >= 3) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.busy++
    try {
      if (this.pictures[url] === undefined) this.pictures[url] = (await this.app.vault.unfurl(url)).image || ''
    } catch {
      // A page that does not answer is asked again another time, not remembered as having no picture.
      return ''
    } finally {
      this.busy--
      this.waiting.shift()?.()
    }
    clearTimeout(this.saving)
    this.saving = setTimeout(() => void this.app.vault.write(PICTURES, JSON.stringify(this.pictures)).catch(() => {}), 2000)
    return this.pictures[url]
  }

  async onload() {
    const { app } = this
    try {
      this.pictures = JSON.parse((await app.vault.readOptional(PICTURES)) ?? '{}')
    } catch {
      this.pictures = {}
    }
    this.register(() => clearTimeout(this.saving))
    const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim())
    /** A picture may be on the web or in the vault. */
    const source = (value: string, path: string) => {
      if (!value) return ''
      if (WEB.test(value) || value.startsWith('data:image/')) return value
      const file = app.metadata.resolve(value.replace(/^!?\[\[|\]\]$/g, ''), path) ?? (app.vault.get(value) ? value : null)
      return file ? app.vault.url(file) : ''
    }

    const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim()}"`
    /** The picture's height as a percentage of its width, which Link Embed keeps so the card does not jump while loading. */
    const ratio = (src: string) =>
      new Promise<string>((resolve) => {
        if (!src) return resolve('')
        const image = new Image()
        image.onload = () => resolve(image.naturalWidth ? String(Math.round((image.naturalHeight / image.naturalWidth) * 1000) / 10) : '')
        image.onerror = () => resolve('')
        setTimeout(() => resolve(''), 4000)
        image.src = src
      })
    /** The name a card gets when the page could not be read: the address without its scheme. */
    const standIn = (address: string) => {
      try {
        const parsed = new URL(address)
        return `${parsed.hostname.replace(/^www\./, '')}${decodeURIComponent(parsed.pathname).replace(/\/$/, '')}`
      } catch {
        return address
      }
    }
    /** A name for a card whose page said nothing: the last words of the address read as a title (`ravioli-s-syrom-118782` → `Ravioli s syrom`). */
    const readable = (address: string) => {
      try {
        const slug = decodeURIComponent(new URL(address).pathname).split('/').filter(Boolean).pop() ?? ''
        const words = slug.replace(/\.\w{2,5}$/, '').replace(/[-_+]+/g, ' ').replace(/\s*\d{4,}\s*$/, '').replace(/\s+/g, ' ').trim()
        return words.length >= 3 ? words[0].toUpperCase() + words.slice(1) : ''
      } catch {
        return ''
      }
    }
    /** A colour of its own for each site, steady from visit to visit: the cover of a card without a picture is tinted with it. */
    const hueOf = (host: string) => {
      let hash = 0
      for (const letter of host) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0
      return hash % 360
    }
    /**
     * What a picture is for a cover, by its shape: a wide one fills the cover, a tall one (a poster, a phone screen) is shown whole on
     * a blurred copy of itself, an icon or a logo is centred small on a tinted ground. The card lays itself out from this.
     */
    const kindOf = (width: number, height: number): 'wide' | 'square' | 'tall' | 'icon' => {
      if (!width || !height) return 'wide'
      const shape = width / height
      if ((width < 200 && height < 200) || shape > 3 || shape < 0.25) return 'icon'
      return shape >= 1.25 ? 'wide' : shape >= 0.8 ? 'square' : 'tall'
    }
    /** Cards being filled in right now, and pages that would not answer this time. */
    const filling = new Set<string>()
    const unanswered = new Set<string>()
    /** Video cards asked about in this visit already. */
    const checked = new Set<string>()
    /** The reasons a video's description could not be read that were already told of: one notice per reason, not one per video. */
    const told = new Set<string>()
    /** Sites that did not answer, told of once a visit. */
    const toldSites = new Set<string>()
    /**
     * A card with empty fields asks the page once and writes what it says into
     * the block itself (as Link Embed writes it): what was written by hand stays.
     */
    const fill = async (data: Record<string, unknown>, setSource: (source: string) => void) => {
      const url = text(data.url)
      if (!WEB.test(url) || filling.has(url) || unanswered.has(url) || this.getSetting<boolean>('fillCards') === false) return
      const title = text(data.title)
      const placeholder = !title || title === url || title === standIn(url)
      const video = this.videoPictures(url).length > 0
      // A video card is asked once in a while even when it is full: its description may be only its channel,
      // written before the video's own description could be read.
      if (!placeholder && text(data.image) && text(data.description) && text(data.favicon) && (!video || checked.has(url))) return
      checked.add(url)
      filling.add(url)
      try {
        const page = await app.vault.unfurl(url)
        // A video's own frame is better than what its page names (that one has black bars).
        const image = text(data.image) || this.videoPictures(url)[0] || page.image || ''
        const next: Record<string, string> = {
          title: placeholder ? page.title || title || url : title,
          image,
          // A description that is only the channel's name gives way to the video's own.
          description: (text(data.description) && !(page.author && text(data.description) === page.author && page.description && page.description !== page.author) ? text(data.description) : page.description) || '',
          url,
        }
        const favicon = text(data.favicon) || page.favicon
        if (favicon) next.favicon = favicon
        const aspect = text(data.aspectRatio) || (image && image !== text(data.image) ? await ratio(image) : '')
        if (aspect) next.aspectRatio = aspect
        // Anything else the block says is kept, after the fields of the card.
        for (const [key, value] of Object.entries(data)) if (!(key in next) && value !== null && value !== undefined) next[key] = text(value)
        const changed = Object.entries(next).some(([key, value]) => value !== text(data[key]))
        // A video whose description the server could not read: said once, with the reason, instead of a silent channel name
        // (and once for all the videos that fail for the same reason: a page of them gave a notice each).
        if (page.problem && video && !told.has(page.problem)) {
          told.add(page.problem)
          app.notice(`Карточка YouTube: описание видео не получено — ${page.problem}. Что именно мешает, покажет команда «Проверить, видит ли сервер страницу карточки»`)
        }
        if (changed) setSource(Object.entries(next).map(([key, value]) => `${key}: ${quote(value)}`).join('\n'))
      } catch (err) {
        unanswered.add(url)
        // Said once per site, with the reason: a card left half empty without a word looks as if nothing was tried.
        const site = url.replace(/^https?:\/\/(www\.)?/i, '').split(/[/?#]/)[0]
        if (!toldSites.has(site)) {
          toldSites.add(site)
          app.notice(`Карточка ${site} не дописана: ${errorMessage(err)}. Что мешает, покажет команда «Проверить, видит ли сервер страницу карточки»`)
        }
      } finally {
        filling.delete(url)
      }
    }

    /** The block's fields as the text of the block. */
    const render = (fields: Record<string, string>) => Object.entries(fields).map(([key, value]) => `${key}: ${quote(value)}`).join('\n')
    /**
     * Reads the page again and gives the card's fields as the page says them now (what the page does not give stays; a picture chosen
     * from the vault stays), or `null` when nothing is different. Unlike filling in, this overwrites: the user asked for it.
     */
    const reread = async (data: Record<string, unknown>): Promise<Record<string, string> | null> => {
      const url = text(data.url)
      const page = await app.vault.unfurl(url)
      const old = text(data.image)
      // The picture the user put in from the vault is theirs; a web one is the page's, and may have changed.
      const image = old && !WEB.test(old) ? old : this.videoPictures(url)[0] || page.image || old
      const next: Record<string, string> = {
        title: page.title || text(data.title) || url,
        image,
        description: page.description || text(data.description),
        url,
      }
      const favicon = page.favicon || text(data.favicon)
      if (favicon) next.favicon = favicon
      const aspect = image === old ? text(data.aspectRatio) : await ratio(image)
      if (aspect) next.aspectRatio = aspect
      for (const [key, value] of Object.entries(data)) if (!(key in next) && value !== null && value !== undefined) next[key] = text(value)
      // What was found for this address before may be stale too.
      delete this.pictures[url]
      unanswered.delete(url)
      return Object.entries(next).some(([key, value]) => value !== text(data[key])) || Object.keys(data).length !== Object.keys(next).length ? next : null
    }
    /** The reason a card could not be refreshed, said once per try. */
    const refreshFailed = (url: string, err: unknown) => app.notice(`Карточка ${url.replace(/^https?:\/\/(www\.)?/i, '').split(/[/?#]/)[0]} не обновлена: ${errorMessage(err)}. Что мешает, покажет команда «Проверить, видит ли сервер страницу карточки»`)

    const card: CodeBlockProcessor = (block, el, { path, setSource }) => {
      const draw = (yaml: string) => {
        el.replaceChildren()
        let data: Record<string, unknown>
        try {
          const parsed: unknown = parse(yaml)
          if (!parsed || typeof parsed !== 'object') throw new Error('нужны поля title, url, …')
          data = parsed as Record<string, unknown>
        } catch (err) {
          const error = el.appendChild(document.createElement('div'))
          error.className = 'embed-card-error'
          error.textContent = `embed: ${err instanceof Error ? err.message : String(err)}`
          return
        }
        const url = text(data.url)
        void fill(data, setSource)
        // The card is laid out by the width of its own place in the note (a narrow one puts the cover above).
        el.classList.add('embed-card-host')
        const box = el.appendChild(document.createElement('a'))
        box.className = 'embed-card'
        if (WEB.test(url)) {
          box.href = url
          box.target = '_blank'
          box.rel = 'noopener noreferrer'
        }
        const body = box.appendChild(document.createElement('div'))
        body.className = 'embed-card-text'
        const title = body.appendChild(document.createElement('div'))
        title.className = 'embed-card-title'
        const named = text(data.title)
        // A card whose title is only its address (the page was not read yet) shows the address read as a name, not the address itself.
        title.textContent = !named || named === url || named === standIn(url) ? readable(url) || named || url : named
        const description = text(data.description)
        if (description) {
          const about = body.appendChild(document.createElement('div'))
          about.className = 'embed-card-description'
          about.textContent = description
        }
        const site = body.appendChild(document.createElement('div'))
        site.className = 'embed-card-url'
        const icon = source(text(data.favicon), path)
        if (icon) {
          const favicon = site.appendChild(document.createElement('img'))
          favicon.src = icon
          favicon.alt = ''
          favicon.onerror = () => favicon.remove()
        }
        let host = url
        try {
          host = new URL(url).hostname.replace(/^www\./, '')
        } catch {
          // Not an address: shown as it is.
        }
        const telegram = this.telegram(url)
        // A Telegram card says whose it is: the name the address is of, as Telegram writes it.
        site.append(telegram ? `${host} · @${telegram.name}` : host)
        box.title = url
        // Refresh: the page is read again and the card rewritten. Beside the card's link, not in it (a click would follow the link); shown on hover.
        if (WEB.test(url)) {
          const again = el.appendChild(document.createElement('button'))
          again.className = 'embed-card-refresh'
          again.title = 'Обновить карточку: прочитать страницу заново'
          again.setAttribute('aria-label', 'Обновить карточку')
          again.append(app.icons.draw('refresh-cw'))
          again.onclick = (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (filling.has(url)) return
            filling.add(url)
            again.disabled = true
            again.classList.add('is-spinning')
            void reread(data)
              .then((next) => (next ? setSource(render(next)) : app.notice('Карточка уже актуальна: страница говорит то же')))
              .catch((err) => refreshFailed(url, err))
              .finally(() => {
                filling.delete(url)
                again.disabled = false
                again.classList.remove('is-spinning')
              })
          }
        }

        /** A cover for a card without a picture: the site's colour and its first letter, so the card keeps its shape and says whose it is. */
        const generated = () => {
          if (box.querySelector('.embed-card-image')) return
          const frame = box.appendChild(document.createElement('div'))
          frame.className = 'embed-card-image is-generated'
          frame.style.setProperty('--hue', String(hueOf(host)))
          frame.dataset.kind = 'generated'
          box.dataset.cover = 'generated'
          const mark = frame.appendChild(document.createElement('span'))
          mark.className = 'embed-card-mark'
          mark.textContent = (telegram?.name ?? host).replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '↗'
        }
        /**
         * Shows the first of the pictures that really is one. A picture that does not load, or is
         * a stand-in a few dots wide, gives way to the next; when none is left, the page is asked.
         */
        const show = (pictures: string[], asked = false) => {
          const [picture, ...rest] = pictures
          box.querySelector('.is-generated')?.remove()
          const next = () => {
            frame.remove()
            if (rest.length) return show(rest, asked)
            if (!asked && WEB.test(url) && this.getSetting<boolean>('findPictures') !== false) void this.findPicture(url).then((found) => (found && found !== picture && box.isConnected ? show([found], true) : generated()))
            else generated()
          }
          const frame = box.appendChild(document.createElement('div'))
          // A channel's or a person's picture is a portrait, shown round as Telegram shows it.
          const avatar = !!telegram && !telegram.post && (picture === telegram.picture || /(^|\.)telesco\.pe\//i.test(picture.replace(/^https?:\/\//, '')))
          frame.className = avatar ? 'embed-card-image is-avatar' : 'embed-card-image'
          // The shape saved with the card (the height as a percentage of the width) lays the cover out before the picture is there: nothing jumps.
          const saved = Number(text(data.aspectRatio))
          const lay = (kind: string) => {
            frame.dataset.kind = kind
            box.dataset.cover = kind
          }
          if (avatar) lay('avatar')
          else {
            lay(saved > 0 ? kindOf(100, saved) : 'wide')
            frame.style.setProperty('--cover', `url(${JSON.stringify(picture)})`)
          }
          const image = frame.appendChild(document.createElement('img'))
          image.alt = ''
          image.loading = 'lazy'
          image.decoding = 'async'
          image.onerror = next
          image.onload = () => {
            // The stand-in a video site sends for a missing frame is 120 dots wide; an icon is not a picture either.
            const standIn = /i\.ytimg\.com/.test(picture) && image.naturalWidth <= 120 && rest.length > 0
            if (standIn || image.naturalWidth < 16) return next()
            // What the picture really is decides how its cover is laid out.
            if (!avatar) lay(kindOf(image.naturalWidth, image.naturalHeight))
          }
          image.src = picture
        }
        const written = source(text(data.image), path)
        const candidates = [...(written ? [written] : []), ...this.videoPictures(url), ...(this.pictures[url] ? [this.pictures[url]] : []), ...(telegram ? [telegram.picture] : [])]
        if (candidates.length) show([...new Set(candidates)])
        else {
          // Until the page's own picture is found (or if it has none) the card has a cover of its own colour.
          generated()
          // A card saved without a picture gets the page's own (its og:image), looked up once the card is on screen.
          if (WEB.test(url) && this.getSetting<boolean>('findPictures') !== false && this.pictures[url] === undefined) {
            watching?.disconnect()
            watching = new IntersectionObserver((entries) => {
              if (!entries.some((entry) => entry.isIntersecting)) return
              watching?.disconnect()
              void this.findPicture(url).then((found) => found && box.isConnected && !box.querySelector('.embed-card-image:not(.is-generated)') && show([found], true))
            })
            watching.observe(box)
          }
        }
      }
      let watching: IntersectionObserver | undefined
      draw(block)
      return { update: draw, destroy: () => watching?.disconnect() }
    }
    this.registerCodeBlockProcessor('embed', card)

    // ---- making a card from an address
    this.addSettings([
      {
        key: 'fillCards',
        name: 'Дописывать карточки',
        desc: 'Карточка с пустыми полями (название-заглушка, картинка, описание, значок сайта) один раз спрашивает страницу и записывает ответ в блок embed. Заполненное вручную не меняется',
        type: 'toggle',
        default: true,
      },
      {
        key: 'findPictures',
        name: 'Искать картинку для карточек без неё',
        desc: 'Карточка, сохранённая без картинки, получает картинку страницы (og:image; у видео YouTube — кадр). Заметка не меняется; найденное запоминается в .flint/embed-pictures.json',
        type: 'toggle',
        default: true,
      },
      {
        key: 'pasteMode',
        name: 'Когда вставлен адрес страницы',
        desc: 'Выбор появляется у курсора: оставить адрес, сделать карточку или ссылку с названием страницы. Отменяется как обычно, Ctrl+Z',
        type: 'select',
        default: 'ask',
        options: [
          { value: 'ask', label: 'Спросить, что с ним сделать' },
          { value: 'card', label: 'Сразу делать карточку (если адрес один в строке)' },
          { value: 'link', label: 'Сразу делать ссылку с названием страницы' },
          { value: 'off', label: 'Оставлять как есть' },
        ],
      },
    ])
    const block = async (address: string): Promise<string> => {
      // A page that does not answer still gets its card: the address is its name, and the picture is looked for later.
      const page = await app.vault.unfurl(address).catch((err) => {
        app.notice(`Карточка ссылки: ${errorMessage(err)} — карточка сделана без описания`)
        let name = address
        try {
          const parsed = new URL(address)
          name = `${parsed.hostname.replace(/^www\./, '')}${decodeURIComponent(parsed.pathname).replace(/\/$/, '')}`
        } catch {
          // The address as it is.
        }
        return { url: address, title: name, description: '', image: '', favicon: '' }
      })
      const aspect = await ratio(page.image)
      const lines = [`title: ${quote(page.title || address)}`, `image: ${quote(page.image)}`, `description: ${quote(page.description)}`, `url: ${quote(page.url)}`]
      if (page.favicon) lines.push(`favicon: ${quote(page.favicon)}`)
      if (aspect) lines.push(`aspectRatio: ${quote(aspect)}`)
      return `\`\`\`embed\n${lines.join('\n')}\n\`\`\``
    }
    /** Puts a card for `address` in place of `from..to`; the address stays as plain text if the page cannot be read. */
    const embed = async (view: InstanceType<typeof cm.view.EditorView>, address: string, from: number, to: number) => {
      // The address goes in at once and is swapped for the card when the page has answered.
      view.dispatch({ changes: { from, to, insert: address }, selection: { anchor: from + address.length } })
      try {
        const text = await block(address)
        const at = view.state.sliceDoc(from, from + address.length) === address ? from : view.state.doc.toString().indexOf(address)
        if (at < 0) return
        view.dispatch({ changes: { from: at, to: at + address.length, insert: `${text}\n` }, selection: { anchor: at + text.length + 1 } })
      } catch (err) {
        app.notice(`Карточка ссылки: ${errorMessage(err)}`)
      }
    }
    /** Puts `[title of the page](address)` in place of the address at `from`. */
    const titled = async (view: InstanceType<typeof cm.view.EditorView>, address: string, from: number) => {
      try {
        const page = await app.vault.unfurl(address)
        const at = view.state.sliceDoc(from, from + address.length) === address ? from : view.state.doc.toString().indexOf(address)
        if (at < 0) return
        const link = `[${(page.title || address).replace(/[\[\]]/g, ' ').replace(/\s+/g, ' ').trim()}](${address})`
        view.dispatch({ changes: { from: at, to: at + address.length, insert: link }, selection: { anchor: at + link.length } })
      } catch (err) {
        app.notice(`Ссылка: ${errorMessage(err)}`)
      }
    }
    this.registerEditorExtension(
      cm.view.EditorView.domEventHandlers({
        paste: (event, view) => {
          const mode = this.getSetting<string>('pasteMode') ?? 'ask'
          const pasted = event.clipboardData?.getData('text/plain').trim() ?? ''
          if (mode === 'off' || !/^https?:\/\/\S+$/i.test(pasted)) return false
          const { from, to } = view.state.selection.main
          // An address pasted over selected words is a link on those words; that is not asked about.
          if (from !== to) return false
          const line = view.state.doc.lineAt(from)
          const alone = !line.text.trim()
          if (mode === 'card' && !alone) return false
          event.preventDefault()
          if (mode === 'card') return void embed(view, pasted, line.from, line.to), true
          // The address goes in as it is; what to make of it is then chosen, or decided by the setting.
          view.dispatch({ changes: { from, insert: pasted }, selection: { anchor: from + pasted.length }, userEvent: 'input.paste' })
          if (mode === 'link') return void titled(view, pasted, from), true
          const place = view.coordsAtPos(from + pasted.length)
          app.menus.show({ x: place?.left ?? 0, y: (place?.bottom ?? 0) + 6 }, 'pasted-link', pasted, [
            { icon: 'x', title: 'Оставить как есть', onClick: () => view.focus() },
            {
              icon: 'panel-top',
              title: 'Создать карточку',
              onClick: () => {
                const now = view.state.doc.lineAt(Math.min(from, view.state.doc.length))
                // A card is a block of its own: an address inside a sentence gets it on the next line.
                if (now.text.trim() === pasted) void embed(view, pasted, now.from, now.to)
                else {
                  view.dispatch({ changes: { from, to: from + pasted.length, insert: '' } })
                  const end = view.state.doc.lineAt(Math.min(from, view.state.doc.length)).to
                  view.dispatch({ changes: { from: end, insert: `\n\n` } })
                  void embed(view, pasted, end + 2, end + 2)
                }
              },
            },
            { icon: 'link', title: 'Создать ссылку с названием страницы', onClick: () => void titled(view, pasted, from) },
          ])
          return true
        },
      }),
    )
    this.addCommand({
      id: 'refresh-card',
      name: 'Обновить карточку ссылки',
      icon: 'refresh-cw',
      scope: 'note',
      callback: async () => {
        const view = app.workspace.activeEditor
        if (!view) return
        const text = view.state.doc.toString()
        const cursor = view.state.selection.main.head
        const blocks = [...text.matchAll(/```embed\n([\s\S]*?)```/g)].map((m) => ({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, yaml: m[1] }))
        // The card under the cursor, or the only one in the note.
        const found = blocks.find((one) => one.from <= cursor && cursor <= one.to) ?? (blocks.length === 1 ? blocks[0] : undefined)
        if (!found) return app.notice('Поставьте курсор в карточку ссылки')
        let data: Record<string, unknown>
        try {
          data = parse(found.yaml) as Record<string, unknown>
          if (!data || typeof data !== 'object' || !WEB.test(String(data.url ?? '').trim())) throw new Error('в карточке нет адреса страницы')
        } catch (err) {
          return app.notice(`Карточка: ${errorMessage(err)}`)
        }
        try {
          const next = await reread(data)
          if (!next) return app.notice('Карточка уже актуальна: страница говорит то же')
          // The text may have moved while the page was read.
          const now = view.state.sliceDoc(found.from, found.to)
          const at = now.includes(found.yaml) ? found.from : view.state.doc.toString().indexOf(`\`\`\`embed\n${found.yaml}\`\`\``)
          if (at < 0) return
          view.dispatch({ changes: { from: at, to: at + found.to - found.from, insert: `\`\`\`embed\n${render(next)}\n\`\`\`` } })
        } catch (err) {
          refreshFailed(String(data.url), err)
        }
      },
    })
    this.addCommand({ id: 'check-page', name: 'Проверить, видит ли сервер страницу карточки', icon: 'stethoscope', scope: 'note', callback: () => void this.checkPage() })
    this.addInsertCommand('insert', 'Вставить пустую карточку ссылки', '```embed\ntitle: "|"\nimage: ""\ndescription: ""\nurl: ""\n```\n', 'link')
    this.addCommand({
      id: 'embed-selection',
      name: 'Превратить ссылку в карточку',
      callback: () => {
        const view = app.workspace.activeEditor
        if (!view) return
        const { from, to } = view.state.selection.main
        const line = view.state.doc.lineAt(from)
        // The selected address, or the one the cursor's line consists of.
        const [text, start, end] = from !== to ? [view.state.sliceDoc(from, to).trim(), from, to] : [line.text.trim(), line.from, line.to]
        if (!WEB.test(text) || /\s/.test(text)) return app.notice('Выделите адрес страницы или поставьте курсор в строку с ним')
        void embed(view, text, start, end)
      },
    })
  }

  /**
   * Shows how the server gets to the page of the card under the cursor (or the first card of the
   * note), step by step, and whether the browser itself reaches it: what a card cannot fill in,
   * this tells why, on the computer where it happens.
   */
  private async checkPage(): Promise<void> {
    const { app } = this
    const editor = app.workspace.activeEditor
    const text = editor?.state.doc.toString() ?? ''
    const cursor = editor?.state.selection.main.head ?? 0
    const cards = [...text.matchAll(/```embed\n([\s\S]*?)```/g)].map((m) => ({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, url: /^url:\s*"?([^"\n]+)"?/m.exec(m[1])?.[1]?.trim() ?? '' }))
    const card = cards.find((one) => one.from <= cursor && cursor <= one.to) ?? cards[0]
    const address = card?.url || window.prompt('Адрес страницы для проверки', 'https://www.youtube.com/watch?v=') || ''
    if (!/^https?:\/\//i.test(address)) return
    const dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.className = 'embed-check'
    const head = dialog.appendChild(document.createElement('h2'))
    head.textContent = 'Видит ли сервер страницу'
    const list = dialog.appendChild(document.createElement('pre'))
    list.textContent = `${address}\n\nПроверяю…`
    const buttons = dialog.appendChild(document.createElement('div'))
    buttons.className = 'embed-check-buttons'
    const copy = buttons.appendChild(document.createElement('button'))
    copy.textContent = 'Скопировать'
    copy.onclick = () => void navigator.clipboard.writeText(list.textContent ?? '').then(() => (copy.textContent = 'Скопировано'))
    const close = buttons.appendChild(document.createElement('button'))
    close.textContent = 'Закрыть'
    close.onclick = () => dialog.close()
    dialog.onclose = () => dialog.remove()
    dialog.showModal()
    const lines = [address, '']
    // The browser's own way, for comparison: the page itself is closed to it, but a video's short answer is not.
    const video = /youtube\.com|youtu\.be/i.test(address)
    if (video) {
      const began = performance.now()
      const browser = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(8000) })
        .then(async (res) => (res.ok ? `ответ ${res.status}: «${((await res.json()) as { title?: string }).title ?? ''}»` : `ответ ${res.status}`))
        .catch((err) => `не дошёл: ${errorMessage(err)}`)
      lines.push(`Браузер → YouTube (название видео): ${browser} — ${Math.round(performance.now() - began)} мс`)
    }
    try {
      const report = await app.vault.netCheck(address)
      lines.push(`Сервер FlintNotes: сборка ${report.build}, ${report.platform}`, '')
      for (const step of report.steps) lines.push(`${step.ok ? '✓' : '✗'} ${step.step}: ${step.result} — ${step.ms} мс`)
    } catch (err) {
      lines.push(`Сервер не ответил на проверку: ${errorMessage(err)} (возможно, работает старая сборка: «Настройки → Программа → Обновление»)`)
    }
    list.textContent = lines.join('\n')
  }

}
