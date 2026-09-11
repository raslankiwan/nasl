import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';

export interface Pen {
  id: string;
  name: string;
  type: string;
  capacity: number | null;
  headCount: number;
}

/**
 * Pens are read from the network rather than the cache.
 *
 * A farm has a handful of them and they change rarely, so the cost of being wrong offline is a
 * short list rather than a lost record — unlike the flock, which is why that one is cached.
 */
export function usePens() {
  const { farmId } = useAuth();
  const [pens, setPens] = useState<Pen[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    if (!farmId) return setLoading(false);
    try {
      const res = await api.get<{ groups: Pen[] }>(`/v1/farms/${farmId}/groups`);
      setPens(res.groups);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { pens, loading, offline, refresh };
}
