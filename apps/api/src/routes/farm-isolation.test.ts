import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestMongo, stopTestMongo, clearDatabase } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';
import { Animal } from '../models/animal.model.ts';
import { Weaning } from '../models/breeding.model.ts';
import { BreedingService } from '../services/breeding.service.ts';

before(() => startTestMongo(true));
after(stopTestMongo);
beforeEach(clearDatabase);

interface Row {
  id: string;
  tagNumber: string;
  classLabel: string;
  damId: string | null;
  sireId: string | null;
  currentGroupId: string | null;
  status: string;
  lastWeightKg: number | null;
}
const adult = { species: 'sheep', sex: 'female', dateOfBirth: '2020-01-01' };
const child = { species: 'sheep', sex: 'female', dateOfBirth: '2025-01-01' };

/** Even an owner who can access both farms must not mix their animal identities. */
async function twoFarms(url: string) {
  const first = await signInWithFarm(url, 'twofarmowner');
  const client = api(url, first.session.accessToken);
  const second = await client.post<{ id: string }>('/v1/farms', { name: 'Second farm' });
  assert.equal(second.status, 201);
  const farms = [];
  for (const farmId of [first.farmId, second.body.id]) {
    const base = `/v1/farms/${farmId}`;
    const mother = await client.post<Row>(`${base}/animals`, {
      ...adult,
      classification: 'mother',
    });
    const male = await client.post<Row>(`${base}/animals`, {
      ...adult,
      sex: 'male',
      classification: 'male',
    });
    const daughter = await client.post<Row>(`${base}/animals`, {
      ...child,
      damId: mother.body.id,
      sireId: male.body.id,
    });
    const pen = await client.post<{ id: string }>(`${base}/groups`, {
      name: 'Breeding pen',
      type: 'breeding',
      ramId: male.body.id,
    });
    assert.ok([mother, male, daughter, pen].every((res) => res.status === 201));
    farms.push({
      farmId,
      base,
      mother: mother.body,
      male: male.body,
      child: daughter.body,
      pen: pen.body,
    });
  }
  return { client, a: farms[0]!, b: farms[1]!, userId: first.session.user.id };
}

test('each farm independently owns its number sequence and class labels across sheep and goats', async () => {
  await withServer(testApp(), async (url) => {
    const { client, a, b } = await twoFarms(url);
    for (const farm of [a, b]) {
      assert.deepEqual(
        [farm.mother, farm.male, farm.child].map((row) => row.tagNumber),
        ['1', '2', '3'],
      );
      assert.deepEqual(
        [farm.mother, farm.male, farm.child].map((row) => row.classLabel),
        ['M1', 'R1', 'C1'],
      );
    }
    const added = await Promise.all(
      [a, b].flatMap((farm) =>
        Array.from({ length: 6 }, (_, index) =>
          client.post<Row>(`${farm.base}/animals`, {
            ...child,
            species: index % 2 ? 'sheep' : 'goat',
            classification: index % 3 === 0 ? 'mother' : 'child',
          }),
        ),
      ),
    );
    assert.ok(added.every((row) => row.status === 201));
    for (const farm of [a, b]) {
      const list = await client.get<{ animals: Row[] }>(`${farm.base}/animals`);
      assert.equal(list.body.animals.length, 9);
      assert.equal(new Set(list.body.animals.map((row) => row.tagNumber)).size, 9);
      assert.equal(new Set(list.body.animals.map((row) => row.classLabel)).size, 9);
    }
    // The database itself must refuse duplicates even if an application check is bypassed.
    await assert.rejects(() => Animal.create({ farmId: a.farmId, ...child, tagNumber: '1' }), {
      code: 11000,
    });
    await assert.rejects(
      () => Animal.create({ farmId: a.farmId, ...child, tagNumber: '999', activeClassLabel: 'M1' }),
      { code: 11000 },
    );
  });
});

test('foreign parents, animal reads, changes, breeding and sales are rejected even for a shared owner', async () => {
  await withServer(testApp(), async (url) => {
    const { client, a, b } = await twoFarms(url);
    for (const [field, parent] of [
      ['damId', b.mother],
      ['sireId', b.male],
    ] as const) {
      assert.equal(
        (await client.post(`${a.base}/animals`, { ...child, [field]: parent.id })).status,
        400,
      );
      assert.equal(
        (await client.patch(`${a.base}/animals/${a.child.id}`, { [field]: parent.id })).status,
        400,
      );
    }
    for (const suffix of ['', '/pedigree', '/offspring']) {
      assert.equal((await client.get(`${a.base}/animals/${b.mother.id}${suffix}`)).status, 404);
    }
    assert.equal(
      (await client.patch(`${a.base}/animals/${b.child.id}`, { name: 'wrong farm' })).status,
      404,
    );
    assert.equal(
      (await client.post(`${a.base}/animals/${b.child.id}/status`, { status: 'dead' })).status,
      404,
    );
    assert.equal(
      (
        await client.post(`${a.base}/animals/${b.child.id}/promote`, {
          id: randomUUID(),
          classification: 'mother',
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await client.post(`${a.base}/breeding/matings`, {
          damId: a.mother.id,
          sireId: b.male.id,
          startDate: '2026-01-01',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await client.post(`${a.base}/breeding/births`, {
          damId: b.mother.id,
          date: '2026-06-01',
          offspring: [{ sex: 'female', outcome: 'live' }],
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await client.post(`${a.base}/finance/sales`, {
          animalIds: [a.child.id, b.child.id],
          amount: 100,
          date: '2026-06-01',
        })
      ).status,
      400,
    );
    assert.equal((await client.get<Row>(`${b.base}/animals/${b.child.id}`)).body.status, 'active');
    assert.equal(
      (await client.get<Row>(`${a.base}/animals/${a.child.id}`)).body.damId,
      a.mother.id,
    );
  });
});

test('animal pens, breeding groups and assigned rams must belong to the same farm', async () => {
  await withServer(testApp(), async (url) => {
    const { client, a, b } = await twoFarms(url);
    assert.equal(
      (await client.post(`${a.base}/animals`, { ...child, currentGroupId: b.pen.id })).status,
      400,
    );
    assert.equal(
      (await client.patch(`${a.base}/animals/${a.child.id}`, { currentGroupId: b.pen.id })).status,
      400,
    );
    assert.equal(
      (await client.post(`${a.base}/groups`, { name: 'Foreign ram', ramId: b.male.id })).status,
      400,
    );
    assert.equal(
      (await client.patch(`${a.base}/groups/${a.pen.id}`, { ramId: b.male.id })).status,
      400,
    );
    assert.equal(
      (
        await client.post(`${a.base}/breeding/matings`, {
          damId: a.mother.id,
          breedingGroupId: b.pen.id,
          method: 'natural',
          startDate: '2026-01-01',
        })
      ).status,
      400,
    );
    assert.equal(
      (await client.patch(`${a.base}/animals/${a.child.id}`, { currentGroupId: a.pen.id })).status,
      200,
    );
    assert.equal(
      (
        await client.post(`${a.base}/breeding/matings`, {
          damId: a.mother.id,
          breedingGroupId: a.pen.id,
          method: 'natural',
          startDate: '2026-01-01',
        })
      ).status,
      201,
    );
    assert.equal(
      (await client.get<Row>(`${b.base}/animals/${b.child.id}`)).body.currentGroupId,
      null,
    );
  });
});

test('births, pedigree and released class slots remain independent between farms', async () => {
  await withServer(testApp(), async (url) => {
    const { client, a, b, userId } = await twoFarms(url);
    for (const farm of [a, b]) {
      assert.equal(
        (
          await client.post(`${farm.base}/breeding/matings`, {
            damId: farm.mother.id,
            sireId: farm.male.id,
            startDate: '2026-01-01',
          })
        ).status,
        201,
      );
    }
    const births = await Promise.all(
      [a, b].map((farm) =>
        new BreedingService(true).recordBirth(
          farm.farmId,
          {
            id: randomUUID(),
            damId: farm.mother.id,
            date: new Date('2026-06-01'),
            offspring: [
              { sex: 'female', outcome: 'live' },
              { sex: 'male', outcome: 'live' },
            ],
          },
          userId,
        ),
      ),
    );
    for (const [index, farm] of [a, b].entries()) {
      assert.deepEqual(
        births[index]!.offspring.map((lamb) => lamb.tagNumber),
        ['4', '5'],
      );
      for (const lamb of births[index]!.offspring) {
        const tree = await client.get<{ dam: Row; sire: Row }>(
          `${farm.base}/animals/${lamb.animalId}/pedigree`,
        );
        assert.equal(tree.body.dam.id, farm.mother.id);
        assert.equal(tree.body.sire.id, farm.male.id);
      }
    }
    await client.post(`${a.base}/animals/${a.mother.id}/status`, {
      status: 'sold',
      date: '2026-07-01',
    });
    const replacement = await client.post<Row>(`${a.base}/animals`, {
      ...adult,
      classification: 'mother',
    });
    assert.equal(replacement.body.classLabel, 'M1');
    assert.equal(replacement.body.tagNumber, '6');
    const otherMother = await client.post<Row>(`${b.base}/animals`, {
      ...adult,
      classification: 'mother',
    });
    assert.equal(otherMother.body.classLabel, 'M2');
    assert.equal(otherMother.body.tagNumber, '6');
    const tree = await client.get<{ dam: Row }>(`${a.base}/animals/${a.child.id}/pedigree`);
    assert.equal(
      tree.body.dam.id,
      a.mother.id,
      'reusing M1 must never redirect existing children to the new mother',
    );
    const sync = await client.post<{
      changes: { animals: { created: Array<{ farmId: string }> } };
    }>(`${a.base}/sync/pull`, {});
    assert.ok(sync.body.changes.animals.created.every((row) => row.farmId === a.farmId));
  });
});

test('weaning weights accept only this mother’s offspring in this farm, without partial writes', async () => {
  await withServer(testApp(), async (url) => {
    const { client, a, b } = await twoFarms(url);
    await client.post(`${a.base}/breeding/matings`, {
      damId: a.mother.id,
      startDate: '2026-01-01',
    });
    await client.post(`${a.base}/breeding/births`, {
      damId: a.mother.id,
      date: '2026-06-01',
      offspring: [{ sex: 'female', outcome: 'live' }],
    });
    for (const invalidId of [b.child.id, a.male.id, randomUUID()]) {
      const res = await client.post(`${a.base}/breeding/weanings`, {
        damId: a.mother.id,
        date: '2026-08-01',
        weightsKg: { [a.child.id]: 20, [invalidId]: 99 },
      });
      assert.equal(res.status, 400);
      assert.equal(await Weaning.countDocuments({ farmId: a.farmId }), 0);
      assert.equal(
        (await client.get<Row>(`${a.base}/animals/${a.child.id}`)).body.lastWeightKg,
        null,
      );
    }
    const valid = await client.post(`${a.base}/breeding/weanings`, {
      damId: a.mother.id,
      date: '2026-08-01',
      weightsKg: { [a.child.id]: 20 },
    });
    assert.equal(valid.status, 201);
    assert.equal(
      (await client.get<Row>(`${b.base}/animals/${b.child.id}`)).body.lastWeightKg,
      null,
    );
  });
});
