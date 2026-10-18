import { platformLock } from '../platformLock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createSessionClient } from './sessionClient';

export { ApiError } from './sessionClient';
export type { ApiErrorBody } from './sessionClient';

const BASE = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:4000'
).replace(/\/$/, '');

const client = createSessionClient(BASE, AsyncStorage, fetch, (work) =>
  platformLock('nasl.mobile.refresh', work),
);
export const { request, loadTokens, saveTokens, clearTokens, deviceId, revokeSession } = client;
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
};
