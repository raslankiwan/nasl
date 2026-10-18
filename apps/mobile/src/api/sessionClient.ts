/** Platform-free transport: storage and browser locking are wired in client.ts. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error?.message ?? 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'internal';
    this.details = body?.error?.details;
  }
}

interface Store {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const ACCESS_KEY = 'nasl.accessToken';
const REFRESH_KEY = 'nasl.refreshToken';
const DEVICE_KEY = 'nasl.deviceId';

export function createSessionClient(
  base: string,
  store: Store,
  fetcher: typeof fetch = fetch,
  lock: <T>(work: () => Promise<T>) => Promise<T> = (work) => work(),
) {
  let refreshInFlight: Promise<boolean> | null = null;
  let revision = 0;
  let writes: Promise<unknown> = Promise.resolve();
  const write = (work: () => Promise<void>) => {
    const result = writes.then(work);
    writes = result.catch(() => {});
    return result;
  };
  const saveTokens = (access: string, refresh: string) => {
    revision += 1;
    return write(async () => {
      await store.setItem(ACCESS_KEY, access);
      await store.setItem(REFRESH_KEY, refresh);
    });
  };
  const clearTokens = () => {
    revision += 1;
    return write(async () => {
      await store.removeItem(ACCESS_KEY);
      await store.removeItem(REFRESH_KEY);
    });
  };
  const loadTokens = async () => {
    await writes;
    return Boolean((await store.getItem(ACCESS_KEY)) || (await store.getItem(REFRESH_KEY)));
  };
  let deviceInFlight: Promise<string> | null = null;
  const deviceId = () => {
    deviceInFlight ??= (async () => {
      let id = await store.getItem(DEVICE_KEY);
      if (!id) {
        id = `mobile-${globalThis.crypto.randomUUID()}`;
        await store.setItem(DEVICE_KEY, id);
      }
      return id;
    })().finally(() => {
      deviceInFlight = null;
    });
    return deviceInFlight;
  };

  function refreshSession(failedAccess: string | null): Promise<boolean> {
    refreshInFlight ??= lock(async () => {
      await writes;
      const access = await store.getItem(ACCESS_KEY);
      if (access && access !== failedAccess) return true;
      const token = await store.getItem(REFRESH_KEY);
      if (!token) return false;
      const started = revision;
      const res = await fetcher(`${base}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token, deviceId: await deviceId() }),
      });
      // A sign-out or different login wins over a delayed response.
      if (started !== revision || (await store.getItem(REFRESH_KEY)) !== token) return false;
      if (res.status === 401) {
        await clearTokens();
        return false;
      }
      // Propagate outages: returning false here would expose the original access-token 401
      // and incorrectly tell AuthProvider that the whole session was rejected.
      if (!res.ok) throw new ApiError(res.status, null);
      const body = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (started !== revision || (await store.getItem(REFRESH_KEY)) !== token) return false;
      if (!body.accessToken || !body.refreshToken) throw new Error('Invalid session response');
      await saveTokens(body.accessToken, body.refreshToken);
      return true;
    }).finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      retry?: boolean;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, retry = true } = options;
    await writes;
    const access = await store.getItem(ACCESS_KEY);
    const res = await fetcher(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(access ? { authorization: `Bearer ${access}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401 && retry && (await refreshSession(access))) {
      return request<T>(path, { ...options, retry: false });
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      if (res.ok) throw new Error('Invalid server response');
    }
    if (!res.ok) throw new ApiError(res.status, parsed as ApiErrorBody | null);
    return parsed as T;
  }

  async function revokeSession(): Promise<void> {
    const token = await store.getItem(REFRESH_KEY);
    await clearTokens();
    // Local sign-out does not wait for a disconnected server.
    if (token)
      void request('/v1/auth/sign-out', {
        method: 'POST',
        body: { refreshToken: token },
        retry: false,
      }).catch(() => {});
  }

  return { request, saveTokens, loadTokens, clearTokens, deviceId, revokeSession };
}
