import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Animal } from '../models/animal.model.ts';
import { Mating } from '../models/breeding.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface PullBody {
  timestamp: string;
  changes: Record<
    string,
    { created: Array<Record<string, unknown>>; updated: unknown[]; deleted: string[] }
  >;
}
interface PushBody {
  applied: number;
  rejected: Array<{ collection: string; id: string; reason: string }>;
  recomputed: number;
  timestamp: string;
}
interface AnimalBody {
  id: string;
  tagNumber: string;
  repro: { state: string; dueDate: string | null } | null;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

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

describe('push', () => {
  test('a device that has been away pushes records the server has never seen', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const id = randomUUID();

      const res = await client.post<PushBody>(`/v1/farms/${farmId}/sync/push`, {
        changes: {
          animals: {
            created: [
              {
                _id: id,
                tagNumber: '5001',
                species: 'sheep',
                sex: 'female',
                origin: 'born',
                status: 'active',
                dobIsEstimate: false,
                photoKeys: [],
              },
            ],
            updated: [],
            deleted: [],
          },
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.applied, 1);
      assert.deepEqual(res.body.rejected, []);

      const fetched = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${id}`);
      assert.equal(fetched.body.tagNumber, '5001');
    });
  });

  test('re-pushing the same event twice is a no-op, so a dropped connection is safe to retry', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const dam = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });

      const matingId = randomUUID();
      const payload = {
        changes: {
          matings: {
            created: [
              {
                _id: matingId,
                damId: dam.body.id,
                method: 'natural',
                startDate: daysAgo(10).toISOString(),
                expectedDueDate: new Date().toISOString(),
                sireUncertain: false,
                recordedBy: 'device',
              },
            ],
            updated: [],
            deleted: [],
          },
        },
      };

      await client.post<PushBody>(`/v1/farms/${farmId}/sync/push`, payload);
      await client.post<PushBody>(`/v1/farms/${farmId}/sync/push`, payload);

      assert.equal(await Mating.countDocuments({ farmId, damId: dam.body.id }), 1);
    });
  });

  test('a client cannot write the fields the server owns', async () => {
    await withServer(testApp(), async (url) => {
      const a = await farm(url, '+966501111111');
      const b = await farm(url, '+966502222222');
      const id = randomUUID();

      await a.client.post<PushBody>(`/v1/farms/${a.farmId}/sync/push`, {
        changes: {
          animals: {
            created: [
              {
                _id: id,
                farmId: b.farmId,
                tagNumber: '7001',
                species: 'sheep',
                sex: 'female',
                origin: 'born',
                status: 'active',
                dobIsEstimate: false,
                photoKeys: [],
                // A device must not be able to declare itself clear of a withdrawal.
                withholdMeatUntil: null,
                repro: { state: 'pregnant', sinceDate: new Date().toISOString() },
              },
            ],
            updated: [],
            deleted: [],
          },
        },
      });

      const stored = await Animal.findById(id).lean();
      assert.equal(stored?.farmId, a.farmId, 'farmId comes from the verified membership');
      assert.equal(stored?.repro, null, 'derived state is not the client’s to set');
    });
  });

  test('an event cannot be deleted by a client — it is evidence, not a draft', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const res = await client.post<PushBody>(`/v1/farms/${farmId}/sync/push`, {
        changes: {
          births: { created: [], updated: [], deleted: [randomUUID()] },
        },
      });
      assert.equal(res.body.rejected.length, 1);
      assert.match(res.body.rejected[0]!.reason, /cannot be deleted/);
    });
  });

  test('one malformed row does not strand the rest of the batch', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const good = randomUUID();

      const res = await client.post<PushBody>(`/v1/farms/${farmId}/sync/push`, {
        changes: {
          animals: {
            created: [
              { tagNumber: 'no-id-here', species: 'sheep', sex: 'female' },
              {
                _id: good,
                tagNumber: '8001',
                species: 'sheep',
                sex: 'female',
                origin: 'born',
                status: 'active',
                dobIsEstimate: false,
                photoKeys: [],
              },
            ],
            updated: [],
            deleted: [],
          },
        },
      });

      assert.equal(res.body.applied, 1, 'the good row landed');
      assert.equal(res.body.rejected.length, 1);
      assert.equal(res.body.rejected[0]?.reason, 'no id');
    });
  });

  test('an unknown collection is refused rather than silently dropped', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const res = await client.post<{ error: { message: string } }>(
        `/v1/farms/${farmId}/sync/push`,
        { changes: { sheepThoughts: { created: [], updated: [], deleted: [] } } },
      );
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /Unknown collection/);
    });
  });
});

describe('derived state is rebuilt from the events, not trusted from the device', () => {
  test('a fortnight of offline breeding replays into the right state', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const dam = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });

      // The phone was off-grid: a mating, then a scan, recorded days apart and pushed together.
      const res = await client.post<PushBody>(`/v1/farms/${farmId}/sync/push`, {
        changes: {
          matings: {
            created: [
              {
                _id: randomUUID(),
                damId: dam.body.id,
                method: 'natural',
                startDate: daysAgo(60).toISOString(),
                expectedDueDate: new Date(Date.now() + 87 * 86_400_000).toISOString(),
                sireUncertain: false,
                recordedBy: 'device',
              },
            ],
            updated: [],
            deleted: [],
          },
          pregnancyChecks: {
            created: [
              {
                _id: randomUUID(),
                damId: dam.body.id,
                matingId: randomUUID(),
                date: daysAgo(10).toISOString(),
                method: 'ultrasound',
                result: 'pregnant',
                recordedBy: 'device',
              },
            ],
            updated: [],
            deleted: [],
          },
        },
      });

      assert.equal(res.body.recomputed, 1);
      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${dam.body.id}`);
      assert.equal(animal.body.repro?.state, 'pregnant');
    });
  });

  test('events arriving out of order still replay in the order they happened', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const dam = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });

      // The birth is pushed before the mating it descends from.
      await client.post<PushBody>(`/v1/farms/${farmId}/sync/push`, {
        changes: {
          births: {
            created: [
              {
                _id: randomUUID(),
                damId: dam.body.id,
                date: daysAgo(5).toISOString(),
                birthType: 'single',
                assisted: false,
                difficulty: 1,
                offspring: [{ sex: 'female', outcome: 'live' }],
                recordedBy: 'device',
              },
            ],
            updated: [],
            deleted: [],
          },
          matings: {
            created: [
              {
                _id: randomUUID(),
                damId: dam.body.id,
                method: 'natural',
                startDate: daysAgo(152).toISOString(),
                expectedDueDate: daysAgo(5).toISOString(),
                sireUncertain: false,
                recordedBy: 'device',
              },
            ],
            updated: [],
            deleted: [],
          },
        },
      });

      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${dam.body.id}`);
      assert.equal(
        animal.body.repro?.state,
        'nursing',
        'mating then birth, whatever the push order',
      );
    });
  });

  test('a replay is total: an impossible event is skipped, not fatal', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const dam = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });

      // Two matings with no intervening birth — the second cannot apply.
      const mating = (days: number) => ({
        _id: randomUUID(),
        damId: dam.body.id,
        method: 'natural',
        startDate: daysAgo(days).toISOString(),
        expectedDueDate: new Date().toISOString(),
        sireUncertain: false,
        recordedBy: 'device',
      });

      const res = await client.post<PushBody>(`/v1/farms/${farmId}/sync/push`, {
        changes: {
          matings: { created: [mating(40), mating(20)], updated: [], deleted: [] },
        },
      });

      assert.equal(res.body.applied, 2, 'both events are stored — they were observed');
      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${dam.body.id}`);
      assert.equal(animal.body.repro?.state, 'mated', 'the first one wins; the second is skipped');
    });
  });

  test('a stale device cannot undo a withdrawal the server applied', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const animal = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });
      const until = new Date(Date.now() + 20 * 86_400_000);
      await Animal.updateOne({ _id: animal.body.id }, { $set: { withholdMeatUntil: until } });

      await client.post<PushBody>(`/v1/farms/${farmId}/sync/push`, {
        changes: {
          animals: {
            created: [],
            updated: [
              { _id: animal.body.id, tagNumber: '1001', name: 'غزال', withholdMeatUntil: null },
            ],
            deleted: [],
          },
        },
      });

      const stored = await Animal.findById(animal.body.id).lean();
      assert.ok(stored?.withholdMeatUntil, 'the hold survives');
      assert.equal(stored?.name, 'غزال', 'the rest of the update still applies');
    });
  });
});
