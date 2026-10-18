import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionClient } from './sessionClient.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const expired = () => json({ error: { code: 'unauthorized' } }, 401);
function setup(fetcher: typeof fetch) {
  const data = new Map<string, string>([
    ['nasl.accessToken', 'old'],
    ['nasl.refreshToken', 'refresh-old'],
    ['nasl.deviceId', 'device'],
  ]);
  const store = {
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: async (k: string) => {
      data.delete(k);
    },
  };
  return { data, store, client: createSessionClient('', store, fetcher) };
}
for (const status of [429, 500, 503])
  test(`refresh ${status} preserves the session and propagates the outage`, async () => {
    const { client, data } = setup(async (url) =>
      String(url).endsWith('/refresh') ? new Response('gateway error', { status }) : expired(),
    );
    await assert.rejects(client.request('/me'), { status });
    assert.equal(data.get('nasl.refreshToken'), 'refresh-old');
  });
test('a refresh network failure does not become an authentication failure', async () => {
  const { client, data } = setup(async (url) => {
    if (String(url).endsWith('/refresh')) throw new TypeError('offline');
    return expired();
  });
  await assert.rejects(client.request('/me'), /offline/);
  assert.equal(data.get('nasl.refreshToken'), 'refresh-old');
});
test('only a rejected refresh clears the session', async () => {
  const { client, data } = setup(async () => expired());
  await assert.rejects(client.request('/me'), { status: 401 });
  assert.equal(data.has('nasl.refreshToken'), false);
});
test('simultaneous requests rotate once and a late 401 uses the new token', async () => {
  let rotations = 0;
  let release!: (response: Response) => void;
  const delayed = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const { client } = setup(async (url, init) => {
    if (String(url).endsWith('/refresh')) {
      rotations++;
      return json({ accessToken: 'new', refreshToken: 'refresh-new' });
    }
    if ((init?.headers as Record<string, string>).authorization === 'Bearer new')
      return json({ ok: true });
    return url === '/slow' ? delayed : expired();
  });
  const slow = client.request('/slow');
  await Promise.all([client.request('/one'), client.request('/two')]);
  release(expired());
  await slow;
  assert.equal(rotations, 1);
});
test('browser tabs coordinate rotation and reread shared credentials', async () => {
  let rotations = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/refresh')) {
      rotations++;
      return json({ accessToken: 'new', refreshToken: 'refresh-new' });
    }
    return (init?.headers as Record<string, string>).authorization === 'Bearer new'
      ? json({ ok: true })
      : expired();
  };
  const { store } = setup(fetcher);
  let lane: Promise<unknown> = Promise.resolve();
  const lock = <T>(work: () => Promise<T>) => {
    const next = lane.then(work);
    lane = next;
    return next;
  };
  await Promise.all([
    createSessionClient('', store, fetcher, lock).request('/one'),
    createSessionClient('', store, fetcher, lock).request('/two'),
  ]);
  assert.equal(rotations, 1);
});
test('sign-out wins over a late refresh', async () => {
  let release!: (response: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const { client, data } = setup(async (url) => {
    if (String(url).endsWith('/refresh')) {
      started();
      return response;
    }
    return expired();
  });
  const pending = client.request('/me');
  const rejected = assert.rejects(pending, { status: 401 });
  await ready;
  await client.clearTokens();
  release(json({ accessToken: 'new', refreshToken: 'refresh-new' }));
  await rejected;
  assert.equal(data.has('nasl.refreshToken'), false);
});
test('a non-JSON upstream error retains its HTTP status', async () => {
  const { client } = setup(async () => new Response('<html>Unavailable</html>', { status: 503 }));
  await assert.rejects(client.request('/me'), { status: 503 });
});
