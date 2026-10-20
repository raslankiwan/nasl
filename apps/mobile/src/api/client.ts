import {
  isImpersonating,
  initializeSupport,
  supportRequest,
  clearSupport,
  exitSupport,
} from '../auth/impersonation';
import { platformLock } from '../platformLock';
import { tokenStore } from '../auth/tokenStore';
import Constants from 'expo-constants';
import { createSessionClient } from './sessionClient';

export { ApiError } from './sessionClient';
export type { ApiErrorBody } from './sessionClient';

const BASE = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:4000'
).replace(/\/$/, '');

const client = createSessionClient(BASE, tokenStore, fetch, (work) =>
  platformLock('nasl.mobile.refresh', work),
);
export const { saveTokens, deviceId } = client;
export const request = <T>(path: string, options?: Parameters<typeof client.request>[1]) =>
  isImpersonating() ? supportRequest<T>(BASE, path, options) : client.request<T>(path, options);
export const loadTokens = () => (isImpersonating() ? initializeSupport(BASE) : client.loadTokens());
export const clearTokens = async () => {
  if (isImpersonating()) clearSupport();
  else await client.clearTokens();
};
export const revokeSession = () => (isImpersonating() ? exitSupport(BASE) : client.revokeSession());
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
};
