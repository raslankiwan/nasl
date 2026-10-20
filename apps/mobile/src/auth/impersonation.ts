import { ApiError, type ApiErrorBody } from '../api/sessionClient.ts';

declare const window: {
  location: { hash: string; pathname: string; search: string; replace(url: string): void };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  sessionStorage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
};
const KEY = 'nasl.supportSession';
const browser = typeof window !== 'undefined' && typeof window.location !== 'undefined';
interface Session {
  accessToken: string;
  expiresAt: string;
  adminUrl: string | null;
}
let session: Session | null = null;
let code: string | null = null;
let mode = false;
let failed = false;
let initializing: Promise<boolean> | undefined;
if (browser) {
  code = new URLSearchParams(window.location.hash.slice(1)).get('impersonation');
  if (code) {
    mode = true;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  try {
    const stored = window.sessionStorage.getItem(KEY);
    if (!code && stored) {
      mode = true;
      session = JSON.parse(stored) as Session;
    }
    if (code) window.sessionStorage.setItem(KEY, 'null');
  } catch {
    /* A support session can still run in memory when storage is disabled. */
  }
}
export const isImpersonating = () => mode;
export const supportSnapshot = () => ({
  session,
  failed,
  expired: !!session && Date.parse(session.expiresAt) <= Date.now(),
});
export function initializeSupport(base: string): Promise<boolean> {
  if (!mode) return Promise.resolve(false);
  initializing ??= (async () => {
    if (code) {
      try {
        const res = await fetch(`${base}/v1/auth/impersonation/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) throw new Error('Support link refused');
        session = (await res.json()) as Session;
        try {
          window.sessionStorage.setItem(KEY, JSON.stringify(session));
        } catch {
          /* memory only */
        }
      } catch {
        failed = true;
      }
      code = null;
    }
    if (!session || Date.parse(session.expiresAt) <= Date.now()) failed = true;
    return !failed;
  })();
  return initializing;
}
export function clearSupport() {
  session = null;
  failed = true;
  if (browser) {
    try {
      window.sessionStorage.setItem(KEY, 'null');
    } catch {
      /* memory only */
    }
  }
}
export async function supportRequest<T>(
  base: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  await initializeSupport(base);
  if (failed || !session || Date.parse(session.expiresAt) <= Date.now()) {
    failed = true;
    throw new ApiError(401, null);
  }
  const res = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (res.status === 401) clearSupport();
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody | null);
  return data as T;
}
export async function exitSupport(base: string) {
  const adminUrl = session?.adminUrl;
  try {
    await Promise.race([
      supportRequest(base, '/v1/auth/impersonation/end', { method: 'POST' }),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    /* expiry also revokes access */
  }
  clearSupport();
  if (browser) {
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      /* memory only */
    }
    window.location.replace(adminUrl ?? '/');
  }
}

/** Router hydration may restore the initial fragment; remove it once navigation has mounted. */
export function clearSupportFragment() {
  if (browser && mode && window.location.hash.includes('impersonation='))
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
