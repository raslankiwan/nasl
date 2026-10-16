import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { testApp, withServer } from '../testing/harness.ts';
import { mongoRateLimitStore } from './rateLimitStore.ts';
import { RateLimit } from '../models/rateLimit.model.ts';

before(() => startTestMongo());
after(stopTestMongo);
beforeEach(clearDatabase);

test('concurrent rate-limit updates are counted and expired counters reset before TTL deletion', async () => {
  const first = mongoRateLimitStore('test');
  const second = mongoRateLimitStore('test');
  const hits = await Promise.all(
    Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).increment('client')),
  );
  assert.equal(Math.max(...hits.map((hit) => hit.totalHits)), 20);
  await RateLimit.updateMany({}, { $set: { expiresAt: new Date(0) } });
  assert.equal((await first.increment('client')).totalHits, 1);
});

test('production CORS only allows configured origins and responses are never CDN cached', async () => {
  await withServer(
    testApp({ NODE_ENV: 'production', CORS_ORIGINS: 'https://nasl.example' }),
    async (url) => {
      const allowed = await fetch(`${url}/health`, { headers: { origin: 'https://nasl.example' } });
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://nasl.example');
      assert.match(allowed.headers.get('cache-control')!, /no-store/);
      const denied = await fetch(`${url}/health`, { headers: { origin: 'https://other.example' } });
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
    },
  );
});
