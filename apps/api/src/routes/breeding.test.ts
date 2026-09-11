import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Animal } from '../models/animal.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface AnimalBody {
  id: string;
  tagNumber: string;
  repro: { state: string; dueDate: string | null } | null;
}
interface MatingBody {
  id: string;
  expectedDueDate: string;
  sireUncertain: boolean;
}
interface BirthBody {
  id: string;
  birthType: string;
  offspring: Array<{ animalId: string | null; sex: string; outcome: string }>;
}
interface ErrorBody {
  error: { code: string; message: string };
}

const ewe = (tagNumber: string, extra: Record<string, unknown> = {}) => ({
  tagNumber,
  species: 'sheep',
  sex: 'female',
  ...extra,
});
const ram = (tagNumber: string) => ({ tagNumber, species: 'sheep', sex: 'male' });

/** A farm with one ewe and one ram, ready to breed. */
async function flock(url: string, phone = '+966501111111') {
  const { session, farmId } = await signInWithFarm(url, phone);
  const client = api(url, session.accessToken);
  const dam = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, ewe('1001'));
  const sire = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, ram('3001'));
  return { client, farmId, damId: dam.body.id, sireId: sire.body.id };
}

const state = async (
  client: ReturnType<typeof api>,
  farmId: string,
  animalId: string,
): Promise<string | null> =>
  (await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animalId}`)).body.repro?.state ??
  null;

before(async () => {
  await startTestMongo();
});
after(async () => {
  await stopTestMongo();
});
beforeEach(async () => {
  await clearDatabase();
});

describe('mating', () => {
  test('a mating sets the due date 147 days out and moves her to mated', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);

      const mating = await client.post<MatingBody>(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        sireId,
        startDate: '2026-01-10',
      });

      assert.equal(mating.status, 201);
      assert.equal(mating.body.expectedDueDate, '2026-06-06');
      assert.equal(mating.body.sireUncertain, false);
      assert.equal(await state(client, farmId, damId), 'mated');
    });
  });

  test('a group mating with no named ram flags paternity as uncertain', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await flock(url);
      const group = await client.post<{ id: string }>(`/v1/farms/${farmId}/groups`, {
        name: 'مجموعة التلقيح',
        type: 'breeding',
      });

      const mating = await client.post<MatingBody>(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        breedingGroupId: group.body.id,
        startDate: '2026-01-10',
      });
      assert.equal(mating.body.sireUncertain, true);
    });
  });

  test('a male cannot be recorded as a dam, and a female cannot be a sire', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);

      const asDam = await client.post<ErrorBody>(`/v1/farms/${farmId}/breeding/matings`, {
        damId: sireId,
        startDate: '2026-01-10',
      });
      assert.equal(asDam.status, 400);
      assert.match(asDam.body.error.message, /female carries a pregnancy/);

      const asSire = await client.post<ErrorBody>(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        sireId: damId,
        startDate: '2026-01-10',
      });
      assert.equal(asSire.status, 400);
      assert.match(asSire.body.error.message, /sire must be male/);
    });
  });

  test('an already-mated ewe cannot be mated again', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      const body = { damId, sireId, startDate: '2026-01-10' };

      assert.equal((await client.post(`/v1/farms/${farmId}/breeding/matings`, body)).status, 201);
      const again = await client.post<ErrorBody>(`/v1/farms/${farmId}/breeding/matings`, body);
      assert.equal(again.status, 409);
      assert.match(again.body.error.message, /Cannot apply "mating"/);
    });
  });
});

describe('pregnancy checks', () => {
  test('a positive scan confirms pregnancy and keeps the due date', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        sireId,
        startDate: '2026-01-10',
      });

      await client.post(`/v1/farms/${farmId}/breeding/pregnancy-checks`, {
        damId,
        date: '2026-02-25',
        method: 'ultrasound',
        result: 'pregnant',
        fetusCount: 2,
      });

      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${damId}`);
      assert.equal(animal.body.repro?.state, 'pregnant');
      assert.equal(animal.body.repro?.dueDate, '2026-06-06');
    });
  });

  test('a negative scan returns her to open and clears the due date', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        sireId,
        startDate: '2026-01-10',
      });
      await client.post(`/v1/farms/${farmId}/breeding/pregnancy-checks`, {
        damId,
        date: '2026-02-25',
        method: 'ultrasound',
        result: 'open',
      });

      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${damId}`);
      assert.equal(animal.body.repro?.state, 'open');
      assert.equal(animal.body.repro?.dueDate, null);
    });
  });

  test('only an ultrasound may report a foetus count', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        sireId,
        startDate: '2026-01-10',
      });

      const res = await client.post<ErrorBody>(`/v1/farms/${farmId}/breeding/pregnancy-checks`, {
        damId,
        date: '2026-02-25',
        method: 'palpation',
        result: 'pregnant',
        fetusCount: 2,
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /ultrasound/);
    });
  });

  test('a check with no mating on record is refused', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await flock(url);
      const res = await client.post<ErrorBody>(`/v1/farms/${farmId}/breeding/pregnancy-checks`, {
        damId,
        date: '2026-02-25',
        method: 'ultrasound',
        result: 'pregnant',
      });
      assert.equal(res.status, 409);
    });
  });
});

describe('lambing', () => {
  test('twins are created as animals with dam and sire already linked', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        sireId,
        startDate: '2026-01-10',
      });

      const birth = await client.post<BirthBody>(`/v1/farms/${farmId}/breeding/births`, {
        damId,
        date: '2026-06-06',
        offspring: [
          { sex: 'female', outcome: 'live', birthWeightKg: 4.2, tagNumber: '1101' },
          { sex: 'male', outcome: 'live', birthWeightKg: 4.5 },
        ],
      });

      assert.equal(birth.status, 201);
      assert.equal(birth.body.birthType, 'twin');

      const lambs = await Animal.find({ farmId, damId }).sort({ tagNumber: 1 }).lean();
      assert.equal(lambs.length, 2);
      assert.ok(
        lambs.every((l) => l.sireId === sireId),
        'paternity comes from the mating',
      );
      assert.equal(lambs[0]?.tagNumber, '1001-1', 'an untagged lamb gets a provisional tag');
      assert.equal(lambs[1]?.tagNumber, '1101');

      assert.equal(await state(client, farmId, damId), 'nursing');
    });
  });

  test('a stillborn lamb is recorded on the birth but never joins the flock', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        sireId,
        startDate: '2026-01-10',
      });

      const birth = await client.post<BirthBody>(`/v1/farms/${farmId}/breeding/births`, {
        damId,
        date: '2026-06-06',
        offspring: [
          { sex: 'female', outcome: 'live' },
          { sex: 'male', outcome: 'stillborn' },
        ],
      });

      assert.equal(birth.body.offspring.filter((o) => o.animalId).length, 1);
      assert.equal(await Animal.countDocuments({ farmId, damId }), 1);
    });
  });

  test('a dam that loses the whole litter is not nursing', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        sireId,
        startDate: '2026-01-10',
      });
      await client.post(`/v1/farms/${farmId}/breeding/births`, {
        damId,
        date: '2026-06-06',
        offspring: [{ sex: 'female', outcome: 'stillborn' }],
      });

      assert.equal(await state(client, farmId, damId), 'lambed');
    });
  });

  test('a birth is accepted from mated — plenty of ewes are never scanned', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        sireId,
        startDate: '2026-01-10',
      });

      const birth = await client.post(`/v1/farms/${farmId}/breeding/births`, {
        damId,
        date: '2026-06-06',
        offspring: [{ sex: 'female', outcome: 'live' }],
      });
      assert.equal(birth.status, 201);
    });
  });

  test('a birth with no pregnancy on record is refused', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId } = await flock(url);
      const res = await client.post<ErrorBody>(`/v1/farms/${farmId}/breeding/births`, {
        damId,
        date: '2026-06-06',
        offspring: [{ sex: 'female', outcome: 'live' }],
      });
      assert.equal(res.status, 409);
    });
  });
});

describe('the full cycle', () => {
  test('mating through weaning returns her to a serviceable state', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      const base = `/v1/farms/${farmId}/breeding`;

      await client.post(`${base}/matings`, { damId, sireId, startDate: '2026-01-10' });
      await client.post(`${base}/pregnancy-checks`, {
        damId,
        date: '2026-02-25',
        method: 'ultrasound',
        result: 'pregnant',
        fetusCount: 1,
      });
      await client.post(`${base}/births`, {
        damId,
        date: '2026-06-06',
        offspring: [{ sex: 'female', outcome: 'live', birthWeightKg: 4.1 }],
      });
      assert.equal(await state(client, farmId, damId), 'nursing');

      const weaning = await client.post(`${base}/weanings`, { damId, date: '2026-08-15' });
      assert.equal(weaning.status, 201);
      assert.equal(await state(client, farmId, damId), 'weaned');

      // Weaned is serviceable: she can go to the ram again.
      const second = await client.post(`${base}/matings`, {
        damId,
        sireId,
        startDate: '2026-09-01',
      });
      assert.equal(second.status, 201);
    });
  });

  test('an abortion returns her to a serviceable state and is kept on her record', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      const base = `/v1/farms/${farmId}/breeding`;

      await client.post(`${base}/matings`, { damId, sireId, startDate: '2026-01-10' });
      await client.post(`${base}/abortions`, {
        damId,
        date: '2026-03-01',
        suspectedCause: 'brucellosis suspected',
      });

      assert.equal(await state(client, farmId, damId), 'aborted');
      assert.equal(
        (await client.post(`${base}/matings`, { damId, sireId, startDate: '2026-04-01' })).status,
        201,
      );
    });
  });

  test('her history reads back as matings, checks and births', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      const base = `/v1/farms/${farmId}/breeding`;

      await client.post(`${base}/matings`, { damId, sireId, startDate: '2026-01-10' });
      await client.post(`${base}/pregnancy-checks`, {
        damId,
        date: '2026-02-25',
        method: 'ultrasound',
        result: 'pregnant',
        fetusCount: 2,
      });
      await client.post(`${base}/births`, {
        damId,
        date: '2026-06-06',
        assisted: true,
        difficulty: 3,
        offspring: [
          { sex: 'female', outcome: 'live' },
          { sex: 'male', outcome: 'died24h' },
        ],
      });

      const history = await client.get<{
        matings: unknown[];
        pregnancyChecks: Array<{ fetusCount: number }>;
        births: Array<{ born: number; live: number; difficulty: number; assisted: boolean }>;
      }>(`${base}/history/${damId}`);

      assert.equal(history.body.matings.length, 1);
      assert.equal(history.body.pregnancyChecks[0]?.fetusCount, 2);
      assert.equal(history.body.births[0]?.born, 2);
      assert.equal(history.body.births[0]?.live, 1);
      assert.equal(history.body.births[0]?.difficulty, 3);
      assert.equal(history.body.births[0]?.assisted, true);
    });
  });
});

describe('alerts', () => {
  test('a ewe inside the drop-pen window appears as due, and past it as overdue', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      const base = `/v1/farms/${farmId}/breeding`;

      // Mate her so she is due in ten days — inside the fourteen-day window.
      const mated = new Date(Date.now() - (147 - 10) * 86_400_000).toISOString().slice(0, 10);
      await client.post(`${base}/matings`, { damId, sireId, startDate: mated });

      const due = await client.get<{
        dueSoon: Array<{ tagNumber: string; days: number }>;
        overdue: unknown[];
      }>(`${base}/alerts`);
      assert.equal(due.body.dueSoon.length, 1);
      assert.equal(due.body.dueSoon[0]?.tagNumber, '1001');
      assert.ok(due.body.dueSoon[0]!.days <= 14 && due.body.dueSoon[0]!.days >= 0);
      assert.equal(due.body.overdue.length, 0);
    });
  });

  test('a ewe past her date appears as overdue', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      const base = `/v1/farms/${farmId}/breeding`;

      const mated = new Date(Date.now() - 160 * 86_400_000).toISOString().slice(0, 10);
      await client.post(`${base}/matings`, { damId, sireId, startDate: mated });

      const res = await client.get<{ overdue: Array<{ days: number }>; dueSoon: unknown[] }>(
        `${base}/alerts`,
      );
      assert.equal(res.body.overdue.length, 1);
      assert.ok(res.body.overdue[0]!.days < 0);
      assert.equal(res.body.dueSoon.length, 0);
    });
  });

  test('a ewe mated yesterday raises nothing yet', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      const mated = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await client.post(`/v1/farms/${farmId}/breeding/matings`, {
        damId,
        sireId,
        startDate: mated,
      });

      const res = await client.get<{ dueSoon: unknown[]; overdue: unknown[] }>(
        `/v1/farms/${farmId}/breeding/alerts`,
      );
      assert.equal(res.body.dueSoon.length, 0);
      assert.equal(res.body.overdue.length, 0);
    });
  });

  test('alerts never cross farms', async () => {
    await withServer(testApp(), async (url) => {
      const a = await flock(url, '+966501111111');
      const b = await flock(url, '+966502222222');

      const mated = new Date(Date.now() - 140 * 86_400_000).toISOString().slice(0, 10);
      await a.client.post(`/v1/farms/${a.farmId}/breeding/matings`, {
        damId: a.damId,
        sireId: a.sireId,
        startDate: mated,
      });

      const res = await b.client.get<{ dueSoon: unknown[] }>(
        `/v1/farms/${b.farmId}/breeding/alerts`,
      );
      assert.equal(res.body.dueSoon.length, 0);
    });
  });
});

describe('idempotency', () => {
  test('re-sending the same event with the same id does not duplicate it', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, damId, sireId } = await flock(url);
      const id = randomUUID();
      const body = { id, damId, sireId, startDate: '2026-01-10' };

      const first = await client.post<MatingBody>(`/v1/farms/${farmId}/breeding/matings`, body);
      assert.equal(first.status, 201);
      assert.equal(first.body.id, id, 'the device keeps the identity it minted');

      // The same request again — which is exactly what a retry after a dropped connection sends.
      const again = await client.post<ErrorBody>(`/v1/farms/${farmId}/breeding/matings`, body);
      assert.equal(again.status, 409, 'she is already mated, so the second is refused');

      const history = await client.get<{ matings: unknown[] }>(
        `/v1/farms/${farmId}/breeding/history/${damId}`,
      );
      assert.equal(history.body.matings.length, 1, 'and no duplicate was written');
    });
  });
});
