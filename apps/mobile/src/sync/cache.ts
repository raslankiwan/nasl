import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from '../api/client';

/**
 * The local flock, fed by the sync/pull change sets.
 *
 * This is the read half of offline. Writes already survive without a network (see `outbox.ts`);
 * without this, the roster shows a connection error in exactly the place a herder needs to look
 * something up — which is most of the time, because the pen is where the signal is not.
 *
 * Storage is AsyncStorage, which is honest for the flocks this launches with: Palestinian holdings
 * run to tens or low hundreds of head. It is *not* right for the commercial tier — 2,000 animals
 * and 50,000 events (NFR-02) want SQLite — and the interface here is deliberately narrow so that
 * swap is a change of one file.
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

const key = (farmId: string) => `nasl.cache.${farmId}`;

const empty = (farmId: string): CacheShape => ({
  farmId,
  cursor: null,
  syncedAt: null,
  animals: {},
});

async function read(farmId: string): Promise<CacheShape> {
  try {
    const raw = await AsyncStorage.getItem(key(farmId));
    return raw ? (JSON.parse(raw) as CacheShape) : empty(farmId);
  } catch {
    return empty(farmId);
  }
}

async function write(cache: CacheShape): Promise<void> {
  try {
    await AsyncStorage.setItem(key(cache.farmId), JSON.stringify(cache));
  } catch {
    // Out of storage. The caller still has the data it just merged, in memory.
  }
}

/** Server documents use `_id`; the app uses `id` everywhere else. */
function toCached(doc: Record<string, unknown>): CachedAnimal | null {
  const id = typeof doc._id === 'string' ? doc._id : null;
  if (!id || typeof doc.tagNumber !== 'string') return null;

  const date = (value: unknown) =>
    typeof value === 'string'
      ? value.slice(0, 10)
      : value instanceof Date
        ? value.toISOString().slice(0, 10)
        : null;

  const repro = doc.repro as
    { state?: string; sinceDate?: string; dueDate?: string | null } | null | undefined;

  return {
    id,
    tagNumber: doc.tagNumber,
    name: (doc.name as string | null) ?? null,
    species: (doc.species as string) ?? 'sheep',
    breedId: (doc.breedId as string | null) ?? null,
    sex: (doc.sex as string) ?? 'female',
    dateOfBirth: date(doc.dateOfBirth),
    status: (doc.status as string) ?? 'active',
    currentGroupId: (doc.currentGroupId as string | null) ?? null,
    damId: (doc.damId as string | null) ?? null,
    sireId: (doc.sireId as string | null) ?? null,
    repro:
      repro && repro.state && repro.sinceDate
        ? {
            state: repro.state,
            sinceDate: date(repro.sinceDate) ?? repro.sinceDate,
            dueDate: date(repro.dueDate),
          }
        : null,
    lastWeightKg: (doc.lastWeightKg as number | null) ?? null,
    withholdMeatUntil: date(doc.withholdMeatUntil),
    withholdMilkUntil: date(doc.withholdMilkUntil),
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : new Date().toISOString(),
  };
}

interface PullResponse {
  timestamp: string;
  changes: Record<
    string,
    { created: Record<string, unknown>[]; updated: Record<string, unknown>[]; deleted: string[] }
  >;
}

/**
 * Fetch what has changed and fold it into the local copy.
 *
 * Incremental by design: the first call takes the whole farm, every later one takes only what
 * moved. Nothing is written until the whole response is in hand, so a connection that drops
 * mid-pull leaves the previous cursor — and therefore the previous cache — intact.
 */
export async function pull(farmId: string): Promise<{ synced: boolean; count: number }> {
  const cache = await read(farmId);

  const response = await request<PullResponse>(`/v1/farms/${farmId}/sync/pull`, {
    method: 'POST',
    body: { lastPulledAt: cache.cursor },
  });

  const animals = { ...cache.animals };
  const set = response.changes.animals;
  let count = 0;

  for (const doc of [...(set?.created ?? []), ...(set?.updated ?? [])]) {
    const animal = toCached(doc);
    if (animal) {
      animals[animal.id] = animal;
      count += 1;
    }
  }
  for (const id of set?.deleted ?? []) {
    delete animals[id];
    count += 1;
  }

  await write({
    farmId,
    cursor: response.timestamp,
    syncedAt: new Date().toISOString(),
    animals,
  });

  return { synced: true, count };
}

export async function listAnimals(farmId: string): Promise<CachedAnimal[]> {
  const cache = await read(farmId);
  return Object.values(cache.animals)
    .filter((a) => a.status === 'active')
    .sort((a, b) => a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true }));
}

export async function getAnimal(farmId: string, id: string): Promise<CachedAnimal | null> {
  return (await read(farmId)).animals[id] ?? null;
}

export async function lastSyncedAt(farmId: string): Promise<string | null> {
  return (await read(farmId)).syncedAt;
}

/** Forget everything for a farm — on sign-out, so the next person does not see this flock. */
export async function forget(farmId: string): Promise<void> {
  await AsyncStorage.removeItem(key(farmId));
}
