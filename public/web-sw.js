// Pictures of the web through the way the FlintNotes server reaches it.
//
// Where a proxy is chosen in the settings (or the computer has one), the server goes to the web
// through it; the browser, asking for a card's picture or a picture in a note itself, might not
// get through where the server does. This worker hands such pictures to the server
// (`/api/web?url=…`) and gives the page what the server got; without a proxy, or when the server
// could not get it, the browser asks as it always would. Nothing of the app itself passes here.

/** Whether the server goes to the web through a proxy: `null` until the server has said. Asked again every half minute. */
let through = null
let asking = null
let asked = 0

function ask() {
  if (asking && Date.now() - asked < 30_000) return asking
  asked = Date.now()
  asking = fetch('/api/proxy', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((answer) => !!answer && answer.proxy !== 'off' && (answer.proxy !== 'system' || !!answer.computer))
    .catch(() => false)
    .then((yes) => (through = yes))
  return asking
}

self.addEventListener('install', (event) => {
  // The app's own requests (saving notes, the layout as the page closes) go straight to the network,
  // never waking this worker: a page under a worker would otherwise wait for it on every request.
  // A browser that cannot keep its own requests away from the worker gets no worker at all: there,
  // a request made as the page closes would wait for it and be lost. Pictures then come as always.
  if (!event.addRoutes || typeof URLPattern !== 'function') return void event.waitUntil(self.registration.unregister())
  const own = new URLPattern({ protocol: self.location.protocol.slice(0, -1), hostname: self.location.hostname, port: self.location.port })
  event.waitUntil(event.addRoutes([{ condition: { urlPattern: own }, source: 'network' }]).catch(() => self.registration.unregister()))
  self.skipWaiting()
})
self.addEventListener('activate', (event) => event.waitUntil(Promise.all([self.clients.claim(), ask()])))
self.addEventListener('message', (event) => {
  if (event.data?.type === 'proxy-changed') {
    asked = 0
    void ask()
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || request.destination !== 'image') return
  const url = new URL(request.url)
  if (url.origin === self.location.origin || (url.protocol !== 'http:' && url.protocol !== 'https:')) return
  if (Date.now() - asked >= 30_000) void ask()
  // With no proxy the browser asks as it always does: the worker stays out of the way.
  if (through === false) return
  event.respondWith(
    ask().then(async (yes) => {
      if (yes) {
        const res = await fetch(`/api/web?url=${encodeURIComponent(request.url)}`).catch(() => null)
        if (res && res.ok) return res
      }
      return fetch(request)
    }),
  )
})
