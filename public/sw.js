// Afternoon Light service worker: offline app shell + push notifications.
const CACHE = 'al-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/icon.svg', '/icon-192.png'])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Pages: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put('/', copy))
        return res
      }).catch(() => caches.match('/')),
    )
    return
  }
  // Hashed build assets and fonts never change: cache first.
  const immutable = (url.origin === location.origin && url.pathname.startsWith('/assets/')) || url.hostname === 'fonts.gstatic.com'
  const stale = url.hostname === 'fonts.googleapis.com' || (url.origin === location.origin && /\.(png|svg|webmanifest)$/.test(url.pathname))
  if (immutable || stale) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') caches.open(CACHE).then((c) => c.put(req, res.clone()))
          return res
        })
        return immutable ? hit || net : hit ? (net.catch(() => hit), hit) : net
      }),
    )
  }
})

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'Afternoon Light', body: e.data?.text() } }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Afternoon Light', {
      body: d.body || '',
      tag: d.tag,
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      data: { taskId: d.taskId },
      actions: (d.actions || []).slice(0, 2),
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const { taskId } = e.notification.data || {}
  const action = e.action || 'open'
  const url = taskId ? `/?task=${encodeURIComponent(taskId)}&action=${encodeURIComponent(action)}` : '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === location.origin)
      if (win) {
        win.postMessage({ type: 'notification-action', taskId, action })
        return win.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
