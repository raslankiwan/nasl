/**
 * The narrowest thing the outbox and the cache need from a store.
 *
 * They take it as an argument rather than importing AsyncStorage directly, for two reasons. The
 * first is testing: the outbox is what stands between a herder and a lost birth record, and it has
 * to be testable without a React Native runtime. The second is the SQLite swap the roadmap calls
 * for — with the dependency here, that is a new implementation of this interface rather than a
 * rewrite of everything that stores anything.
 *
 * Deliberately no `clear()`: two subsystems share one store, and a blunt wipe from either would
 * take the other's data with it.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** For tests, and for any environment where persistence is unavailable. */
export function memoryStore(seed: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(seed));
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

/**
 * A store that swallows its own failures.
 *
 * Storage can be full or unavailable, and neither is a reason to refuse the write the user is in
 * the middle of — the in-memory copy still lets the session finish. Reads fall back to null, which
 * every caller already treats as "nothing stored yet".
 */
export function tolerant(store: KeyValueStore): KeyValueStore {
  return {
    async get(key) {
      try {
        return await store.get(key);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        await store.set(key, value);
      } catch {
        /* out of storage */
      }
    },
    async remove(key) {
      try {
        await store.remove(key);
      } catch {
        /* out of storage */
      }
    },
  };
}
