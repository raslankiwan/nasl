import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Membership } from '../models/membership.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface AnimalBody {
  id: string;
  tagNumber: string;
}
interface EweRow {
  tagNumber: string;
  lambings: number;
  lambsBorn: number;
  lambsLive: number;
  averageLitterSize: number | null;
  averageLambingIntervalDays: number | null;
  assistedLambings: number;
  cullSignals: string[];
}
interface Scorecard {
  ewes: EweRow[];
  cullCandidates: number;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function farmWithRam(url: string, phone = '+966501111111') {
  const { session, farmId } = await signInWithFarm(url, phone);
  const client = api(url, session.accessToken);
  const sire = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
    tagNumber: '3001',
    species: 'sheep',
    sex: 'male',
    classification: 'male',
    dateOfBirth: daysAgo(1200),
  });
  return { client, farmId, sireId: sire.body.id, userId: session.user.id };
}

async function addEwe(
  client: ReturnType<typeof api>,
  farmId: string,
  tagNumber: string,
  bornDaysAgo = 1200,
) {
  const res = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
    tagNumber,
    species: 'sheep',
    sex: 'female',
    classification: 'mother',
    dateOfBirth: daysAgo(bornDaysAgo),
  });
  return res.body.id;
}

/** Put a ewe through one complete cycle, ending weaned and ready to breed again. */
async function fullCycle(
  client: ReturnType<typeof api>,
  farmId: string,
  damId: string,
  sireId: string,
  opts: {
    matedDaysAgo: number;
    lambs: number;
    live?: number;
    difficulty?: number;
    weanKg?: number;
  },
) {
  const base = `/v1/farms/${farmId}/breeding`;
  const live = opts.live ?? opts.lambs;
  await client.post(`${base}/matings`, {
    damId,
    sireId,
    startDate: daysAgo(opts.matedDaysAgo),
  });
  const birth = await client.post<{ offspring: Array<{ animalId: string | null }> }>(
    `${base}/births`,
    {
      damId,
      date: daysAgo(opts.matedDaysAgo - 147),
      difficulty: opts.difficulty ?? 1,
      offspring: Array.from({ length: opts.lambs }, (_, i) => ({
        sex: i % 2 === 0 ? 'female' : 'male',
        outcome: i < live ? 'live' : 'stillborn',
        birthWeightKg: 4,
      })),
    },
  );
  const lambIds = birth.body.offspring.map((o) => o.animalId).filter(Boolean) as string[];
  const weightsKg = Object.fromEntries(lambIds.map((id) => [id, opts.weanKg ?? 20]));
  await client.post(`${base}/weanings`, {
    damId,
    date: daysAgo(opts.matedDaysAgo - 147 - 75),
    weightsKg,
  });
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

describe('the ewe scorecard', () => {
  test('a productive ewe reads back her whole career', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, sireId } = await farmWithRam(url);
      const dam = await addEwe(client, farmId, '1001');

      await fullCycle(client, farmId, dam, sireId, { matedDaysAgo: 700, lambs: 2, weanKg: 22 });
      await fullCycle(client, farmId, dam, sireId, { matedDaysAgo: 400, lambs: 2, weanKg: 24 });

      const res = await client.get<Scorecard>(`/v1/farms/${farmId}/reports/ewes`);
      const row = res.body.ewes.find((e) => e.tagNumber === '2')!;

      assert.equal(row.lambings, 2);
      assert.equal(row.lambsBorn, 4);
      assert.equal(row.lambsLive, 4);
      assert.equal(row.averageLitterSize, 2);
      assert.equal(row.averageLambingIntervalDays, 300, 'the gap between her two lambings');
      assert.deepEqual(row.cullSignals, [], 'she is earning her feed');
    });
  });

  test('a ewe who has never lambed is flagged once she is old enough to have', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farmWithRam(url);
      await addEwe(client, farmId, '1001', 1200); // over three, well past breeding age
      await addEwe(client, farmId, '1002', 200); // still a lamb herself

      const res = await client.get<Scorecard>(`/v1/farms/${farmId}/reports/ewes`);
      const old = res.body.ewes.find((e) => e.tagNumber === '2')!;
      const young = res.body.ewes.find((e) => e.tagNumber === '3')!;

      assert.ok(old.cullSignals.includes('neverLambed'));
      assert.deepEqual(young.cullSignals, [], 'a ewe lamb is not a cull candidate');
    });
  });

  test('a long gap since her last lambing is flagged', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, sireId } = await farmWithRam(url);
      const dam = await addEwe(client, farmId, '1001');
      await fullCycle(client, farmId, dam, sireId, { matedDaysAgo: 700, lambs: 1 });

      const res = await client.get<Scorecard>(`/v1/farms/${farmId}/reports/ewes`);
      const row = res.body.ewes.find((e) => e.tagNumber === '2')!;
      assert.ok(row.cullSignals.includes('longSinceLambing'));
    });
  });

  test('repeated difficult lambings are flagged', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, sireId } = await farmWithRam(url);
      const dam = await addEwe(client, farmId, '1001');

      await fullCycle(client, farmId, dam, sireId, { matedDaysAgo: 600, lambs: 1, difficulty: 3 });
      await fullCycle(client, farmId, dam, sireId, { matedDaysAgo: 300, lambs: 1, difficulty: 4 });

      const res = await client.get<Scorecard>(`/v1/farms/${farmId}/reports/ewes`);
      const row = res.body.ewes.find((e) => e.tagNumber === '2')!;
      assert.equal(row.assistedLambings, 2);
      assert.ok(row.cullSignals.includes('repeatedDifficulty'));
    });
  });

  test('losing most of a litter is flagged', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, sireId } = await farmWithRam(url);
      const dam = await addEwe(client, farmId, '1001');
      await fullCycle(client, farmId, dam, sireId, { matedDaysAgo: 300, lambs: 3, live: 1 });

      const res = await client.get<Scorecard>(`/v1/farms/${farmId}/reports/ewes`);
      const row = res.body.ewes.find((e) => e.tagNumber === '2')!;
      assert.ok(row.cullSignals.includes('poorSurvival'));
    });
  });

  test('the worst ewes come first, so the culling conversation starts at the top', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, sireId } = await farmWithRam(url);
      const good = await addEwe(client, farmId, '1001');
      await addEwe(client, farmId, '1002'); // never lambed, four years old

      await fullCycle(client, farmId, good, sireId, { matedDaysAgo: 400, lambs: 2 });
      await fullCycle(client, farmId, good, sireId, { matedDaysAgo: 180, lambs: 2 });

      const res = await client.get<Scorecard>(`/v1/farms/${farmId}/reports/ewes`);
      assert.equal(res.body.ewes[0]?.tagNumber, '3', 'the problem ewe leads');
      assert.equal(res.body.cullCandidates, 1);
    });
  });

  test('rams and sold animals are not on the scorecard', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farmWithRam(url);
      const sold = await addEwe(client, farmId, '1001');
      await client.post(`/v1/farms/${farmId}/animals/${sold}/status`, { status: 'sold' });

      const res = await client.get<Scorecard>(`/v1/farms/${farmId}/reports/ewes`);
      assert.equal(res.body.ewes.length, 0);
    });
  });

  test('a worker cannot see the scorecard — recording is not deciding', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, userId } = await farmWithRam(url);
      await Membership.updateOne({ farmId, userId }, { $set: { role: 'worker' } });

      const res = await client.get(`/v1/farms/${farmId}/reports/ewes`);
      assert.equal(res.status, 403);
    });
  });

  test('the scorecard never crosses farms', async () => {
    await withServer(testApp(), async (url) => {
      const a = await farmWithRam(url, '+966501111111');
      const b = await farmWithRam(url, '+966502222222');
      await addEwe(a.client, a.farmId, '1001');

      const res = await b.client.get<Scorecard>(`/v1/farms/${b.farmId}/reports/ewes`);
      assert.equal(res.body.ewes.length, 0);
    });
  });
});

describe('season summary', () => {
  test('the headline numbers come out of the births and weanings', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, sireId } = await farmWithRam(url);
      const a = await addEwe(client, farmId, '1001');
      const b = await addEwe(client, farmId, '1002');

      await fullCycle(client, farmId, a, sireId, { matedDaysAgo: 300, lambs: 2 });
      await fullCycle(client, farmId, b, sireId, { matedDaysAgo: 280, lambs: 3, live: 2 });

      const res = await client.get<{
        lambings: number;
        damsThatLambed: number;
        lambsBorn: number;
        lambsLive: number;
        stillborn: number;
        lambingPercentage: number;
        lambMortality: number;
        averageBirthWeightKg: number;
      }>(`/v1/farms/${farmId}/reports/season`);

      assert.equal(res.body.lambings, 2);
      assert.equal(res.body.damsThatLambed, 2);
      assert.equal(res.body.lambsBorn, 5);
      assert.equal(res.body.lambsLive, 4);
      assert.equal(res.body.stillborn, 1);
      assert.equal(res.body.lambingPercentage, 250, '5 lambs from 2 ewes');
      assert.equal(res.body.lambMortality, 20);
      assert.equal(res.body.averageBirthWeightKg, 4);
    });
  });

  test('an empty season reports nothing rather than dividing by zero', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farmWithRam(url);
      const res = await client.get<{
        lambingPercentage: number | null;
        lambMortality: number | null;
      }>(`/v1/farms/${farmId}/reports/season`);
      assert.equal(res.body.lambingPercentage, null);
      assert.equal(res.body.lambMortality, null);
    });
  });
});

describe('flock composition', () => {
  test('the flock is broken down by sex, breed and age', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farmWithRam(url);
      await client.post(`/v1/farms/${farmId}/animals/bulk`, {
        animals: [
          {
            tagNumber: '1001',
            species: 'sheep',
            sex: 'female',
            breedId: 'awassi',
            dateOfBirth: daysAgo(1200),
          },
          {
            tagNumber: '1002',
            species: 'sheep',
            sex: 'female',
            breedId: 'assaf',
            dateOfBirth: daysAgo(100),
          },
          {
            tagNumber: '5001',
            species: 'goat',
            sex: 'female',
            breedId: 'shami',
            dateOfBirth: daysAgo(1900),
          },
        ],
      });

      const res = await client.get<{
        total: number;
        bySex: Record<string, number>;
        bySpecies: Record<string, number>;
        byBreed: Record<string, number>;
        byAgeBand: Record<string, number>;
      }>(`/v1/farms/${farmId}/reports/composition`);

      assert.equal(res.body.total, 4, 'three females plus the ram');
      assert.equal(res.body.bySex.female, 3);
      assert.equal(res.body.bySpecies.goat, 1);
      assert.equal(res.body.byBreed.awassi, 1);
      assert.equal(res.body.byAgeBand.lamb, 1, 'the hundred-day-old');
      assert.equal(res.body.byAgeBand.mature, 2, 'the adult ewe and ram are both mature');
      assert.equal(res.body.byAgeBand.aged, 1, 'past five years');
    });
  });
});

describe('treatment register', () => {
  test('every medicine in the period is listed with its withdrawal dates', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farmWithRam(url);
      const { VetProduct } = await import('../models/vetProduct.model.ts');
      const product = await VetProduct.create({
        nameAr: 'أوكسي تتراسيكلين',
        nameEn: 'Oxytetracycline',
        kind: 'antibiotic',
        withdrawalMeatDays: 28,
        withdrawalMilkDays: 7,
        source: 'datasheet',
      });
      const ewe = await addEwe(client, farmId, '1001');

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [ewe],
        date: daysAgo(10),
        type: 'treatment',
        productId: product._id,
        batchNo: 'LOT-42',
        administeredBy: 'البيطري',
      });

      const res = await client.get<{
        entries: Array<{
          tagNumber: string;
          product: string;
          batchNo: string;
          administeredBy: string;
          withholdMilkUntil: string;
        }>;
      }>(`/v1/farms/${farmId}/reports/treatments`);

      assert.equal(res.body.entries.length, 1);
      assert.equal(res.body.entries[0]?.tagNumber, '2');
      assert.equal(res.body.entries[0]?.batchNo, 'LOT-42');
      assert.equal(res.body.entries[0]?.administeredBy, 'البيطري');
      assert.ok(res.body.entries[0]?.withholdMilkUntil, 'the register carries the hold');
    });
  });
});
