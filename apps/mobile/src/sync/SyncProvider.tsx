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
import { ApiError, request } from '../api/client';
import { enqueue, pending, recordFailure, remove, subscribe, type OutboxEntry } from './outbox';

interface SyncValue {
  /** Writes waiting to reach the server. */
  pending: number;
  stuck: number;
  /** False once a write has failed on the network and not yet succeeded. */
  online: boolean;
  flushing: boolean;
  /** Post now if possible, queue durably if not. Returns true when it reached the server. */
  send: (id: string, path: string, body: unknown) => Promise<boolean>;
  flush: () => Promise<void>;
}

const SyncContext = createContext<SyncValue | null>(null);

/** A refused request is a problem with the record; a thrown one is a problem with the network. */
function isNetworkFailure(error: unknown): boolean {
  return !(error instanceof ApiError);
}

const RETRY_INTERVAL_MS = 30_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const flushingRef = useRef(false);

  useEffect(() => subscribe(setEntries), []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setFlushing(true);
    try {
      for (const entry of await pending()) {
        try {
          await request(entry.path, { method: 'POST', body: entry.body });
          await remove(entry.id);
          setOnline(true);
        } catch (err) {
          await recordFailure(entry.id, err instanceof Error ? err.message : 'failed');
          if (isNetworkFailure(err)) {
            setOnline(false);
            // No point walking the rest of the queue while the network is down.
            break;
          }
        }
      }
    } finally {
      flushingRef.current = false;
      setFlushing(false);
    }
  }, []);

  const send = useCallback(async (id: string, path: string, body: unknown) => {
    try {
      await request(path, { method: 'POST', body });
      setOnline(true);
      return true;
    } catch (err) {
      if (!isNetworkFailure(err)) throw err; // the server refused it; the user must see why
      await enqueue({ id, path, body });
      setOnline(false);
      return false;
    }
  }, []);

  // Try again when the herder comes back to the app, and periodically while it is open.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });
    const timer = setInterval(() => void flush(), RETRY_INTERVAL_MS);
    void flush();
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [flush]);

  const value = useMemo<SyncValue>(
    () => ({
      pending: entries.length,
      stuck: entries.filter((e) => e.attempts >= 3).length,
      online,
      flushing,
      send,
      flush,
    }),
    [entries, online, flushing, send, flush],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside SyncProvider');
  return value;
}
