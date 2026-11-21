// A page read the way a browser reads it: in a hidden window of its own. Sites behind a bot filter (Qrator and the like) let a plain
// request wait for ever or send it a «checking your browser» script, while a browser gets the page; this one is a browser.
// It is a last resort after the plain request (desktop/main.ts, `fetch-page`): a window is heavier than a request.
import { BrowserWindow } from 'electron'

interface Head {
  ready: boolean
  done: boolean
  html: string
}

export interface PageRead {
  url: string
  status: number
  text: string
  error?: string
}

/** The head of the page once it carries what a card is made of (its Open Graph title or description), or whatever head there is at the end. */
const HEAD = `(() => {
  const head = document.head
  if (!head) return null
  const ready = !!head.querySelector('meta[property="og:title"],meta[property="og:description"],meta[name="twitter:title"],meta[name="description"]')
  return { ready, done: document.readyState === 'complete', html: head.outerHTML }
})()`

/**
 * Loads `url` in a window nobody sees and returns its head as HTML text, which the caller reads like any fetched page.
 * Nothing of the app is in that window: a partition of its own that is kept in memory only (no cookies of the user's go in, none stay),
 * no preload, no Node, a sandbox, no permissions, no downloads, no further windows, no sound.
 */
export async function readInBrowser(url: URL, timeout: number, userAgent: string): Promise<PageRead> {
  const view = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: { partition: `flint-card-${Date.now()}-${Math.random().toString(36).slice(2)}`, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false },
  })
  const { webContents } = view
  webContents.session.setPermissionRequestHandler((_contents, _permission, allow) => allow(false))
  webContents.session.on('will-download', (event) => event.preventDefault())
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.setAudioMuted(true)
  webContents.setUserAgent(userAgent)
  let failure = ''
  // -3 is a load that gave way to another one (a redirect by script, a reload): the page is still coming.
  webContents.on('did-fail-load', (_event, code, description, _address, mainFrame) => {
    if (mainFrame && code !== -3) failure = description || `ошибка ${code}`
  })
  // The status of the page that stayed (a script's reload gives the last word).
  let status = 200
  webContents.on('did-navigate', (_event, _address, code) => {
    if (code) status = code
  })
  const ended = Date.now() + timeout
  // A page that has finished loading and still has no tags gets a moment: a bot check reloads it by script at once, a plain page never will.
  let doneAt = 0
  let best = null as Head | null
  try {
    webContents.loadURL(url.href).catch(() => {})
    while (Date.now() < ended && !failure && !view.isDestroyed()) {
      await new Promise((resume) => setTimeout(resume, 300))
      if (failure || view.isDestroyed()) break
      const head = (await webContents.executeJavaScript(HEAD, false).catch(() => null)) as Head | null
      if (!head) continue
      if (!best?.done && head.done) doneAt = Date.now()
      if (best?.done && !head.done) doneAt = 0
      best = head
      if (head.ready || (head.done && Date.now() - doneAt > 2_000)) break
    }
    if (best?.html && (best.ready || best.done)) return { url: webContents.getURL() || url.href, status, text: `<html>${best.html}</html>` }
    return { url: url.href, status: 0, text: '', error: failure ? `${failure}` : `в браузерном окне нет страницы за ${Math.round(timeout / 1000)} с` }
  } finally {
    if (!view.isDestroyed()) view.destroy()
  }
}
