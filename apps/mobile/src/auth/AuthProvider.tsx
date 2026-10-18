import type { RegistrationInput } from '@nasl/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  api,
  ApiError,
  clearTokens,
  deviceId,
  loadTokens,
  saveTokens,
  revokeSession,
} from '../api/client';
import { flockCache } from '../sync/device';

import { disablePush, forgetPushOwner, reconcilePushOwner } from '../notifications/push';

const ME_CACHE_KEY = 'nasl.me';

export interface Me {
  id: string;
  name: string | null;
  locale: string;
  isPlatformAdmin: boolean;
  farms: Array<{ farmId: string; role: string }>;
}

interface AuthValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  me: Me | null;
  /** The farm currently being worked on. Most herders have exactly one. */
  farmId: string | null;
  register: (input: RegistrationInput) => Promise<{ id: string; status: 'pending' }>;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectFarm: (farmId: string) => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const attempt = useRef(0);
  const [status, setStatus] = useState<AuthValue['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [farmId, setFarmId] = useState<string | null>(null);

  const adopt = useCallback((profile: Me) => {
    setMe(profile);
    setFarmId((current) =>
      profile.farms.some((farm) => farm.farmId === current)
        ? current
        : (profile.farms[0]?.farmId ?? null),
    );
    setStatus('signedIn');
  }, []);

  /**
   * Establish who is signed in — without requiring a network.
   *
   * A herder opens this app in a field with no signal. Treating an unreachable server as a
   * rejected session would sign them out, destroy their tokens, and orphan everything waiting in
   * the outbox. So only an actual 401 ends a session; anything else falls back to the profile
   * cached on the device, and the app comes up ready to record.
   */
  const refresh = useCallback(async () => {
    const current = ++attempt.current;
    const hasTokens = await loadTokens();
    if (current !== attempt.current) return;
    if (!hasTokens) {
      setMe(null);
      setFarmId(null);
      setStatus('signedOut');
      return;
    }

    try {
      const profile = await api.get<Me>('/v1/auth/me');
      if (current !== attempt.current) return;
      await AsyncStorage.setItem(ME_CACHE_KEY, JSON.stringify(profile));
      await reconcilePushOwner(profile.id).catch(() => {});
      if (current !== attempt.current) return;
      adopt(profile);
      return;
    } catch (err) {
      if (current !== attempt.current) return;
      // The server said no. That is the only thing that ends a session.
      if (err instanceof ApiError && err.status === 401) {
        await forgetPushOwner().catch(() => {});
        await clearTokens();
        await AsyncStorage.removeItem(ME_CACHE_KEY);
        setMe(null);
        setFarmId(null);
        setStatus('signedOut');
        return;
      }
    }

    try {
      const cached = await AsyncStorage.getItem(ME_CACHE_KEY);
      if (current !== attempt.current) return;
      if (cached) {
        adopt(JSON.parse(cached) as Me);
        return;
      }
    } catch {
      // Fall through: there is nothing cached to fall back to.
    }

    // Tokens but no cached profile, and the server is unreachable. Keep the tokens — they may
    // still be good — but there is nothing to show yet.
    setStatus('signedOut');
  }, [adopt]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const register = useCallback(
    (input: RegistrationInput) =>
      api.post<{ id: string; status: 'pending' }>('/v1/auth/register', input),
    [],
  );
  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const current = ++attempt.current;
      const session = await api.post<{ accessToken: string; refreshToken: string }>(
        '/v1/auth/login',
        { identifier, password, deviceId: await deviceId() },
      );
      if (current !== attempt.current) return;
      await AsyncStorage.removeItem(ME_CACHE_KEY);
      setMe(null);
      setFarmId(null);
      await saveTokens(session.accessToken, session.refreshToken);
      const profile = await api.get<Me>('/v1/auth/me');
      if (current !== attempt.current) return;
      await AsyncStorage.setItem(ME_CACHE_KEY, JSON.stringify(profile));
      await reconcilePushOwner(profile.id).catch(() => {});
      if (current !== attempt.current) return;
      adopt(profile);
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    attempt.current += 1;
    await disablePush().catch(() => {});
    await revokeSession();
    await AsyncStorage.removeItem(ME_CACHE_KEY);
    // The next person to sign in on this phone must not see the last one's flock.
    await Promise.all(me?.farms.map((farm) => flockCache.forget(farm.farmId)) ?? []);
    setMe(null);
    setFarmId(null);
    setStatus('signedOut');
  }, [me]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      farmId,
      register,
      signIn,
      signOut,
      selectFarm: setFarmId,
      refresh,
    }),
    [status, me, farmId, register, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
