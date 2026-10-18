import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { useSync } from './SyncProvider';
import type { CachedAnimal } from './cache';
import { flockCache, pullFlock } from './device';

/** A farm change hides the old snapshot immediately and ignores late responses from it. */
function useCachedRead<T>(key: string, farmId: string | null, read: () => Promise<T>, empty: T) {
  const current = useRef(key);
  current.current = key;
  const { pending, online } = useSync();
  const [snapshot, setSnapshot] = useState({ key, data: empty, loading: true, stale: false });
  const refresh = useCallback(
    async (fromNetwork = true) => {
      const update = (data: T, stale = false) => {
        if (current.current === key) setSnapshot({ key, data, loading: false, stale });
      };
      if (!farmId) {
        update(empty);
        return;
      }
      const cached = await read();
      update(cached);
      if (!fromNetwork) return;
      try {
        await pullFlock(farmId);
        update(await read());
      } catch {
        update(cached, true);
      }
    },
    [key, farmId, read, empty],
  );

  // A successful outbox flush also refreshes a screen that stayed open during the outage.
  useEffect(() => {
    void refresh();
  }, [refresh, pending, online]);
  return {
    ...(snapshot.key === key ? snapshot : { data: empty, loading: true, stale: false }),
    refresh,
  };
}

const EMPTY_FLOCK: CachedAnimal[] = [];
export function useFlock() {
  const { farmId } = useAuth();
  const read = useCallback(
    () => (farmId ? flockCache.listAnimals(farmId, true) : Promise.resolve(EMPTY_FLOCK)),
    [farmId],
  );
  const { data: allAnimals, ...rest } = useCachedRead(farmId ?? '', farmId, read, EMPTY_FLOCK);
  const animals = useMemo(
    () => allAnimals.filter((animal) => animal.status === 'active'),
    [allAnimals],
  );
  const animalsById = useMemo(
    () => new Map(allAnimals.map((animal) => [animal.id, animal])),
    [allAnimals],
  );
  return { animals, allAnimals, animalsById, ...rest };
}

export function useAnimal(id: string | undefined) {
  const { farmId } = useAuth();
  const read = useCallback(
    () => (farmId && id ? flockCache.getAnimal(farmId, id) : Promise.resolve(null)),
    [farmId, id],
  );
  const { data: animal, ...rest } = useCachedRead(
    `${farmId ?? ''}/${id ?? ''}`,
    id ? farmId : null,
    read,
    null,
  );
  useFocusEffect(
    useCallback(() => {
      void rest.refresh();
    }, [rest.refresh]),
  );
  return { animal, ...rest };
}
