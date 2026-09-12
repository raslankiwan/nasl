import { request } from '../api/client';
import { FlockCache, type PullResponse } from './cache';
import { Outbox } from './outbox';
import { deviceStore } from './storage.native';

/**
 * The app's instances, wired to device storage.
 *
 * The one place that knows both the pure logic and the platform. Tests construct their own with a
 * memory store, and swapping AsyncStorage for SQLite is a change to `storage.native.ts` alone.
 */
export const outbox = new Outbox(deviceStore);
export const flockCache = new FlockCache(deviceStore);

/**
 * Fetch what has changed since the last pull and fold it into the cache.
 *
 * Incremental after the first call: the cursor the cache holds is what makes a later sync cost
 * only what moved. It lives here rather than on the cache so the merge logic stays testable
 * without a network.
 */
export async function pullFlock(farmId: string): Promise<{ count: number }> {
  const cursor = await flockCache.cursor(farmId);
  const response = await request<PullResponse>(`/v1/farms/${farmId}/sync/pull`, {
    method: 'POST',
    body: { lastPulledAt: cursor },
  });
  return { count: await flockCache.applyChanges(farmId, response) };
}
