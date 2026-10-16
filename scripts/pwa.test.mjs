import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./pwa/worker.js', import.meta.url), 'utf8');
function worker(network = async () => new Response('online')) {
  const listeners = {};
  const deleted = [],
    installed = [],
    reads = [];
  const config = {
    cacheName: 'nasl-mobile-new',
    cachePrefix: 'nasl-mobile-',
    assets: ['/index.html', '/assets/app.js'],
  };
  let claimed = false;
  const context = {
    __CONFIG__: config,
    URL,
    Response,
    fetch: network,
    self: {
      location: { origin: 'https://app.example' },
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
      clients: {
        claim: async () => {
          claimed = true;
        },
      },
    },
    caches: {
      keys: async () => ['nasl-mobile-old', 'nasl-mobile-new', 'nasl-admin-old', 'offline-outbox'],
      delete: async (key) => {
        deleted.push(key);
      },
      open: async (name) => {
        assert.equal(name, config.cacheName);
        return {
          addAll: async (assets) => installed.push(...assets),
          match: async (path) => {
            reads.push(path);
            return new Response(path === '/index.html' ? 'offline shell' : 'cached asset');
          },
        };
      },
    },
  };
  vm.runInNewContext(source, context);
  return {
    deleted,
    installed,
    reads,
    claimed: () => claimed,
    lifecycle: (type) => {
      let promise;
      listeners[type]({
        waitUntil: (value) => {
          promise = value;
        },
      });
      return promise;
    },
    request: (url, method = 'GET', mode = 'cors') => {
      let promise;
      listeners.fetch({
        request: { url, method, mode },
        respondWith: (value) => {
          promise = value;
        },
      });
      return promise;
    },
  };
}

test('precache installs only build assets and activation preserves other apps and outboxes', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  assert.deepEqual(sw.installed, ['/index.html', '/assets/app.js']);
  await sw.lifecycle('activate');
  assert.deepEqual(sw.deleted, ['nasl-mobile-old']);
  assert.equal(sw.claimed(), true);
});

test('API responses, credentials, writes and other origins never enter the service worker cache', () => {
  const sw = worker();
  for (const [url, method, mode] of [
    ['https://api.example/v1/auth/login', 'POST', 'cors'],
    ['https://app.example/v1/farms', 'GET', 'cors'],
    ['https://app.example/api/private', 'GET', 'navigate'],
    ['https://app.example/assets/app.js', 'POST', 'cors'],
    ['https://other.example/assets/app.js', 'GET', 'cors'],
    ['https://app.example/unknown.json', 'GET', 'cors'],
  ])
    assert.equal(sw.request(url, method, mode), undefined);
  assert.deepEqual(sw.reads, []);
});

test('offline deep links reopen the shell; online navigation always uses the latest server HTML', async () => {
  const offline = worker(async () => {
    throw new TypeError('offline');
  });
  assert.equal(
    await (await offline.request('https://app.example/animal/123', 'GET', 'navigate')).text(),
    'offline shell',
  );
  const online = worker();
  assert.equal(
    await (await online.request('https://app.example/', 'GET', 'navigate')).text(),
    'online',
  );
  assert.deepEqual(online.reads, []);
});

test('server outages fall back to the shell without replacing HTTP authentication errors', async () => {
  const outage = worker(async () => new Response('unavailable', { status: 503 }));
  assert.equal(
    await (await outage.request('https://app.example/', 'GET', 'navigate')).text(),
    'offline shell',
  );
  const denied = worker(async () => new Response('denied', { status: 403 }));
  assert.equal((await denied.request('https://app.example/', 'GET', 'navigate')).status, 403);
});

test('known static assets work offline, without intercepting query-bearing requests', async () => {
  const sw = worker(async () => {
    throw new TypeError('offline');
  });
  assert.equal(
    await (await sw.request('https://app.example/assets/app.js')).text(),
    'cached asset',
  );
  assert.equal(sw.request('https://app.example/assets/app.js?token=private'), undefined);
});
