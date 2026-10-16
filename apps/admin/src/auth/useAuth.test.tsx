import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tokens } from '../api/client';
import { useAuth } from './useAuth';

const staff = { id: 'staff-1', name: 'Ops', locale: 'ar', isPlatformAdmin: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('nasl.admin.deviceId', 'admin-device');
  tokens.set('access-old', 'refresh-old');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('session restoration', () => {
  test('restores the saved session on remount, including after the access token expires', async () => {
    let expire = false;
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      if (input.endsWith('/refresh'))
        return json({ accessToken: 'access-new', refreshToken: 'refresh-new' });
      if (
        expire &&
        (init.headers as Record<string, string>).authorization !== 'Bearer access-new'
      ) {
        return json({ error: { code: 'unauthorized' } }, 401);
      }
      return json(staff);
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(first.result.current.state.status).toBe('signedIn'));
    first.unmount();
    expire = true;
    const reloaded = renderHook(() => useAuth(), { wrapper });
    await waitFor(() =>
      expect(reloaded.result.current.state).toEqual({ status: 'signedIn', user: staff }),
    );
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/refresh'))).toHaveLength(1);
  });

  test('can recover using the refresh token even if the access token is missing', async () => {
    window.localStorage.removeItem('nasl.admin.accessToken');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit) => {
        if (input.endsWith('/refresh'))
          return json({ accessToken: 'access-new', refreshToken: 'refresh-new' });
        return (init.headers as Record<string, string>).authorization
          ? json(staff)
          : json({ error: { code: 'unauthorized' } }, 401);
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));
  });

  test('a temporary startup failure keeps credentials and retry restores the same session', async () => {
    let online = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (!online) throw new TypeError('Failed to fetch');
        return json(staff);
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
    expect(tokens.refresh()).toBe('refresh-old');
    online = true;
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.state.status).toBe('signedIn');
  });

  test('a temporary refresh failure does not become a sign-out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/refresh')
          ? json({ error: { code: 'internal' } }, 503)
          : json({ error: { code: 'unauthorized' } }, 401),
      ),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
    expect(tokens.refresh()).toBe('refresh-old');
  });

  test('server-rejected credentials still require sign-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'unauthorized' } }, 401)),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('signedOut'));
    expect(tokens.refresh()).toBeNull();
  });

  test('a late identity response cannot undo an explicit sign-out', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/sign-out')) return new Response(null, { status: 204 });
        await pending;
        return json(staff);
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signOut();
      release();
    });
    expect(result.current.state.status).toBe('signedOut');
    expect(tokens.refresh()).toBeNull();
  });
});
