import AsyncStorage from '@react-native-async-storage/async-storage';

const OUTBOX_KEY = 'nasl.outbox';
const MAX_ATTEMPTS = 8;

/**
 * A durable queue of writes that have not reached the server yet.
 *
 * Grazing land has no signal. A birth recorded at the back of a pen must survive the walk home,
 * the app being closed, and the phone being flat — so the record goes to disk before anything is
 * attempted over the network, and is only removed once the server has acknowledged it.
 *
 * This is not the whole of offline: reads still need a local database (see docs/roadmap.md). But
 * losing a write is the failure that cannot be recovered from, and this closes it.
 */

export interface OutboxEntry {
  /** Client-minted, and reused as the document id, so a retry cannot create a duplicate. */
  id: string;
  path: string;
  body: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

type Listener = (entries: OutboxEntry[]) => void;

const listeners = new Set<Listener>();
let cache: OutboxEntry[] | null = null;

async function read(): Promise<OutboxEntry[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    cache = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    // A corrupt outbox is worse than an empty one only if it blocks every future write.
    cache = [];
  }
  return cache;
}

async function write(entries: OutboxEntry[]): Promise<void> {
  cache = entries;
  try {
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
  } catch {
    // Out of storage. The in-memory copy still lets this session finish.
  }
  for (const listener of listeners) listener(entries);
}

export async function enqueue(entry: Omit<OutboxEntry, 'attempts' | 'createdAt'>): Promise<void> {
  const entries = await read();
  // Re-queuing the same id replaces rather than duplicates: the id is the record's identity.
  const next = entries.filter((e) => e.id !== entry.id);
  next.push({ ...entry, attempts: 0, createdAt: new Date().toISOString() });
  await write(next);
}

export async function pending(): Promise<OutboxEntry[]> {
  return read();
}

export async function pendingCount(): Promise<number> {
  return (await read()).length;
}

export async function remove(id: string): Promise<void> {
  await write((await read()).filter((e) => e.id !== id));
}

export async function recordFailure(id: string, message: string): Promise<void> {
  const entries = await read();
  await write(
    entries
      .map((e) => (e.id === id ? { ...e, attempts: e.attempts + 1, lastError: message } : e))
      // A request the server keeps rejecting is not a network problem, and retrying it forever
      // blocks everything queued behind it.
      .filter((e) => e.attempts < MAX_ATTEMPTS),
  );
}

export async function clear(): Promise<void> {
  await write([]);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  void read().then((entries) => listener(entries));
  return () => listeners.delete(listener);
}

/** Entries that have failed enough times to need a person to look at them. */
export function isStuck(entry: OutboxEntry): boolean {
  return entry.attempts >= 3;
}
