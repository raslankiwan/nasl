import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getAnimal, listAnimals, pull, type CachedAnimal } from './cache';

/**
 * Read the flock from the device first, then refresh from the server if it can be reached.
 *
 * Cache-first rather than network-first is the whole point: the pen is where the signal is not,
 * and a herder looking up a tag number should see it immediately whether or not there is a bar of
 * coverage. A failed refresh is not an error — it just means what is on screen is what was last
 * known, and `stale` says so.
 */
export function useFlock() {
  const { farmId } = useAuth();
  const [animals, setAnimals] = useState<CachedAnimal[]>([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(
    async (fromNetwork = true) => {
      if (!farmId) {
        setLoading(false);
        return;
      }
      setAnimals(await listAnimals(farmId));
      setLoading(false);

      if (!fromNetwork) return;
      try {
        await pull(farmId);
        setAnimals(await listAnimals(farmId));
        setStale(false);
      } catch {
        // Unreachable. What is on screen is still the best we have.
        setStale(true);
      }
    },
    [farmId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { animals, loading, stale, refresh };
}

export function useAnimal(id: string | undefined) {
  const { farmId } = useAuth();
  const [animal, setAnimal] = useState<CachedAnimal | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    if (!farmId || !id) {
      setLoading(false);
      return;
    }
    setAnimal(await getAnimal(farmId, id));
    setLoading(false);

    try {
      await pull(farmId);
      setAnimal(await getAnimal(farmId, id));
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [farmId, id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { animal, loading, stale, refresh };
}
