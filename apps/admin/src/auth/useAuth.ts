import { useCallback, useEffect, useRef, useState } from 'react';
import { passkeySignIn } from './passkeys';
import { apiClient, ApiError, deviceId, tokens } from '../api/client';

export interface StaffUser {
  id: string;
  name: string | null;
  locale: string;
  isPlatformAdmin: boolean;
}

interface Session {
  accessToken: string;
  refreshToken: string;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'unavailable' }
  /** Signed in, but not platform staff — a farm user who found the console's URL. */
  | { status: 'notStaff' }
  | { status: 'signedIn'; user: StaffUser };

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const attempt = useRef(0);

  const loadMe = useCallback(async () => {
    const current = ++attempt.current;
    if (!tokens.access() && !tokens.refresh()) {
      setState({ status: 'signedOut' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const me = await apiClient.get<StaffUser>('/v1/auth/me');
      if (current !== attempt.current) return;
      setState(me.isPlatformAdmin ? { status: 'signedIn', user: me } : { status: 'notStaff' });
    } catch (error) {
      if (current !== attempt.current) return;
      if (error instanceof ApiError && error.status === 401) {
        tokens.clear();
        setState({ status: 'signedOut' });
      } else {
        // An API restart, dropped connection or server error does not invalidate the session.
        setState({ status: 'unavailable' });
      }
    }
  }, []);

  useEffect(() => {
    void loadMe();
    return () => {
      attempt.current += 1;
    };
  }, [loadMe]);

  useEffect(() => {
    if (state.status !== 'unavailable') return;
    const retry = () => void loadMe();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [state.status, loadMe]);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const session = await apiClient.post<Session>('/v1/auth/login', {
        identifier,
        password,
        deviceId: deviceId(),
      });
      tokens.set(session.accessToken, session.refreshToken);
      await loadMe();
    },
    [loadMe],
  );

  const signInWithPasskey = useCallback(async () => {
    const session = await passkeySignIn();
    tokens.set(session.accessToken, session.refreshToken);
    await loadMe();
  }, [loadMe]);

  const signOut = useCallback(async () => {
    const refresh = tokens.refresh();
    attempt.current += 1;
    tokens.clear();
    setState({ status: 'signedOut' });
    if (refresh) {
      // Best effort: the session is over locally whatever the server says.
      await apiClient.post('/v1/auth/sign-out', { refreshToken: refresh }).catch(() => undefined);
    }
  }, []);

  return { state, signIn, signInWithPasskey, signOut, reload: loadMe };
}
