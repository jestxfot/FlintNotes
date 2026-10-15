/**
 * Asking pages of the web from the server, the way the browser reaches them.
 *
 * A browser follows the computer's proxy settings; Node's own requests do not.
 * Where the web is reached through a proxy (one set for the whole system on
 * Windows, or in HTTPS_PROXY / HTTP_PROXY), the server would not get through
 * where the browser does: a link card would say the page did not answer while
 * the page opens fine in the browser. So the proxy is looked up and used here.
 */
import { execFile } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'

export interface WebPage {
  status: number
  /** The address the page came from, after redirects. */
  url: string
  text: string
}

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
  'accept-language': 'ru,en;q=0.8',
}

let proxyCache: { proxy: URL | null; at: number } | null = null

/** The proxy of this computer, if there is one: from the environment, or Windows' own settings. Looked up once a minute. */
async function systemProxy(): Promise<URL | null> {
  if (proxyCache && Date.now() - proxyCache.at < 60_000) return proxyCache.proxy
  const parse = (value: string | undefined) => {
    if (!value) return null
    try {
      return new URL(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`)
    } catch {
      return null
    }
  }
  let proxy = parse(process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy)
  if (!proxy && process.platform === 'win32') {
    const settings = await new Promise<string>((resolve) =>
      execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { windowsHide: true, timeout: 3000 }, (err, out) => resolve(err ? '' : out)),
    )
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(settings)
    const server = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(settings)?.[1]
    if (enabled && server) {
      // "host:port", or one per kind: "http=host:port;https=host:port".
      const parts = Object.fromEntries(server.split(';').map((part) => (part.includes('=') ? part.split('=') : ['all', part])))
      proxy = parse(parts.https ?? parts.http ?? parts.all)
    }
  }
  // Only plain web proxies are spoken to; a SOCKS one is left to the system.
  if (proxy && proxy.protocol !== 'http:' && proxy.protocol !== 'https:') proxy = null
  proxyCache = { proxy, at: Date.now() }
  return proxy
}

/** Whether a proxy is set; then a page's address is resolved by the proxy, not here. */
export async function viaProxy(): Promise<boolean> {
  return (await systemProxy()) !== null
}

/** One request through the proxy: a tunnel (CONNECT) for https, the full address for http. */
function throughProxy(target: URL, proxy: URL, timeout: number): Promise<http.IncomingMessage> {
  const auth = proxy.username ? { 'proxy-authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` } : {}
  const proxyPort = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80)
  return new Promise((resolve, reject) => {
    const fail = (err: Error) => reject(err)
    if (target.protocol === 'http:') {
      const request = http.request({ host: proxy.hostname, port: proxyPort, method: 'GET', path: target.href, headers: { ...BROWSER_HEADERS, host: target.host, ...auth }, timeout }, resolve)
      request.on('error', fail).on('timeout', () => request.destroy(new Error('timeout')))
      return void request.end()
    }
    // A deadline of its own rather than the `timeout` option, which over a tunnel cuts answers short.
    let request: http.ClientRequest | null = null
    const deadline = setTimeout(() => (request ?? tunnel).destroy(new Error('timeout')), timeout)
    const tunnel = http.request({ host: proxy.hostname, port: proxyPort, method: 'CONNECT', path: `${target.hostname}:${target.port || 443}`, headers: { host: `${target.hostname}:${target.port || 443}`, ...auth } })
    tunnel.on('error', (err) => (clearTimeout(deadline), fail(err)))
    tunnel.on('connect', (answer, socket) => {
      if (answer.statusCode !== 200) {
        clearTimeout(deadline)
        socket.destroy()
        return fail(new Error(`proxy answered ${answer.statusCode}`))
      }
      request = https.request({ host: target.hostname, path: `${target.pathname}${target.search}`, method: 'GET', headers: BROWSER_HEADERS, agent: false, createConnection: () => tls.connect({ socket, servername: target.hostname }) }, (res) => {
        res.on('end', () => clearTimeout(deadline)).on('close', () => clearTimeout(deadline))
        resolve(res)
      })
      request.on('error', (err) => (clearTimeout(deadline), fail(err)))
      request.end()
    })
    tunnel.end()
  })
}

/** Reads up to `limit` characters of a response. */
async function readText(body: AsyncIterable<Uint8Array>, limit: number): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of body) {
    text += decoder.decode(chunk, { stream: true })
    if (text.length >= limit) break
  }
  return text
}

/** Gets a page of the web, through the computer's proxy when it has one; redirects are followed. */
export async function webGet(address: string, options: { timeout?: number; limit?: number } = {}): Promise<WebPage> {
  try {
    return await nodeGet(address, options)
  } catch (err) {
    // Windows reaches the web with all of its own settings, a proxy given by an automatic
    // configuration script (PAC) included, which Node knows nothing of. Asked through
    // Windows itself, the page comes the way it comes to the browser.
    if (process.platform !== 'win32') throw err
    const reason = describe(err)
    try {
      return await windowsGet(address, options)
    } catch (again) {
      throw new Error(`${reason}; через Windows: ${describe(again)}`)
    }
  }
}

/** What went wrong, in a few words: the system's error code if there is one. */
export function describe(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause
  const code = cause?.code ?? (err as { code?: string })?.code
  const message = cause?.message ?? (err instanceof Error ? err.message : String(err))
  return code && !message.includes(code) ? `${code}: ${message}` : message
}

/** A page asked through Windows' own web client (PowerShell), with the system's proxy settings. */
function windowsGet(address: string, { timeout = 8000, limit = 600_000 }: { timeout?: number; limit?: number }): Promise<WebPage> {
  // The address goes in by the environment, never into the command's text.
  const script = [
    '$ProgressPreference = "SilentlyContinue"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12',
    `$r = Invoke-WebRequest -UseBasicParsing -Uri $env:FLINT_URL -TimeoutSec ${Math.ceil(timeout / 1000) + 5} -UserAgent $env:FLINT_AGENT -Headers @{ 'Accept-Language' = 'ru,en;q=0.8' }`,
    '[Console]::Out.Write([string]$r.StatusCode + "`n" + $r.BaseResponse.ResponseUri.AbsoluteUri + "`n")',
    '[Console]::Out.Write($r.Content)',
  ].join('; ')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, FLINT_URL: address, FLINT_AGENT: BROWSER_HEADERS['user-agent'] }, windowsHide: true, timeout: timeout + 10_000, maxBuffer: Math.max(limit * 4, 8_000_000), encoding: 'utf8' },
      (err, out, errors) => {
        if (err) return reject(new Error((errors || err.message).trim().split(/\r?\n/)[0] || 'PowerShell'))
        const [status, url, ...rest] = out.split('\n')
        resolve({ status: Number(status) || 200, url: url?.trim() || address, text: rest.join('\n').slice(0, limit) })
      },
    )
  })
}

/** A page asked by Node itself: straight, or through the proxy of the environment or of Windows' settings. */
async function nodeGet(address: string, { timeout = 8000, limit = 600_000 }: { timeout?: number; limit?: number } = {}): Promise<WebPage> {
  const proxy = await systemProxy()
  if (!proxy) {
    const res = await fetch(address, { signal: AbortSignal.timeout(timeout), redirect: 'follow', headers: BROWSER_HEADERS })
    const text = res.body ? await readText(res.body as unknown as AsyncIterable<Uint8Array>, limit) : ''
    return { status: res.status, url: res.url || address, text }
  }
  let url = new URL(address)
  for (let hops = 0; hops < 6; hops++) {
    const res = await throughProxy(url, proxy, timeout)
    const location = res.headers.location
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
      res.resume()
      url = new URL(location, url)
      continue
    }
    const text = await readText(res, limit)
    res.destroy()
    return { status: res.statusCode ?? 0, url: url.href, text }
  }
  throw new Error('too many redirects')
}

/**
 * What a video's page says of it: its title, channel, frame and its own
 * description (the text under the video), cut to a few lines. Hashtag lines
 * at the top of the description are left out: they are not what it says.
 */
export async function youtubeVideo(address: string): Promise<{ title: string; author: string; image: string; description: string; problem?: string } | null> {
  const [embed, page] = await Promise.allSettled([webGet(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(address)}`, { timeout: 8000, limit: 50_000 }), webGet(address, { timeout: 10_000, limit: 3_000_000 })])
  let title = ''
  let author = ''
  let image = ''
  if (embed.status === 'fulfilled' && embed.value.status === 200) {
    try {
      const video = JSON.parse(embed.value.text) as { title?: string; author_name?: string; thumbnail_url?: string }
      title = video.title ?? ''
      author = video.author_name ?? ''
      image = video.thumbnail_url ?? ''
    } catch {
      // The page below may still say it.
    }
  }
  let description = ''
  // Why the description could not be had, to be told rather than guessed.
  let problem = page.status === 'rejected' ? describe(page.reason) : page.value.status !== 200 ? `страница видео ответила ${page.value.status}` : ''
  if (page.status === 'fulfilled' && page.value.status === 200) {
    const raw = /"shortDescription":"((?:\\.|[^"\\])*)"/.exec(page.value.text)?.[1]
    if (raw) {
      try {
        description = cleanDescription(JSON.parse(`"${raw}"`) as string)
      } catch {
        description = ''
      }
    }
    if (!title) title = /<meta\s+property="og:title"\s+content="([^"]*)"/.exec(page.value.text)?.[1] ?? ''
    if (!author) author = /"ownerChannelName":"((?:\\.|[^"\\])*)"/.exec(page.value.text)?.[1] ?? ''
    if (!description && !/"shortDescription"/.test(page.value.text)) problem = 'на странице видео нет описания (возможно, YouTube показал страницу согласия)'
  }
  if (!title) return null
  return { title, author, image, description: description || author, ...(problem ? { problem } : {}) }
}

/** The description as a few readable lines: no rows of hashtags, no runs of spaces, at most about 300 letters. */
export function cleanDescription(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    // A line of nothing but hashtags says nothing.
    .filter((line) => line && !/^(#[\p{L}\p{N}_]+[\s,]*)+$/u.test(line))
  let joined = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (joined.length > 300) {
    const cut = joined.slice(0, 300)
    joined = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 200)).replace(/[,.;:!?\s]+$/, '')}…`
  }
  return joined
}

/** One step of a check of the way to a page: what was tried, how long it took, what came of it. */
export interface NetStep {
  step: string
  ok: boolean
  ms: number
  result: string
}

/**
 * Tries every way the server has to a page, one by one, and says what came of
 * each: for finding out, on the computer where it happens, why a page that
 * opens in the browser does not open for the server.
 */
export async function checkWay(address: string): Promise<NetStep[]> {
  const steps: NetStep[] = []
  const timed = async (step: string, run: () => Promise<string>) => {
    const began = Date.now()
    try {
      steps.push({ step, ok: true, ms: Date.now() - began, result: await run() })
    } catch (err) {
      steps.push({ step, ok: false, ms: Date.now() - began, result: describe(err) })
    }
    steps[steps.length - 1].ms = Date.now() - began
  }
  const url = new URL(address)
  const sayPage = (page: WebPage) => {
    const description = /"shortDescription":"/.test(page.text) ? 'описание видео есть' : /og:description/.test(page.text) ? 'описание (og:description) есть' : 'описания на странице нет'
    return `ответ ${page.status}, ${Math.round(page.text.length / 1024)} КБ, ${description}${page.url !== address ? `, пришла с ${page.url}` : ''}`
  }
  await timed('Прокси компьютера', async () => {
    proxyCache = null
    const proxy = await systemProxy()
    return proxy ? `${proxy.protocol}//${proxy.host}` : 'не задан (ни HTTPS_PROXY, ни в настройках Windows)'
  })
  await timed(`Адрес ${url.hostname} (DNS)`, async () => {
    const { lookup } = await import('node:dns/promises')
    return (await lookup(url.hostname, { all: true })).map((one) => one.address).join(', ')
  })
  await timed('Напрямую из Node', async () => {
    const res = await fetch(address, { signal: AbortSignal.timeout(10_000), redirect: 'follow', headers: BROWSER_HEADERS })
    return sayPage({ status: res.status, url: res.url || address, text: res.body ? await readText(res.body as unknown as AsyncIterable<Uint8Array>, 3_000_000) : '' })
  })
  const proxy = await systemProxy()
  if (proxy) await timed('Через прокси компьютера', async () => sayPage(await nodeGet(address, { timeout: 10_000, limit: 3_000_000 })))
  if (process.platform === 'win32') await timed('Через Windows (PowerShell)', async () => sayPage(await windowsGet(address, { timeout: 15_000, limit: 3_000_000 })))
  return steps
}
