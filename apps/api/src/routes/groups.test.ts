import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface GroupBody {
  id: string;
  name: string;
  type: string;
  headCount?: number;
}
interface AnimalBody {
  id: string;
  tagNumber: string;
  currentGroupId: string | null;
}
interface ErrorBody {
  error: { code: string; message: string };
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

describe('pens', () => {
  test('a pen is created and listed with its head count', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const pen = await client.post<GroupBody>(`/v1/farms/${farmId}/groups`, {
        name: 'الحظيرة الشمالية',
        type: 'pen',
      });
      assert.equal(pen.status, 201);
      assert.equal(pen.body.headCount, 0);

      const list = await client.get<{ groups: GroupBody[] }>(`/v1/farms/${farmId}/groups`);
      assert.equal(list.body.groups.length, 1);
      assert.equal(list.body.groups[0]?.name, 'الحظيرة الشمالية');
    });
  });

  test('two pens on one farm cannot share a name', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      await client.post(`/v1/farms/${farmId}/groups`, { name: 'الحظيرة الشمالية' });
      const again = await client.post<ErrorBody>(`/v1/farms/${farmId}/groups`, {
        name: 'الحظيرة الشمالية',
      });
      assert.equal(again.status, 409);
    });
  });

  test('an occupied pen cannot be deleted', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const pen = await client.post<GroupBody>(`/v1/farms/${farmId}/groups`, { name: 'الشمالية' });
      const animal = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });
      await client.post(`/v1/farms/${farmId}/groups/move`, {
        animalIds: [animal.body.id],
        toGroupId: pen.body.id,
      });

      const res = await fetch(`${url}/v1/farms/${farmId}/groups/${pen.body.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error.message, /still holds 1 head/);
    });
  });
});

describe('movements', () => {
  test('moving animals updates the pen and writes a history entry', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const north = await client.post<GroupBody>(`/v1/farms/${farmId}/groups`, {
        name: 'الشمالية',
      });
      const drop = await client.post<GroupBody>(`/v1/farms/${farmId}/groups`, {
        name: 'حظيرة الولادة',
        type: 'drop',
      });
      const bulk = await client.post<{ created: AnimalBody[] }>(
        `/v1/farms/${farmId}/animals/bulk`,
        {
          animals: [
            { tagNumber: '1001', species: 'sheep', sex: 'female' },
            { tagNumber: '1002', species: 'sheep', sex: 'female' },
          ],
        },
      );
      const ids = bulk.body.created.map((a) => a.id);

      await client.post(`/v1/farms/${farmId}/groups/move`, {
        animalIds: ids,
        toGroupId: north.body.id,
      });
      const second = await client.post<{ moved: number }>(`/v1/farms/${farmId}/groups/move`, {
        animalIds: [ids[0]],
        toGroupId: drop.body.id,
        reason: 'قريبة الولادة',
      });
      assert.equal(second.body.moved, 1);

      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${ids[0]}`);
      assert.equal(animal.body.currentGroupId, drop.body.id);

      const history = await client.get<{
        movements: Array<{ fromGroupId: string | null; toGroupId: string | null; reason: string }>;
      }>(`/v1/farms/${farmId}/animals/${ids[0]}/movements`);
      assert.equal(history.body.movements.length, 2);
      assert.equal(history.body.movements[0]?.toGroupId, drop.body.id);
      assert.equal(history.body.movements[0]?.fromGroupId, north.body.id);
      assert.equal(history.body.movements[1]?.fromGroupId, null, 'the first move had no origin');
    });
  });

  test('moving an animal to the pen it is already in records nothing', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const pen = await client.post<GroupBody>(`/v1/farms/${farmId}/groups`, { name: 'الشمالية' });
      const animal = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });
      const body = { animalIds: [animal.body.id], toGroupId: pen.body.id };

      assert.equal(
        (await client.post<{ moved: number }>(`/v1/farms/${farmId}/groups/move`, body)).body.moved,
        1,
      );
      assert.equal(
        (await client.post<{ moved: number }>(`/v1/farms/${farmId}/groups/move`, body)).body.moved,
        0,
      );
    });
  });

  test('a pen from another farm is refused as a destination', async () => {
    await withServer(testApp(), async (url) => {
      const a = await signInWithFarm(url, '+966501111111');
      const b = await signInWithFarm(url, '+966502222222');

      const foreignPen = await api(url, b.session.accessToken).post<GroupBody>(
        `/v1/farms/${b.farmId}/groups`,
        { name: 'حظيرة الجار' },
      );
      const animal = await api(url, a.session.accessToken).post<AnimalBody>(
        `/v1/farms/${a.farmId}/animals`,
        { tagNumber: '1001', species: 'sheep', sex: 'female' },
      );

      const res = await api(url, a.session.accessToken).post<ErrorBody>(
        `/v1/farms/${a.farmId}/groups/move`,
        { animalIds: [animal.body.id], toGroupId: foreignPen.body.id },
      );
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /not on this farm/);
    });
  });
});

describe('reference data', () => {
  test('the breed and disease libraries are served to signed-in clients', async () => {
    await withServer(testApp(), async (url) => {
      const { session } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const breeds = await client.get<{ breeds: Array<{ id: string; nameAr: string }> }>(
        '/v1/reference/breeds',
      );
      assert.equal(breeds.status, 200);
      // Awassi leads the list: it is the indigenous Levantine breed and the launch market.
      assert.equal(breeds.body.breeds[0]?.id, 'awassi');
      assert.ok(breeds.body.breeds.some((b) => b.id === 'assaf' && b.nameAr === 'عساف'));

      const diseases = await client.get<{ diseases: Array<{ id: string }> }>(
        '/v1/reference/diseases',
      );
      assert.ok(diseases.body.diseases.some((d) => d.id === 'ppr'));
    });
  });

  test('reference data requires a session', async () => {
    await withServer(testApp(), async (url) => {
      assert.equal((await api(url).get('/v1/reference/breeds')).status, 401);
    });
  });
});
