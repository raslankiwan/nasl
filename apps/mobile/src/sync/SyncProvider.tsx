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
import { AppState } from 'react-native';
import { request } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { isStuck, type OutboxEntry } from './outbox';
import { Delivery } from './delivery';
import { outbox } from './device';

interface SyncValue {
  pending: number;
  stuck: number;
  legacy: number;
  error: string | null;
  online: boolean;
  flushing: boolean;
  send: (id: string, path: string, body: unknown) => Promise<boolean>;
  flush: () => Promise<void>;
  recoverLegacy: () => Promise<void>;
}

const SyncContext = createContext<SyncValue | null>(null);
const RETRY_INTERVAL_MS = 30_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const { me, status } = useAuth();
  const current = useRef({ me, status });
  current.current = { me, status };
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flushingRef = useRef(false);
  const acceptsPath = useCallback(
    (path: string) =>
      current.current.me?.farms.some((farm) => path.startsWith(`/v1/farms/${farm.farmId}/`)) ??
      false,
    [],
  );
  const [delivery] = useState(
    () =>
      new Delivery(
        outbox,
        (entry) => request(entry.path, { method: 'POST', body: entry.body }),
        (entry) =>
          current.current.status === 'signedIn' &&
          entry.userId === current.current.me?.id &&
          acceptsPath(entry.path),
      ),
  );

  useEffect(() => outbox.subscribe(setEntries), []);

  const runFlush = useCallback(
    async (retryBlocked = false) => {
      if (flushingRef.current || current.current.status !== 'signedIn') return;
      flushingRef.current = true;
      setFlushing(true);
      try {
        setOnline(await delivery.flush(retryBlocked));
        setError(null);
      } catch {
        setError('storage');
      } finally {
        flushingRef.current = false;
        setFlushing(false);
      }
    },
    [delivery],
  );
  const flush = useCallback(() => runFlush(true), [runFlush]);

  const send = useCallback(
    async (id: string, path: string, body: unknown) => {
      const userId = current.current.me?.id;
      if (current.current.status !== 'signedIn' || !userId || !acceptsPath(path))
        throw new Error('Sign in to this farm before saving');
      const sent = await delivery.send({ id, path, body, userId });
      setOnline(sent);
      return sent;
    },
    [delivery, acceptsPath],
  );

  const recoverLegacy = useCallback(async () => {
    const userId = current.current.me?.id;
    if (!userId) return;
    try {
      await outbox.claimLegacy(userId, acceptsPath);
      await runFlush(true);
    } catch {
      setError('storage');
    }
  }, [acceptsPath, runFlush]);

  useEffect(() => {
    if (status !== 'signedIn') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runFlush();
    });
    const timer = setInterval(() => void runFlush(), RETRY_INTERVAL_MS);
    void runFlush();
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [runFlush, status, me?.id]);

  const ownEntries = entries.filter((entry) => entry.userId === me?.id && entry.userId);
  const legacy = entries.filter((entry) => !entry.userId && acceptsPath(entry.path)).length;
  const value = useMemo<SyncValue>(
    () => ({
      pending: ownEntries.length,
      stuck: ownEntries.filter(isStuck).length,
      legacy,
      error,
      online,
      flushing,
      send,
      flush,
      recoverLegacy,
    }),
    [ownEntries, legacy, error, online, flushing, send, flush, recoverLegacy],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside SyncProvider');
  return value;
}
