const ACCESS_KEY = 'nasl.admin.accessToken';
const REFRESH_KEY = 'nasl.admin.refreshToken';
const DEVICE_KEY = 'nasl.admin.deviceId';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error?.code ?? 'internal';
    this.details = body.error?.details;
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export const tokens = {
  access: () => read(ACCESS_KEY),
  refresh: () => read(REFRESH_KEY),
  set(access: string, refresh: string) {
    write(ACCESS_KEY, access);
    write(REFRESH_KEY, refresh);
  },
  clear() {
    write(ACCESS_KEY, null);
    write(REFRESH_KEY, null);
  },
};

/** A stable per-browser id, because refresh tokens are bound to the device that received them. */
export function deviceId(): string {
  let id = read(DEVICE_KEY);
  if (!id) {
    id = `admin-${crypto.randomUUID()}`;
    write(DEVICE_KEY, id);
  }
  return id;
}

const BASE = import.meta.env.VITE_API_URL ?? '';

let refreshInFlight: Promise<boolean> | null = null;

/** Refresh once even if several requests fail at the same moment. */
async function refreshTokens(): Promise<boolean> {
  const token = tokens.refresh();
  if (!token) return false;

  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token, deviceId: deviceId() }),
      });
      if (!res.ok) {
        tokens.clear();
        return false;
      }
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      tokens.set(body.accessToken, body.refreshToken);
      return true;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; retry?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, retry = true } = options;
  const access = tokens.access();

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(access ? { authorization: `Bearer ${access}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (res.status === 401 && retry && (await refreshTokens())) {
    return request<T>(path, { ...options, retry: false });
  }

  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!res.ok) throw new ApiError(res.status, parsed as ApiErrorBody);
  return parsed as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
};
