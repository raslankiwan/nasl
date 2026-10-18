import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Animal } from '../models/animal.model.ts';
import { Membership } from '../models/membership.model.ts';
import { Transaction } from '../models/finance.model.ts';
import type { PullPage } from '../services/sync.service.ts';
import { Mating } from '../models/breeding.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface PullBody {
  timestamp: string;
  nextPage: PullPage | null;
  changes: Record<
    string,
    { created: Array<Record<string, unknown>>; updated: unknown[]; deleted: string[] }
  >;
}
interface AnimalBody {
  id: string;
  tagNumber: string;
  repro: { state: string; dueDate: string | null } | null;
}

async function farm(url: string, phone = '+966501111111') {
  const { session, farmId } = await signInWithFarm(url, phone);
  return { client: api(url, session.accessToken), farmId };
}

before(async () => {
  await startTestMongo();
});
after(async () => {
  await stopTestMongo();
});
beforeEach(async () => {
  await clearDatabase();
});

describe('pull', () => {
  test('a first sync sends the whole farm', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      await client.post(`/v1/farms/${farmId}/animals/bulk`, {
        animals: [
          { tagNumber: '1001', species: 'sheep', sex: 'female' },
          { tagNumber: '1002', species: 'sheep', sex: 'female' },
        ],
      });

      const res = await client.post<PullBody>(`/v1/farms/${farmId}/sync/pull`, {});
      assert.equal(res.status, 200);
      assert.equal(res.body.changes.animals?.created.length, 2);
      assert.ok(res.body.timestamp);
    });
  });

  test('a later pull sends only what moved', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      await client.post(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });

      const first = await client.post<PullBody>(`/v1/farms/${farmId}/sync/pull`, {});
      const quiet = await client.post<PullBody>(`/v1/farms/${farmId}/sync/pull`, {
        lastPulledAt: first.body.timestamp,
      });
      assert.equal(quiet.body.changes.animals?.created.length, 0);

      await client.post(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1002',
        species: 'sheep',
        sex: 'female',
      });
      const next = await client.post<PullBody>(`/v1/farms/${farmId}/sync/pull`, {
        lastPulledAt: first.body.timestamp,
      });
      assert.equal(next.body.changes.animals?.created.length, 1);
    });
  });

  test('a deletion arrives as a deletion, so the device can remove it locally', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const created = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });
      const cursor = (await client.post<PullBody>(`/v1/farms/${farmId}/sync/pull`, {})).body
        .timestamp;

      await Animal.updateOne({ _id: created.body.id }, { $set: { deletedAt: new Date() } });

      const res = await client.post<PullBody>(`/v1/farms/${farmId}/sync/pull`, {
        lastPulledAt: cursor,
      });
      assert.deepEqual(res.body.changes.animals?.deleted, [created.body.id]);
    });
  });

  test('a pull never reaches another farm', async () => {
    await withServer(testApp(), async (url) => {
      const a = await farm(url, '+966501111111');
      const b = await farm(url, '+966502222222');
      await a.client.post(`/v1/farms/${a.farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });

      const res = await b.client.post<PullBody>(`/v1/farms/${b.farmId}/sync/pull`, {});
      assert.equal(res.body.changes.animals?.created.length, 0);
    });
  });
});

describe('safe sync boundaries', () => {
  test('pages through tied timestamps without skipping animals or advancing early', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const at = new Date('2026-01-01T00:00:00Z');
      await Animal.collection.insertMany(
        Array.from({ length: 7 }, (_, n) => ({
          _id: randomUUID(),
          farmId,
          tagNumber: String(n),
          species: 'sheep',
          sex: 'female',
          status: 'active',
          deletedAt: null,
          createdAt: at,
          updatedAt: at,
        })),
      );
      const seen: string[] = [];
      let page: PullPage | undefined;
      for (let n = 0; n < 5; n++) {
        const res = await client.post<PullBody>(`/v1/farms/${farmId}/sync/pull`, {
          limit: 2,
          page,
        });
        assert.equal(res.status, 200);
        seen.push(...res.body.changes.animals!.created.map((d) => String(d._id)));
        if (!res.body.nextPage) {
          assert.ok(res.body.timestamp > at.toISOString());
          break;
        }
        assert.equal(res.body.timestamp, new Date(0).toISOString());
        page = res.body.nextPage;
      }
      assert.equal(seen.length, 7);
      assert.equal(new Set(seen).size, 7);
    });
  });

  test('worker sync cannot read financial collections or advertise them', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      await Transaction.collection.insertOne({
        _id: randomUUID(),
        farmId,
        amount: 900,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      const owner = await client.post<PullBody>(`/v1/farms/${farmId}/sync/pull`, {});
      assert.equal(owner.body.changes.transactions?.created.length, 1);
      await Membership.updateOne({ farmId }, { $set: { role: 'worker' } });
      const worker = await client.post<PullBody>(`/v1/farms/${farmId}/sync/pull`, {});
      assert.equal(worker.body.changes.transactions, undefined);
      assert.equal(worker.body.changes.feedLogs, undefined);
      const meta = await client.get<{ collections: string[] }>(`/v1/farms/${farmId}/sync/meta`);
      assert.equal(meta.body.collections.includes('transactions'), false);
    });
  });

  test('legacy raw writes are explicitly refused without changing farm records', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const created = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });
      await Animal.updateOne(
        { _id: created.body.id },
        { $set: { withholdMeatUntil: new Date('2099-01-01') } },
      );
      for (const schemaVersion of [1, 999]) {
        const result = await client.post<{ error: { code: string } }>(
          `/v1/farms/${farmId}/sync/push`,
          {
            schemaVersion,
            changes: {
              animals: {
                updated: [{ _id: created.body.id, status: 'sold', withholdMeatUntil: null }],
                deleted: [created.body.id],
              },
              matings: { created: [{ _id: randomUUID(), damId: created.body.id }] },
            },
          },
        );
        assert.equal(result.status, 426);
        assert.equal(result.body.error.code, 'sync_upgrade_required');
      }
      const animal = await Animal.findById(created.body.id).lean();
      assert.equal(animal?.status, 'active');
      assert.equal(animal?.deletedAt, null);
      assert.ok(animal?.withholdMeatUntil);
      assert.equal(await Mating.countDocuments({ farmId }), 0);
    });
  });

  test('a future read schema is refused rather than silently misunderstood', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      assert.equal(
        (await client.post(`/v1/farms/${farmId}/sync/pull`, { schemaVersion: 999 })).status,
        426,
      );
    });
  });
});
