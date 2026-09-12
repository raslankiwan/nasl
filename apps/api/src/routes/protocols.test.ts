import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { Farm } from '../models/farm.model.ts';
import { Membership } from '../models/membership.model.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface ProtocolSettings {
  disclaimer: { en: string; ar: string };
  protocols: Array<{
    id: string;
    enabled: boolean;
    deliveredBy: string;
    source: { en: string; ar: string };
    steps: Array<{ id: string }>;
  }>;
}
interface TaskGroups {
  total: number;
  disclaimer: { en: string; ar: string };
  groups: Array<{
    stepId: string;
    protocolId: string;
    deliveredBy: string;
    dueOn: string;
    due: number;
    overdue: number;
    upcoming: number;
    animals: Array<{ animalId: string; tagNumber: string }>;
  }>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

before(async () => {
  await startTestMongo();
});
after(async () => {
  await stopTestMongo();
});
beforeEach(async () => {
  await clearDatabase();
});

describe('which protocols a farm runs', () => {
  test('a new farm starts on the endemic-region defaults, with worm dosing off', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+970591000001');
      const client = api(url, session.accessToken);

      const res = await client.get<ProtocolSettings>(`/v1/farms/${farmId}/health/protocols`);
      const on = res.body.protocols
        .filter((p) => p.enabled)
        .map((p) => p.id)
        .sort();
      assert.deepEqual(on, ['brucellosis', 'clostridial', 'fmd', 'ppr', 'sheep-pox']);
      assert.equal(res.body.protocols.find((p) => p.id === 'parasites')!.enabled, false);
    });
  });

  test('the disclaimer and the sources travel with the library', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+970591000002');
      const client = api(url, session.accessToken);

      const res = await client.get<ProtocolSettings>(`/v1/farms/${farmId}/health/protocols`);
      assert.ok(res.body.disclaimer.ar.length > 0);
      assert.ok(res.body.disclaimer.en.includes('veterinarian'));
      for (const protocol of res.body.protocols) {
        assert.ok(protocol.source.en.length > 20, protocol.id);
        assert.ok(protocol.source.ar.length > 20, protocol.id);
      }
    });
  });

  test('Rev-1 is presented as something the veterinary service delivers', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+970591000003');
      const client = api(url, session.accessToken);

      const res = await client.get<ProtocolSettings>(`/v1/farms/${farmId}/health/protocols`);
      assert.equal(res.body.protocols.find((p) => p.id === 'brucellosis')!.deliveredBy, 'official');
    });
  });

  test('a farm that predates the field runs the defaults, not nothing', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+970591000014');
      const client = api(url, session.accessToken);

      // Exactly what an existing farm looks like: the field was never written. A lean read does
      // not apply schema defaults, so this silently meant "no vaccinations at all".
      await Farm.updateOne({ _id: farmId }, { $unset: { protocolIds: '' } });

      const res = await client.get<ProtocolSettings>(`/v1/farms/${farmId}/health/protocols`);
      assert.ok(res.body.protocols.some((p) => p.id === 'clostridial' && p.enabled));
    });
  });

  test('switching everything off is a choice, and is kept', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+970591000015');
      const client = api(url, session.accessToken);

      await client.put(`/v1/farms/${farmId}/health/protocols`, { protocolIds: [] });

      const res = await client.get<ProtocolSettings>(`/v1/farms/${farmId}/health/protocols`);
      assert.ok(!res.body.protocols.some((p) => p.enabled));
    });
  });

  test('a farm can switch one off, and an invented id is refused', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+970591000004');
      const client = api(url, session.accessToken);

      const ok = await client.put<{ protocolIds: string[] }>(
        `/v1/farms/${farmId}/health/protocols`,
        { protocolIds: ['clostridial', 'parasites'] },
      );
      assert.deepEqual(ok.body.protocolIds, ['clostridial', 'parasites']);

      const bad = await client.put(`/v1/farms/${farmId}/health/protocols`, {
        protocolIds: ['clostridial', 'vitamin-vibes'],
      });
      assert.equal(bad.status, 400);
    });
  });

  test('a hired worker cannot switch off a booster reminder, but can still see the schedule', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+970591000005');
      const client = api(url, session.accessToken);
      await Membership.updateOne({ farmId, userId: session.user.id }, { $set: { role: 'worker' } });

      const denied = await client.put(`/v1/farms/${farmId}/health/protocols`, { protocolIds: [] });
      assert.equal(denied.status, 403);

      const allowed = await client.get(`/v1/farms/${farmId}/health/protocols`);
      assert.equal(allowed.status, 200);
    });
  });
});

describe('what the flock is owed', () => {
  async function flockWithLamb(url: string, phone: string) {
    const { session, farmId } = await signInWithFarm(url, phone);
    const client = api(url, session.accessToken);
    const lamb = await client.post<{ id: string }>(`/v1/farms/${farmId}/animals`, {
      tagNumber: '2001',
      species: 'sheep',
      sex: 'male',
      dateOfBirth: daysAgo(56),
    });
    return { client, farmId, lambId: lamb.body.id };
  }

  test('a lamb at eight weeks is due its first clostridial dose', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, lambId } = await flockWithLamb(url, '+970591000007');

      const res = await client.get<TaskGroups>(`/v1/farms/${farmId}/health/protocol-tasks`);
      const group = res.body.groups.find((g) => g.stepId === 'clostridial-lamb-1')!;
      assert.ok(group, 'the first dose is on the list');
      assert.equal(group.due, 1);
      assert.equal(group.deliveredBy, 'farm');
      assert.deepEqual(
        group.animals.map((a) => a.animalId),
        [lambId],
      );
    });
  });

  test('tasks are grouped by dose, not listed once per animal', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+970591000008');
      const client = api(url, session.accessToken);

      for (const tag of ['3001', '3002', '3003']) {
        await client.post(`/v1/farms/${farmId}/animals`, {
          tagNumber: tag,
          species: 'sheep',
          sex: 'male',
          dateOfBirth: daysAgo(56),
        });
      }

      const res = await client.get<TaskGroups>(`/v1/farms/${farmId}/health/protocol-tasks`);
      const group = res.body.groups.find((g) => g.stepId === 'clostridial-lamb-1')!;
      assert.equal(group.animals.length, 3);
      assert.equal(group.due, 3);
    });
  });

  test('recording the dose against the step closes the task and schedules the next', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, lambId } = await flockWithLamb(url, '+970591000009');

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [lambId],
        date: daysAgo(0),
        type: 'vaccination',
        protocolStepId: 'clostridial-lamb-1',
        administeredBy: 'Abu Khaled',
      });

      const res = await client.get<TaskGroups>(`/v1/farms/${farmId}/health/protocol-tasks`);
      assert.ok(!res.body.groups.some((g) => g.stepId === 'clostridial-lamb-1'));

      const second = res.body.groups.find((g) => g.stepId === 'clostridial-lamb-2')!;
      assert.ok(second, 'the second dose is now scheduled from the day the first was given');
      assert.equal(second.upcoming, 1);
    });
  });

  test('a dose recorded without naming a step does not close anything', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, lambId } = await flockWithLamb(url, '+970591000010');

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [lambId],
        date: daysAgo(0),
        type: 'vaccination',
        administeredBy: 'Abu Khaled',
      });

      const res = await client.get<TaskGroups>(`/v1/farms/${farmId}/health/protocol-tasks`);
      assert.ok(res.body.groups.some((g) => g.stepId === 'clostridial-lamb-1'));
    });
  });

  test('switching every protocol off empties the list', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await flockWithLamb(url, '+970591000011');

      await client.put(`/v1/farms/${farmId}/health/protocols`, { protocolIds: [] });

      const res = await client.get<TaskGroups>(`/v1/farms/${farmId}/health/protocol-tasks`);
      assert.equal(res.body.total, 0);
      assert.equal(res.body.groups.length, 0);
    });
  });

  test('one farm never sees another farm’s work', async () => {
    await withServer(testApp(), async (url) => {
      await flockWithLamb(url, '+970591000012');
      const { client, farmId } = await flockWithLamb(url, '+970591000013');

      const res = await client.get<TaskGroups>(`/v1/farms/${farmId}/health/protocol-tasks`);
      const group = res.body.groups.find((g) => g.stepId === 'clostridial-lamb-1')!;
      assert.equal(group.animals.length, 1);
    });
  });
});
