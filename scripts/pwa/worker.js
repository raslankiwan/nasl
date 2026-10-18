/* __CONFIG__ is filled with this build's static assets, never API responses. */
const { cacheName, cachePrefix, assets } = __CONFIG__;
const paths = new Set(assets);
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(cachePrefix) && key !== cacheName)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/v1/') ||
    url.pathname.startsWith('/api/')
  )
    return;
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.status < 500) return response;
        } catch {
          /* Reopen the installed shell when offline. */
        }
        const shell = await (await caches.open(cacheName)).match('/index.html');
        return shell || Response.error();
      })(),
    );
  } else if (paths.has(url.pathname) && !url.search) {
    event.respondWith(
      (async () => {
        const cached = await (await caches.open(cacheName)).match(url.pathname);
        return cached || fetch(request);
      })(),
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ENABLE_PUSH_WORKER') event.waitUntil(self.skipWaiting());
});
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let message;
      try {
        message = event.data?.json();
      } catch {
        return;
      }
      if (!message || typeof message.userId !== 'string') return;
      const owner = await (
        await (await caches.open('nasl-push-preferences')).match('/__nasl_push_owner__')
      )?.text();
      // Signing out/opt-out removes this local preference even without a network connection.
      if (owner !== message.userId) return;
      const url = new URL(
        typeof message.url === 'string' ? message.url : '/',
        self.location.origin,
      );
      await self.registration.showNotification(String(message.title || 'Nasl').slice(0, 100), {
        body: String(message.body || '').slice(0, 1000),
        tag: String(message.tag || 'nasl-birth'),
        icon: '/icons/icon-192.png',
        data: { url: url.origin === self.location.origin ? url.href : self.location.origin + '/' },
      });
    })(),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL(event.notification.data?.url || '/', self.location.origin);
      const target = url.origin === self.location.origin ? url.href : self.location.origin + '/';
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Do not navigate away from an unsaved form in another tab.
      const existing = windows.find((client) => client.url === target);
      if (existing) await existing.focus();
      else await self.clients.openWindow(target);
    })(),
  );
});
