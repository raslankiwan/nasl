import type { FlockCache, PullResponse } from './cache.ts';

/** Coalesce screen refreshes and commit only a complete paginated snapshot. */
export function createPullFlock(
  cache: FlockCache,
  fetchPage: (farmId: string, body: unknown) => Promise<PullResponse>,
) {
  const pending = new Map<string, Promise<{ count: number }>>();
  return (farmId: string): Promise<{ count: number }> => {
    const existing = pending.get(farmId);
    if (existing) return existing;
    const run = (async () => {
      const lastPulledAt = await cache.cursor(farmId);
      const changes: PullResponse['changes'] = {};
      let response: PullResponse;
      let page: unknown;
      do {
        response = await fetchPage(farmId, { lastPulledAt, ...(page ? { page } : {}) });
        for (const [name, set] of Object.entries(response.changes)) {
          const combined = (changes[name] ??= { created: [], updated: [], deleted: [] });
          combined.created.push(...set.created);
          combined.updated.push(...set.updated);
          combined.deleted.push(...set.deleted);
        }
        page = response.nextPage;
      } while (page);
      return {
        count: await cache.applyChanges(farmId, { timestamp: response.timestamp, changes }),
      };
    })().finally(() => {
      pending.delete(farmId);
    });
    pending.set(farmId, run);
    return run;
  };
}
