import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const ACCESS_KEY = 'nasl.accessToken';
const REFRESH_KEY = 'nasl.refreshToken';
const DEVICE_KEY = 'nasl.deviceId';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body?.error?.message ?? 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'internal';
    this.details = body?.error?.details;
  }
}

const BASE = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:4000'
).replace(/\/$/, '');

/** In-memory mirror so hot paths do not await storage on every request. */
let accessToken: string | null = null;
let refreshToken: string | null = null;

export async function loadTokens(): Promise<boolean> {
  // multiGet makes no promise about order, so read the pairs by key rather than by position.
  const pairs = await AsyncStorage.multiGet([ACCESS_KEY, REFRESH_KEY]);
  const stored = new Map(pairs);
  accessToken = stored.get(ACCESS_KEY) ?? null;
  refreshToken = stored.get(REFRESH_KEY) ?? null;
  return accessToken !== null;
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  accessToken = access;
  refreshToken = refresh;
  await AsyncStorage.multiSet([
    [ACCESS_KEY, access],
    [REFRESH_KEY, refresh],
  ]);
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY]);
}

/** Stable per-install id — refresh tokens are bound to the device that received them. */
export async function deviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `mobile-${globalThis.crypto.randomUUID()}`;
    await AsyncStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshToken) return false;

  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken, deviceId: await deviceId() }),
      });
      if (!res.ok) {
        await clearTokens();
        return false;
      }
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      await saveTokens(body.accessToken, body.refreshToken);
      return true;
    } catch {
      // A network failure is not an expired session — keep the tokens for the next attempt.
      return false;
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

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (res.status === 401 && retry && (await refreshSession())) {
    return request<T>(path, { ...options, retry: false });
  }

  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, parsed as ApiErrorBody);
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
};
