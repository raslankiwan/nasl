import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Animal } from '../models/animal.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface AnimalBody {
  id: string;
  tagNumber: string;
}
interface Lactation {
  lactationId: string;
  tagNumber: string;
  startDate: string;
  endDate: string | null;
  status: string;
  daysInMilk: number;
  testDays: number;
  totalKg: number;
  standardised150Kg: number;
  peakKg: number | null;
}
interface TestDayResult {
  recorded: number;
  withheld: Array<{ tagNumber: string; until: string }>;
  skipped: string[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

/** A ewe who has lambed — which is what opens a lactation. */
async function milkingEwe(url: string, phone = '+966501111111', lambedDaysAgo = 90) {
  const { session, farmId } = await signInWithFarm(url, phone);
  const client = api(url, session.accessToken);

  const dam = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
    tagNumber: '1001',
    species: 'sheep',
    sex: 'female',
    breedId: 'awassi',
  });
  const sire = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
    tagNumber: '3001',
    species: 'sheep',
    sex: 'male',
  });

  await client.post(`/v1/farms/${farmId}/breeding/matings`, {
    damId: dam.body.id,
    sireId: sire.body.id,
    startDate: daysAgo(lambedDaysAgo + 147),
  });
  await client.post(`/v1/farms/${farmId}/breeding/births`, {
    damId: dam.body.id,
    date: daysAgo(lambedDaysAgo),
    offspring: [{ sex: 'female', outcome: 'live', birthWeightKg: 4 }],
  });

  return { client, farmId, damId: dam.body.id };
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

describe('lactations', () => {
  test('lambing opens a lactation without anyone declaring it', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await milkingEwe(url);

      const res = await client.get<{ lactations: Lactation[] }>(
        `/v1/farms/${farmId}/milk/animals/${damId}`,
      );
      assert.equal(res.body.lactations.length, 1);
      assert.equal(res.body.lactations[0]?.status, 'milking');
      assert.equal(res.body.lactations[0]?.daysInMilk, 90);
    });
  });

  test('lambing again closes the previous lactation on the new lambing date', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await milkingEwe(url, '+966501111111', 300);

      await client.post(`/v1/farms/${farmId}/breeding/weanings`, {
        damId,
        date: daysAgo(220),
      });
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        startDate: daysAgo(200),
      });
      await client.post(`/v1/farms/${farmId}/breeding/births`, {
        damId,
        date: daysAgo(50),
        offspring: [{ sex: 'male', outcome: 'live' }],
      });

      const res = await client.get<{ lactations: Lactation[] }>(
        `/v1/farms/${farmId}/milk/animals/${damId}`,
      );
      assert.equal(res.body.lactations.length, 2);
      assert.equal(res.body.lactations[0]?.status, 'milking', 'newest first, and still running');
      assert.equal(res.body.lactations[1]?.status, 'dried');
      assert.equal(res.body.lactations[1]?.endDate, daysAgo(50));
    });
  });

  test('drying off closes it', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await milkingEwe(url);

      const res = await client.post(`/v1/farms/${farmId}/milk/dry-off/${damId}`, {
        date: iso(new Date()),
      });
      assert.equal(res.status, 200);

      const after = await client.get<{ lactations: Lactation[] }>(
        `/v1/farms/${farmId}/milk/animals/${damId}`,
      );
      assert.equal(after.body.lactations[0]?.status, 'dried');
    });
  });

  test('drying off a ewe who is not milking is refused', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);
      const dry = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });

      const res = await client.post(`/v1/farms/${farmId}/milk/dry-off/${dry.body.id}`, {});
      assert.equal(res.status, 409);
    });
  });
});

describe('test days', () => {
  test('yield is estimated from the test points', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await milkingEwe(url, '+966501111111', 90);

      for (const [days, kg] of [
        [60, 2.0],
        [30, 2.4],
        [0, 1.8],
      ] as const) {
        await client.post(`/v1/farms/${farmId}/milk/test-days`, {
          date: daysAgo(days),
          entries: [{ animalId: damId, kg }],
        });
      }

      const res = await client.get<{ lactations: Lactation[] }>(
        `/v1/farms/${farmId}/milk/animals/${damId}`,
      );
      const lactation = res.body.lactations[0]!;
      assert.equal(lactation.testDays, 3);
      assert.equal(lactation.peakKg, 2.4);
      // lambing→30d at 2.0, then the interval means, then the last point held to today.
      assert.ok(lactation.totalKg > 150, `${lactation.totalKg} kg over 90 days`);
    });
  });

  test('re-entering a test day corrects it rather than adding a second', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await milkingEwe(url);
      const date = daysAgo(10);

      await client.post(`/v1/farms/${farmId}/milk/test-days`, {
        date,
        entries: [{ animalId: damId, kg: 2.0 }],
      });
      await client.post(`/v1/farms/${farmId}/milk/test-days`, {
        date,
        entries: [{ animalId: damId, kg: 2.6 }],
      });

      const res = await client.get<{ lactations: Lactation[] }>(
        `/v1/farms/${farmId}/milk/animals/${damId}`,
      );
      assert.equal(res.body.lactations[0]?.testDays, 1);
      assert.equal(res.body.lactations[0]?.peakKg, 2.6, 'the correction, not the original');
    });
  });

  test('a ewe under a milk withdrawal is recorded but reported back', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await milkingEwe(url);
      const until = new Date(Date.now() + 5 * 86_400_000);
      await Animal.updateOne({ _id: damId }, { $set: { withholdMilkUntil: until } });

      const res = await client.post<TestDayResult>(`/v1/farms/${farmId}/milk/test-days`, {
        date: iso(new Date()),
        entries: [{ animalId: damId, kg: 2.2 }],
      });

      assert.equal(res.body.recorded, 1, 'the measurement is real and is kept');
      assert.equal(res.body.withheld.length, 1, 'but her milk must not reach the tank');
      assert.equal(res.body.withheld[0]?.tagNumber, '1001');
      assert.equal(res.body.withheld[0]?.until, iso(until));
    });
  });

  test('an animal from another farm is skipped, not recorded', async () => {
    await withServer(testApp(), async (url) => {
      const a = await milkingEwe(url, '+966501111111');
      const b = await milkingEwe(url, '+966502222222');

      const res = await a.client.post<TestDayResult>(`/v1/farms/${a.farmId}/milk/test-days`, {
        date: iso(new Date()),
        entries: [
          { animalId: a.damId, kg: 2.0 },
          { animalId: b.damId, kg: 9.9 },
        ],
      });
      assert.equal(res.body.recorded, 1);
      assert.deepEqual(res.body.skipped, [b.damId]);
    });
  });

  test('the milking flock is ranked by standardised yield', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await milkingEwe(url, '+966501111111', 60);
      const second = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1002',
        species: 'sheep',
        sex: 'female',
      });
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId: second.body.id,
        startDate: daysAgo(207),
      });
      await client.post(`/v1/farms/${farmId}/breeding/births`, {
        damId: second.body.id,
        date: daysAgo(60),
        offspring: [{ sex: 'female', outcome: 'live' }],
      });

      await client.post(`/v1/farms/${farmId}/milk/test-days`, {
        date: daysAgo(30),
        entries: [
          { animalId: damId, kg: 1.2 },
          { animalId: second.body.id, kg: 3.1 },
        ],
      });

      const res = await client.get<{ lactations: Lactation[] }>(`/v1/farms/${farmId}/milk/milking`);
      assert.equal(res.body.lactations.length, 2);
      assert.equal(res.body.lactations[0]?.tagNumber, '1002', 'the better milker leads');
    });
  });
});

describe('the tank', () => {
  test('collections total for a period', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await milkingEwe(url);

      await client.post(`/v1/farms/${farmId}/milk/collections`, {
        date: daysAgo(1),
        session: 'morning',
        qtyKg: 42,
      });
      await client.post(`/v1/farms/${farmId}/milk/collections`, {
        date: daysAgo(1),
        session: 'evening',
        qtyKg: 38,
      });
      await client.post(`/v1/farms/${farmId}/milk/collections`, {
        date: iso(new Date()),
        session: 'day',
        qtyKg: 75,
      });

      const res = await client.get<{ totalKg: number; days: number; averagePerDayKg: number }>(
        `/v1/farms/${farmId}/milk/collections`,
      );
      assert.equal(res.body.totalKg, 155);
      assert.equal(res.body.days, 2, 'two calendar days, three milkings');
      assert.equal(res.body.averagePerDayKg, 77.5);
    });
  });

  test('the tank never crosses farms', async () => {
    await withServer(testApp(), async (url) => {
      const a = await milkingEwe(url, '+966501111111');
      const b = await milkingEwe(url, '+966502222222');
      await a.client.post(`/v1/farms/${a.farmId}/milk/collections`, {
        date: iso(new Date()),
        qtyKg: 99,
      });

      const res = await b.client.get<{ totalKg: number }>(`/v1/farms/${b.farmId}/milk/collections`);
      assert.equal(res.body.totalKg, 0);
    });
  });
});

describe('milk in the ewe scorecard', () => {
  test('a ewe who milks well but rears one lamb is not the one to cull', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await milkingEwe(url, '+966501111111', 60);

      // A second ewe with the same single lamb, but no milk recorded at all.
      const poor = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1002',
        species: 'sheep',
        sex: 'female',
      });
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId: poor.body.id,
        startDate: daysAgo(207),
      });
      await client.post(`/v1/farms/${farmId}/breeding/births`, {
        damId: poor.body.id,
        date: daysAgo(60),
        offspring: [{ sex: 'female', outcome: 'live' }],
      });

      await client.post(`/v1/farms/${farmId}/milk/test-days`, {
        date: daysAgo(30),
        entries: [{ animalId: damId, kg: 2.8 }],
      });

      const res = await client.get<{
        ewes: Array<{ tagNumber: string; bestLactationKg: number | null; lactations: number }>;
      }>(`/v1/farms/${farmId}/reports/ewes`);

      const milker = res.body.ewes.find((e) => e.tagNumber === '1001')!;
      assert.ok(milker.bestLactationKg && milker.bestLactationKg > 0, 'her litres are on the card');
      assert.equal(milker.lactations, 1);

      /**
       * Both ewes reared one lamb, so the ranking has to come from the milk. Compare them to each
       * other rather than to position zero — their own ewe lambs are on this list too, and a
       * two-month-old with no record of anything is not a culling decision.
       */
      const order = res.body.ewes.map((e) => e.tagNumber);
      assert.ok(
        order.indexOf('1002') < order.indexOf('1001'),
        `the ewe with no milk recorded ranks worse: ${order.join(', ')}`,
      );
    });
  });
});
