import type { KeyValueStore } from './storage.ts';

/**
 * The local flock, fed by the sync/pull change sets.
 *
 * This is the read half of offline. Writes already survive without a network (see `outbox.ts`);
 * without this, the roster shows a connection error in exactly the place a herder needs to look
 * something up — which is most of the time, because the pen is where the signal is not.
 *
 * The store is injected rather than imported, for two reasons: the merge logic here decides
 * whether a record survives, so it has to be testable without a React Native runtime; and the
 * SQLite swap the roadmap calls for becomes a new `KeyValueStore` rather than a rewrite.
 *
 * It knows nothing about HTTP. Fetching a change set is `pullFlock`'s job in `device.ts`; this is
 * storage and merge, which is the part worth testing in isolation.
 */

export interface CachedAnimal {
  id: string;
  tagNumber: string;
  name: string | null;
  species: string;
  breedId: string | null;
  sex: string;
  dateOfBirth: string | null;
  status: string;
  currentGroupId: string | null;
  damId: string | null;
  sireId: string | null;
  repro: { state: string; sinceDate: string; dueDate: string | null } | null;
  lastWeightKg: number | null;
  withholdMeatUntil: string | null;
  withholdMilkUntil: string | null;
  updatedAt: string;
}

interface CacheShape {
  farmId: string;
  cursor: string | null;
  syncedAt: string | null;
  animals: Record<string, CachedAnimal>;
}

export interface PullResponse {
  nextPage?: unknown;
  timestamp: string;
  changes: Record<
    string,
    { created: Record<string, unknown>[]; updated: Record<string, unknown>[]; deleted: string[] }
  >;
}

const asDate = (value: unknown): string | null =>
  typeof value === 'string'
    ? value.slice(0, 10)
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : null;

/** Server documents use `_id`; the app uses `id` everywhere else. */
export function toCachedAnimal(doc: Record<string, unknown>): CachedAnimal | null {
  const id = typeof doc._id === 'string' ? doc._id : null;
  if (!id || typeof doc.tagNumber !== 'string') return null;

  const repro = doc.repro as
    { state?: string; sinceDate?: string; dueDate?: string | null } | null | undefined;

  return {
    id,
    tagNumber: doc.tagNumber,
    name: (doc.name as string | null) ?? null,
    species: (doc.species as string) ?? 'sheep',
    breedId: (doc.breedId as string | null) ?? null,
    sex: (doc.sex as string) ?? 'female',
    dateOfBirth: asDate(doc.dateOfBirth),
    status: (doc.status as string) ?? 'active',
    currentGroupId: (doc.currentGroupId as string | null) ?? null,
    damId: (doc.damId as string | null) ?? null,
    sireId: (doc.sireId as string | null) ?? null,
    repro:
      repro?.state && repro.sinceDate
        ? {
            state: repro.state,
            sinceDate: asDate(repro.sinceDate) ?? repro.sinceDate,
            dueDate: asDate(repro.dueDate),
          }
        : null,
    lastWeightKg: (doc.lastWeightKg as number | null) ?? null,
    withholdMeatUntil: asDate(doc.withholdMeatUntil),
    withholdMilkUntil: asDate(doc.withholdMilkUntil),
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : new Date().toISOString(),
  };
}

export class FlockCache {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  private key(farmId: string): string {
    return `nasl.cache.${farmId}`;
  }

  private empty(farmId: string): CacheShape {
    return { farmId, cursor: null, syncedAt: null, animals: {} };
  }

  private async read(farmId: string): Promise<CacheShape> {
    const raw = await this.store.get(this.key(farmId));
    if (!raw) return this.empty(farmId);
    try {
      return JSON.parse(raw) as CacheShape;
    } catch {
      // A corrupt cache costs a re-sync, not a lost record — the events live on the server.
      return this.empty(farmId);
    }
  }

  private async write(cache: CacheShape): Promise<void> {
    await this.store.set(this.key(cache.farmId), JSON.stringify(cache));
  }

  /**
   * Fold a pull's change set into the local copy.
   *
   * Nothing is written until the whole response is in hand, so a connection that drops mid-pull
   * leaves the previous cursor — and therefore the previous cache — intact rather than half-applied.
   */
  async applyChanges(farmId: string, response: PullResponse): Promise<number> {
    const cache = await this.read(farmId);
    const animals = { ...cache.animals };
    const set = response.changes.animals;
    let count = 0;

    for (const doc of [...(set?.created ?? []), ...(set?.updated ?? [])]) {
      const animal = toCachedAnimal(doc);
      if (animal) {
        animals[animal.id] = animal;
        count += 1;
      }
    }
    for (const id of set?.deleted ?? []) {
      if (animals[id]) count += 1;
      delete animals[id];
    }

    await this.write({
      farmId,
      cursor: response.timestamp,
      syncedAt: new Date().toISOString(),
      animals,
    });

    return count;
  }

  async listAnimals(farmId: string): Promise<CachedAnimal[]> {
    const cache = await this.read(farmId);
    return Object.values(cache.animals)
      .filter((a) => a.status === 'active')
      .sort((a, b) => a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true }));
  }

  /** Cache a confirmed server write without advancing the incremental pull cursor. */
  async storeAnimal(farmId: string, doc: Record<string, unknown>): Promise<void> {
    const animal = toCachedAnimal(doc);
    if (!animal) throw new Error('Cannot cache an animal without an id and tag');
    const cache = await this.read(farmId);
    await this.write({ ...cache, animals: { ...cache.animals, [animal.id]: animal } });
  }

  async getAnimal(farmId: string, id: string): Promise<CachedAnimal | null> {
    return (await this.read(farmId)).animals[id] ?? null;
  }

  async cursor(farmId: string): Promise<string | null> {
    return (await this.read(farmId)).cursor;
  }

  async lastSyncedAt(farmId: string): Promise<string | null> {
    return (await this.read(farmId)).syncedAt;
  }

  /** Forget a farm entirely — on sign-out, so the next person does not see this flock. */
  async forget(farmId: string): Promise<void> {
    await this.store.remove(this.key(farmId));
  }
}
