import type { KeyValueStore } from './storage.ts';

const OUTBOX_KEY = 'nasl.outbox';
const STUCK_AFTER = 3;

export class OutboxStorageError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Device storage unavailable', { cause });
    this.name = 'OutboxStorageError';
  }
}

export interface OutboxEntry {
  id: string;
  /** Older releases did not record ownership. Those entries require explicit recovery. */
  userId?: string;
  path: string;
  body: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
  blocked?: boolean;
}

type Listener = (entries: OutboxEntry[]) => void;
type Lock = <T>(work: () => Promise<T>) => Promise<T>;

/** Durable writes are serialized. Failures never evict a record or update memory ahead of disk. */
export class Outbox {
  private readonly store: KeyValueStore;
  private readonly lock: Lock;
  private readonly listeners = new Set<Listener>();
  private writes: Promise<unknown> = Promise.resolve();

  constructor(store: KeyValueStore, lock: Lock = (work) => work()) {
    this.store = store;
    this.lock = lock;
  }

  private async read(): Promise<OutboxEntry[]> {
    const raw = await this.store.get(OUTBOX_KEY);
    if (!raw) return [];
    // Never silently overwrite unreadable work with an empty queue.
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (e) =>
          !e ||
          typeof e.id !== 'string' ||
          typeof e.path !== 'string' ||
          typeof e.attempts !== 'number',
      )
    ) {
      throw new Error('Saved records could not be read');
    }
    return parsed as OutboxEntry[];
  }

  private change(update: (entries: OutboxEntry[]) => OutboxEntry[]): Promise<void> {
    const result = this.writes.then(() =>
      this.lock(async () => {
        const entries = update(await this.read());
        await this.store.set(OUTBOX_KEY, JSON.stringify(entries));
        for (const listener of this.listeners) listener(entries);
      }),
    );
    const saved = result.catch((error) => {
      throw new OutboxStorageError(error);
    });
    this.writes = saved.catch(() => {});
    return saved;
  }

  enqueue(entry: Pick<OutboxEntry, 'id' | 'path' | 'body' | 'userId'>): Promise<void> {
    return this.change((entries) => [
      ...entries.filter((e) => e.id !== entry.id),
      { ...entry, attempts: 0, createdAt: new Date().toISOString() },
    ]);
  }

  async pending(): Promise<OutboxEntry[]> {
    await this.writes;
    return this.read();
  }

  remove(id: string): Promise<void> {
    return this.change((entries) => entries.filter((e) => e.id !== id));
  }

  recordFailure(id: string, message: string, blocked = false): Promise<void> {
    return this.change((entries) =>
      entries.map((e) =>
        e.id === id ? { ...e, attempts: e.attempts + 1, lastError: message, blocked } : e,
      ),
    );
  }

  claimLegacy(userId: string, acceptsPath: (path: string) => boolean): Promise<void> {
    return this.change((entries) =>
      entries.map((e) => (!e.userId && acceptsPath(e.path) ? { ...e, userId } : e)),
    );
  }

  clear(): Promise<void> {
    return this.change(() => []);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    void this.pending()
      .then((entries) => {
        if (this.listeners.has(listener)) listener(entries);
      })
      .catch(() => {});
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function isStuck(entry: OutboxEntry): boolean {
  return entry.blocked === true || entry.attempts >= STUCK_AFTER;
}
