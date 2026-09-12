import type { KeyValueStore } from './storage.ts';

const OUTBOX_KEY = 'nasl.outbox';
const MAX_ATTEMPTS = 8;
/** Enough failures that a person should look at it, but not yet enough to give up. */
const STUCK_AFTER = 3;

/**
 * A durable queue of writes that have not reached the server yet.
 *
 * Grazing land has no signal. A birth recorded at the back of a pen must survive the walk home,
 * the app being closed, and the phone going flat — so the record goes to disk before anything is
 * attempted over the network, and is only removed once the server has acknowledged it.
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

export class Outbox {
  private readonly store: KeyValueStore;
  private readonly listeners = new Set<Listener>();
  private cache: OutboxEntry[] | null = null;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  private async read(): Promise<OutboxEntry[]> {
    if (this.cache) return this.cache;
    const raw = await this.store.get(OUTBOX_KEY);
    try {
      this.cache = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
    } catch {
      // A corrupt outbox is only worse than an empty one if it blocks every future write.
      this.cache = [];
    }
    return this.cache;
  }

  private async write(entries: OutboxEntry[]): Promise<void> {
    this.cache = entries;
    await this.store.set(OUTBOX_KEY, JSON.stringify(entries));
    for (const listener of this.listeners) listener(entries);
  }

  async enqueue(entry: Pick<OutboxEntry, 'id' | 'path' | 'body'>): Promise<void> {
    const entries = await this.read();
    // Re-queuing the same id replaces rather than duplicates: the id is the record's identity.
    const next = entries.filter((e) => e.id !== entry.id);
    next.push({ ...entry, attempts: 0, createdAt: new Date().toISOString() });
    await this.write(next);
  }

  async pending(): Promise<OutboxEntry[]> {
    return this.read();
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.read()).filter((e) => e.id !== id));
  }

  /**
   * Note a failure. Past `MAX_ATTEMPTS` the entry is dropped: a request the server keeps refusing
   * is not a network problem, and retrying it forever blocks everything queued behind it.
   */
  async recordFailure(id: string, message: string): Promise<void> {
    const entries = await this.read();
    await this.write(
      entries
        .map((e) => (e.id === id ? { ...e, attempts: e.attempts + 1, lastError: message } : e))
        .filter((e) => e.attempts < MAX_ATTEMPTS),
    );
  }

  async clear(): Promise<void> {
    await this.write([]);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    void this.read().then((entries) => listener(entries));
    return () => this.listeners.delete(listener);
  }
}

/** Entries that have failed enough times to need a person to look at them. */
export function isStuck(entry: OutboxEntry): boolean {
  return entry.attempts >= STUCK_AFTER;
}
