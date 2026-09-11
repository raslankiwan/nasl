import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, clearTokens, deviceId, loadTokens, saveTokens } from '../api/client';

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
  requestCode: (phone: string) => Promise<{ challengeId: string; devCode?: string }>;
  verifyCode: (challengeId: string, code: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectFarm: (farmId: string) => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthValue['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [farmId, setFarmId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!(await loadTokens())) {
      setStatus('signedOut');
      return;
    }
    try {
      const profile = await api.get<Me>('/v1/auth/me');
      setMe(profile);
      setFarmId((current) => current ?? profile.farms[0]?.farmId ?? null);
      setStatus('signedIn');
    } catch {
      await clearTokens();
      setStatus('signedOut');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestCode = useCallback(
    (phone: string) =>
      api.post<{ challengeId: string; devCode?: string }>('/v1/auth/otp/request', { phone }),
    [],
  );

  const verifyCode = useCallback(
    async (challengeId: string, code: string, name?: string) => {
      const session = await api.post<{ accessToken: string; refreshToken: string }>(
        '/v1/auth/otp/verify',
        { challengeId, code, deviceId: await deviceId(), ...(name ? { name } : {}) },
      );
      await saveTokens(session.accessToken, session.refreshToken);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await clearTokens();
    setMe(null);
    setFarmId(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      farmId,
      requestCode,
      verifyCode,
      signOut,
      selectFarm: setFarmId,
      refresh,
    }),
    [status, me, farmId, requestCode, verifyCode, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
