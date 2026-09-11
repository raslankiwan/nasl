import { useCallback, useEffect, useState } from 'react';
import { apiClient, deviceId, tokens } from '../api/client';

export interface StaffUser {
  id: string;
  name: string | null;
  locale: string;
  isPlatformAdmin: boolean;
}

interface Challenge {
  challengeId: string;
  expiresAt: string;
  devCode?: string;
}

interface Session {
  accessToken: string;
  refreshToken: string;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  /** Signed in, but not platform staff — a farm user who found the console's URL. */
  | { status: 'notStaff' }
  | { status: 'signedIn'; user: StaffUser };

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const loadMe = useCallback(async () => {
    if (!tokens.access()) {
      setState({ status: 'signedOut' });
      return;
    }
    try {
      const me = await apiClient.get<StaffUser>('/v1/auth/me');
      setState(me.isPlatformAdmin ? { status: 'signedIn', user: me } : { status: 'notStaff' });
    } catch {
      tokens.clear();
      setState({ status: 'signedOut' });
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const requestCode = useCallback(
    (phone: string) => apiClient.post<Challenge>('/v1/auth/otp/request', { phone }),
    [],
  );

  const verifyCode = useCallback(
    async (challengeId: string, code: string) => {
      const session = await apiClient.post<Session>('/v1/auth/otp/verify', {
        challengeId,
        code,
        deviceId: deviceId(),
      });
      tokens.set(session.accessToken, session.refreshToken);
      // The sign-in response does not carry staff status; /me is the authority.
      await loadMe();
    },
    [loadMe],
  );

  const signOut = useCallback(async () => {
    const refresh = tokens.refresh();
    if (refresh) {
      // Best effort: the session is over locally whatever the server says.
      await apiClient.post('/v1/auth/sign-out', { refreshToken: refresh }).catch(() => undefined);
    }
    tokens.clear();
    setState({ status: 'signedOut' });
  }, []);

  return { state, requestCode, verifyCode, signOut, reload: loadMe };
}
