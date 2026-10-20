import { test } from 'node:test';
import assert from 'node:assert/strict';

// Browser transport runs without React Native, and never sees normal persistent auth storage.
test('support uses tab storage, consumes its link once, never refreshes, and fails closed after expiry', async (t) => {
  const tabStorage = new Map<string, string>();
  const location = {
    hash: '#impersonation=test-code',
    pathname: '/',
    search: '',
    replace: () => {},
  };
  const fakeWindow = {
    location,
    history: {
      replaceState: () => {
        location.hash = '';
      },
    },
    sessionStorage: {
      getItem: (key: string) => tabStorage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        tabStorage.set(key, value);
      },
      removeItem: (key: string) => {
        tabStorage.delete(key);
      },
    },
    get localStorage() {
      throw new Error('Must never touch regular user storage');
    },
  };
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: { headers?: Record<string, string> }) => {
      requests.push({ url, authorization: options.headers?.Authorization });
      return new Response(
        JSON.stringify(
          url.endsWith('/exchange')
            ? { accessToken: 'support-only', expiresAt, adminUrl: null }
            : { id: 'target-user' },
        ),
        { status: 200 },
      );
    },
  );
  const support = await import('./impersonation.ts');
  assert.equal(support.isImpersonating(), true);
  assert.equal(location.hash, '');
  await Promise.all([
    support.initializeSupport('https://api.test'),
    support.initializeSupport('https://api.test'),
  ]);
  assert.equal(requests.filter((r) => r.url.endsWith('/exchange')).length, 1);
  assert.equal(
    (await support.supportRequest<{ id: string }>('https://api.test', '/v1/auth/me')).id,
    'target-user',
  );
  assert.equal(requests.at(-1)?.authorization, 'Bearer support-only');
  assert.deepEqual([...tabStorage.keys()], ['nasl.supportSession']);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(expiresAt) + 1 });
  await assert.rejects(() => support.supportRequest('https://api.test', '/v1/auth/me'), {
    status: 401,
  });
  assert.equal(
    requests.length,
    2,
    'expired support does not fall back to a normal token or refresh',
  );
  support.clearSupport();
  assert.equal(support.isImpersonating(), true, 'isolation lasts until the tab navigates away');
});
