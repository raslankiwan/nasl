import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface AnimalBody {
  id: string;
  tagNumber: string;
  lastWeightKg: number | null;
}
interface History {
  tagNumber: string;
  birthWeightKg: number | null;
  current: number | null;
  lifetimeGainPerDay: number | null;
  adjusted90DayWeightKg: number | null;
  entries: Array<{ date: string; kg: number; gainPerDay: number | null }>;
}
interface ErrorBody {
  error: { message: string };
}

async function flock(url: string, phone = '+966501111111') {
  const { session, farmId } = await signInWithFarm(url, phone);
  const client = api(url, session.accessToken);
  const animal = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
    tagNumber: '1001',
    species: 'sheep',
    classification: 'mother',
    sex: 'female',
    dateOfBirth: '2026-01-01',
  });
  return { client, farmId, animalId: animal.body.id };
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

describe('recording weights', () => {
  test('a weighing is stored and becomes the animal’s current weight', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animalId } = await flock(url);

      const res = await client.post(`/v1/farms/${farmId}/weights`, {
        animalId,
        date: '2026-03-01',
        kg: 24.5,
      });
      assert.equal(res.status, 201);

      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animalId}`);
      assert.equal(animal.body.lastWeightKg, 24.5);
    });
  });

  test('a backfilled older weighing does not become the current weight', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animalId } = await flock(url);

      await client.post(`/v1/farms/${farmId}/weights`, { animalId, date: '2026-04-01', kg: 30 });
      // Entered second, but it happened first.
      await client.post(`/v1/farms/${farmId}/weights`, { animalId, date: '2026-02-01', kg: 15 });

      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animalId}`);
      assert.equal(animal.body.lastWeightKg, 30, 'the latest by date, not by entry order');
    });
  });

  test('a whole pen is weighed in one session', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await flock(url);
      const bulk = await client.post<{ created: AnimalBody[] }>(
        `/v1/farms/${farmId}/animals/bulk`,
        {
          animals: [
            {
              tagNumber: '2001',
              species: 'sheep',
              classification: 'mother',
              dateOfBirth: '2020-01-01',
              sex: 'female',
            },
            {
              tagNumber: '2002',
              species: 'sheep',
              classification: 'mother',
              dateOfBirth: '2020-01-01',
              sex: 'female',
            },
          ],
        },
      );

      const res = await client.post<{ recorded: number }>(`/v1/farms/${farmId}/weights/session`, {
        date: '2026-03-01',
        weights: bulk.body.created.map((a, i) => ({ animalId: a.id, kg: 20 + i })),
      });
      assert.equal(res.body.recorded, 2);
    });
  });

  test('one animal missing from the farm does not discard the session', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animalId } = await flock(url);
      const res = await client.post<{ recorded: number }>(`/v1/farms/${farmId}/weights/session`, {
        date: '2026-03-01',
        weights: [
          { animalId, kg: 22 },
          { animalId: '00000000-0000-4000-8000-000000000000', kg: 25 },
        ],
      });
      assert.equal(res.body.recorded, 1);
    });
  });

  test("another farm's animal cannot be weighed", async () => {
    await withServer(testApp(), async (url) => {
      const a = await flock(url, '+966501111111');
      const b = await flock(url, '+966502222222');

      const res = await a.client.post<ErrorBody>(`/v1/farms/${a.farmId}/weights`, {
        animalId: b.animalId,
        date: '2026-03-01',
        kg: 25,
      });
      assert.equal(res.status, 404);
    });
  });
});

describe('growth history', () => {
  test('each weighing carries the gain since the one before it', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animalId } = await flock(url);

      await client.post(`/v1/farms/${farmId}/weights`, { animalId, date: '2026-03-01', kg: 20 });
      await client.post(`/v1/farms/${farmId}/weights`, { animalId, date: '2026-03-31', kg: 29 });

      const res = await client.get<History>(`/v1/farms/${farmId}/weights/${animalId}`);
      assert.equal(res.body.entries.length, 2);
      assert.equal(res.body.entries[0]?.gainPerDay, null, 'the first has nothing to compare to');
      assert.equal(res.body.entries[1]?.gainPerDay, 0.3);
      assert.equal(res.body.current, 29);
      assert.equal(res.body.lifetimeGainPerDay, 0.3);
    });
  });

  test('a lamb with a birth weight gets an adjusted 90-day figure', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animalId } = await flock(url);
      const sire = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '3001',
        species: 'sheep',
        classification: 'male',
        dateOfBirth: '2020-01-01',
        sex: 'male',
      });

      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId: animalId,
        sireId: sire.body.id,
        startDate: '2026-01-05',
      });
      const birth = await client.post<{ offspring: Array<{ animalId: string | null }> }>(
        `/v1/farms/${farmId}/breeding/births`,
        {
          damId: animalId,
          date: '2026-06-01',
          offspring: [{ sex: 'female', outcome: 'live', birthWeightKg: 4 }],
        },
      );
      const lambId = birth.body.offspring[0]!.animalId!;

      // Weighed at 70 days, gaining 0.25 kg/day.
      await client.post(`/v1/farms/${farmId}/weights`, {
        animalId: lambId,
        date: '2026-08-10',
        kg: 21.5,
      });

      const res = await client.get<History>(`/v1/farms/${farmId}/weights/${lambId}`);
      assert.equal(res.body.birthWeightKg, 4);
      assert.equal(res.body.adjusted90DayWeightKg, 26.5, 'projected to a standard age');
    });
  });

  test('an animal with no weighings reads back empty rather than failing', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animalId } = await flock(url);
      const res = await client.get<History>(`/v1/farms/${farmId}/weights/${animalId}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.entries, []);
      assert.equal(res.body.current, null);
      assert.equal(res.body.lifetimeGainPerDay, null);
    });
  });

  test('history never crosses farms', async () => {
    await withServer(testApp(), async (url) => {
      const a = await flock(url, '+966501111111');
      const b = await flock(url, '+966502222222');
      const res = await b.client.get<ErrorBody>(`/v1/farms/${b.farmId}/weights/${a.animalId}`);
      assert.equal(res.status, 404);
    });
  });
});

test('retrying a saved weighing returns the original record without duplication', async () => {
  await withServer(testApp(), async (url) => {
    const { client, farmId, animalId } = await flock(url);
    const id = globalThis.crypto.randomUUID();
    const input = { id, animalId, date: '2026-03-01', kg: 42.35 };
    const first = await client.post(`/v1/farms/${farmId}/weights`, input);
    const retry = await client.post(`/v1/farms/${farmId}/weights`, input);
    assert.equal(first.status, 201);
    assert.equal(retry.status, 201);
    assert.deepEqual(retry.body, first.body);
    const history = await client.get<{ entries: unknown[] }>(
      `/v1/farms/${farmId}/weights/${animalId}`,
    );
    assert.equal(history.body.entries.length, 1);
  });
});

test('two weighings on one day use the latest recorded measurement', async () => {
  await withServer(testApp(), async (url) => {
    const { client, farmId, animalId } = await flock(url);
    await client.post(`/v1/farms/${farmId}/weights`, { animalId, date: '2026-03-01', kg: 42.35 });
    await client.post(`/v1/farms/${farmId}/weights`, { animalId, date: '2026-03-01', kg: 43.5 });
    const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animalId}`);
    assert.equal(animal.body.lastWeightKg, 43.5);
  });
});
