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
