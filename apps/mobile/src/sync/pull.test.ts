import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlockCache, type PullResponse } from './cache.ts';
import { memoryStore } from './storage.ts';
import { createPullFlock } from './pull.ts';
const page = (id: string, nextPage?: unknown): PullResponse => ({
  timestamp: '2026-10-18T00:00:00Z',
  nextPage,
  changes: { animals: { created: [{ _id: id, tagNumber: id }], updated: [], deleted: [] } },
});
test('follows every page before committing the cursor and coalesces refreshes', async () => {
  const cache = new FlockCache(memoryStore());
  let calls = 0;
  const pull = createPullFlock(cache, async () => {
    calls++;
    assert.equal(await cache.cursor('farm'), null);
    return page(String(calls), calls === 1 ? { until: 'next' } : null);
  });
  await Promise.all([pull('farm'), pull('farm')]);
  assert.equal(calls, 2);
  assert.equal((await cache.listAnimals('farm')).length, 2);
  assert.equal(await cache.cursor('farm'), '2026-10-18T00:00:00Z');
});
test('a failed later page leaves the previous cache and cursor intact', async () => {
  const cache = new FlockCache(memoryStore());
  await cache.applyChanges('farm', page('old'));
  let calls = 0;
  const pull = createPullFlock(cache, async () => {
    if (++calls === 2) throw new Error('offline');
    return page('new', { until: 'next' });
  });
  await assert.rejects(pull('farm'), /offline/);
  assert.deepEqual(
    (await cache.listAnimals('farm')).map((a) => a.id),
    ['old'],
  );
  assert.equal(await cache.cursor('farm'), '2026-10-18T00:00:00Z');
});
