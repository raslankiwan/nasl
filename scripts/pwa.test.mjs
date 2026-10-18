import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./pwa/worker.js', import.meta.url), 'utf8');
function worker(network = async () => new Response('online'), owner = 'user-one') {
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
  const notifications = [],
    opened = [];
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
      registration: {
        showNotification: async (title, options) => notifications.push({ title, ...options }),
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (url) => opened.push(url),
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
        if (name === 'nasl-push-preferences')
          return { match: async () => (owner ? new Response(owner) : undefined) };
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
    notifications,
    opened,
    event: async (type, data) => {
      let promise;
      listeners[type]({
        ...data,
        waitUntil: (value) => {
          promise = value;
        },
      });
      await promise;
    },
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

test('push displays a notification with a safe deep link for the opted-in user', async () => {
  const sw = worker();
  await sw.event('push', {
    data: {
      json: () => ({
        userId: 'user-one',
        title: 'Birth soon',
        body: '001: Oct 21–29',
        url: '/notification?farmId=one&animalId=ewe',
        tag: 'pregnancy-one',
      }),
    },
  });
  assert.equal(sw.notifications.length, 1);
  assert.equal(sw.notifications[0].body, '001: Oct 21–29');
  assert.equal(
    sw.notifications[0].data.url,
    'https://app.example/notification?farmId=one&animalId=ewe',
  );
  let closed = false;
  await sw.event('notificationclick', {
    notification: {
      data: sw.notifications[0].data,
      close: () => {
        closed = true;
      },
    },
  });
  assert.equal(closed, true);
  assert.deepEqual(sw.opened, ['https://app.example/notification?farmId=one&animalId=ewe']);
});
test('signed-out, opted-out and different-user devices never display private reminders', async () => {
  for (const owner of [null, 'different-user']) {
    const sw = worker(undefined, owner);
    await sw.event('push', {
      data: { json: () => ({ userId: 'user-one', title: 'Private reminder' }) },
    });
    assert.equal(sw.notifications.length, 0);
  }
});
test('malformed payloads are ignored and notification clicks cannot open another origin', async () => {
  const sw = worker();
  await sw.event('push', {
    data: {
      json: () => {
        throw new Error('invalid JSON');
      },
    },
  });
  assert.equal(sw.notifications.length, 0);
  await sw.event('push', {
    data: { json: () => ({ userId: 'user-one', url: 'https://evil.test/path' }) },
  });
  assert.equal(sw.notifications[0].data.url, 'https://app.example/');
  await sw.event('notificationclick', {
    notification: { data: { url: 'https://evil.test' }, close() {} },
  });
  assert.deepEqual(sw.opened, ['https://app.example/']);
});
