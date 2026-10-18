import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiClient, tokens } from './client';

const expired = () =>
  new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const renewed = { accessToken: 'access-new', refreshToken: 'refresh-new' };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('nasl.admin.deviceId', 'admin-device');
  tokens.set('access-old', 'refresh-old');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persistent session refresh', () => {
  test.each([429, 500, 503])('keeps the session when renewal returns %s', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/refresh') ? new Response('', { status }) : expired(),
      ),
    );
    await expect(apiClient.get('/v1/auth/me')).rejects.toMatchObject({ status });
    expect(tokens.access()).toBe('access-old');
    expect(tokens.refresh()).toBe('refresh-old');
  });

  test('keeps the session when the connection drops during renewal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/refresh')) throw new TypeError('Failed to fetch');
        return expired();
      }),
    );
    await expect(apiClient.get('/v1/auth/me')).rejects.toThrow('Failed to fetch');
    expect(tokens.refresh()).toBe('refresh-old');
  });

  test('removes credentials only when the server rejects the refresh token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => expired()),
    );
    await expect(apiClient.get('/v1/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(tokens.access()).toBeNull();
    expect(tokens.refresh()).toBeNull();
  });

  test('coalesces simultaneous expired requests into one rotation', async () => {
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      if (input.endsWith('/refresh')) return json(renewed);
      return (init.headers as Record<string, string>).authorization === 'Bearer access-new'
        ? json({ ok: true })
        : expired();
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await Promise.all([
      apiClient.get('/v1/auth/me'),
      apiClient.get('/v1/admin/stats'),
    ]);
    expect(result).toEqual([{ ok: true }, { ok: true }]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/refresh'))).toHaveLength(1);
    expect(tokens.refresh()).toBe('refresh-new');
  });

  test('a late 401 uses the already renewed token instead of rotating again', async () => {
    let release!: (response: Response) => void;
    const late = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      if (input.endsWith('/refresh')) return json(renewed);
      if ((init.headers as Record<string, string>).authorization === 'Bearer access-new')
        return json({ ok: true });
      return input.endsWith('/slow') ? late : expired();
    });
    vi.stubGlobal('fetch', fetchMock);
    const slow = apiClient.get('/slow');
    await apiClient.get('/fast');
    release(expired());
    await expect(slow).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/refresh'))).toHaveLength(1);
  });

  test('two tabs sharing storage coordinate refresh through the browser lock', async () => {
    let queue: Promise<unknown> = Promise.resolve();
    const lock = vi.fn((_name: string, work: () => Promise<boolean>) => {
      const result = queue.then(work);
      queue = result;
      return result;
    });
    vi.stubGlobal('navigator', { locks: { request: lock } });
    vi.resetModules();
    const otherTab = await import('./client');
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      if (input.endsWith('/refresh')) return json(renewed);
      return (init.headers as Record<string, string>).authorization === 'Bearer access-new'
        ? json({ ok: true })
        : expired();
    });
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([apiClient.get('/v1/auth/me'), otherTab.apiClient.get('/v1/auth/me')]);
    expect(lock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/refresh'))).toHaveLength(1);
  });

  test('a delayed renewal cannot restore a session after sign-out', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (input: string) =>
      input.endsWith('/refresh') ? pending : expired(),
    );
    vi.stubGlobal('fetch', fetchMock);
    const request = apiClient.get('/v1/auth/me');
    const rejected = expect(request).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/refresh'))).toBe(true),
    );
    tokens.clear();
    release(json(renewed));
    await rejected;
    expect(tokens.access()).toBeNull();
    expect(tokens.refresh()).toBeNull();
  });
});

test('an HTML gateway error preserves the HTTP error instead of throwing a JSON parser error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<html>Unavailable</html>', { status: 503 })),
  );
  await expect(apiClient.get('/v1/admin/stats')).rejects.toMatchObject({ status: 503 });
});
