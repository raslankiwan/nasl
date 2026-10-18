import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Animal } from '../models/animal.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface AnimalBody {
  id: string;
  tagNumber: string;
  name: string | null;
  sex: string;
  status: string;
  damId: string | null;
  sireId: string | null;
}
interface ListBody {
  animals: AnimalBody[];
  total: number;
}
interface ErrorBody {
  error: { code: string; message: string; details?: { conflictsWith?: { id: string } } };
}
interface PedigreeBody {
  id: string;
  tagNumber: string;
  dam: PedigreeBody | null;
  sire: PedigreeBody | null;
}

const ewe = (tagNumber: string, extra: Record<string, unknown> = {}) => ({
  tagNumber,
  species: 'sheep',
  sex: 'female',
  ...extra,
});
const ram = (tagNumber: string, extra: Record<string, unknown> = {}) => ({
  tagNumber,
  species: 'sheep',
  sex: 'male',
  ...extra,
});

before(async () => {
  await startTestMongo();
});
after(async () => {
  await stopTestMongo();
});
beforeEach(async () => {
  await clearDatabase();
});

describe('registering animals', () => {
  test('a label can be added, renamed and cleared without changing the tag or animal details', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+970590000001');
      const client = api(url, session.accessToken);
      const created = await client.post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('0012', {
          name: '  بيضاء الوجه  ',
          origin: 'purchased',
          dobIsEstimate: true,
        }),
      );
      assert.equal(created.status, 201);
      assert.equal(created.body.tagNumber, '0012');
      assert.equal(created.body.name, 'بيضاء الوجه');
      const path = `/v1/farms/${farmId}/animals/${created.body.id}`;
      const renamed = await client.patch<AnimalBody>(path, { name: '  ريم  ' });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.name, 'ريم');
      assert.equal(renamed.body.tagNumber, '0012');
      const stored = await Animal.findById(created.body.id).lean();
      assert.equal(stored?.origin, 'purchased');
      assert.equal(stored?.dobIsEstimate, true);
      assert.equal(stored?.species, 'sheep');
      for (const name of [null, '   ']) {
        const cleared = await client.patch<AnimalBody>(path, { name });
        assert.equal(cleared.status, 200);
        assert.equal(cleared.body.name, null);
        assert.equal(cleared.body.tagNumber, '0012');
      }
    });
  });

  test('labels are optional and may repeat, while tag numbers remain unique', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+970590000001');
      const client = api(url, session.accessToken);
      const path = `/v1/farms/${farmId}/animals`;
      assert.equal((await client.post(path, ewe('1', { name: 'بيضاء الوجه' }))).status, 201);
      assert.equal((await client.post(path, ewe('2', { name: 'بيضاء الوجه' }))).status, 201);
      const unlabelled = await client.post<AnimalBody>(path, ewe('3'));
      assert.equal(unlabelled.body.name, null);
      assert.equal((await client.post(path, ewe('1', { name: 'Another label' }))).status, 409);
      assert.equal((await client.post(path, ewe('4', { name: 'x'.repeat(61) }))).status, 400);
      assert.equal(
        (await client.patch(`${path}/${unlabelled.body.id}`, { name: 'x'.repeat(61) })).status,
        400,
      );
    });
  });

  test('a label update cannot change another farm’s animal', async () => {
    await withServer(testApp(), async (url) => {
      const first = await signInWithFarm(url, '+970590000001');
      const second = await signInWithFarm(url, '+970590000002');
      const created = await api(url, first.session.accessToken).post<AnimalBody>(
        `/v1/farms/${first.farmId}/animals`,
        ewe('12', { name: 'ريم' }),
      );
      const denied = await api(url, second.session.accessToken).patch(
        `/v1/farms/${second.farmId}/animals/${created.body.id}`,
        { name: 'changed' },
      );
      assert.equal(denied.status, 404);
      assert.equal((await Animal.findById(created.body.id).lean())?.name, 'ريم');
    });
  });

  test('an animal is registered and read back', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const created = await client.post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('1001', { name: 'غزال', breedId: 'awassi', dateOfBirth: '2024-03-01' }),
      );
      assert.equal(created.status, 201);
      assert.equal(created.body.tagNumber, '1001');
      assert.equal(created.body.name, 'غزال');
      assert.equal(created.body.status, 'active');

      const fetched = await client.get<AnimalBody>(
        `/v1/farms/${farmId}/animals/${created.body.id}`,
      );
      assert.equal(fetched.status, 200);
      assert.equal(fetched.body.id, created.body.id);
    });
  });

  test('the device may mint the id, so an offline record keeps its identity', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const id = randomUUID();
      const created = await api(url, session.accessToken).post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('1001', { id }),
      );
      assert.equal(created.body.id, id);
    });
  });

  test('a duplicate tag is refused and names the animal it collides with', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const first = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, ewe('1001'));
      const second = await client.post<ErrorBody>(`/v1/farms/${farmId}/animals`, ewe('1001'));

      assert.equal(second.status, 409);
      assert.equal(second.body.error.code, 'conflict');
      assert.equal(second.body.error.details?.conflictsWith?.id, first.body.id);
    });
  });

  test('an archived animal keeps its number reserved', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const first = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, ewe('1001'));
      await fetch(`${url}/v1/farms/${farmId}/animals/${first.body.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${session.accessToken}` },
      });

      const reused = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, ewe('1001'));
      assert.equal(reused.status, 409, 'historical numbers cannot be reassigned');
    });
  });

  test('two farms may each use the same tag number', async () => {
    await withServer(testApp(), async (url) => {
      const a = await signInWithFarm(url, '+966501111111', 'مراح الشمال');
      const b = await signInWithFarm(url, '+966502222222', 'مراح الجنوب');

      const first = await api(url, a.session.accessToken).post(
        `/v1/farms/${a.farmId}/animals`,
        ewe('1001'),
      );
      const second = await api(url, b.session.accessToken).post(
        `/v1/farms/${b.farmId}/animals`,
        ewe('1001'),
      );
      assert.equal(first.status, 201);
      assert.equal(second.status, 201, 'tag uniqueness is per farm, not global');
    });
  });

  test('bulk registration reports each row and keeps the good ones', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const res = await client.post<{
        created: AnimalBody[];
        failed: Array<{ tagNumber: string; code: string }>;
      }>(`/v1/farms/${farmId}/animals/bulk`, {
        animals: [ewe('2001'), ewe('2002'), ewe('2001'), ram('2003')],
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.created.length, 3, 'one bad tag must not discard the pen');
      assert.equal(res.body.failed.length, 1);
      assert.equal(res.body.failed[0]?.tagNumber, '2001');
    });
  });
});

describe('listing and filtering', () => {
  test('the roster shows active animals and filters by sex and tag', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);
      await client.post(`/v1/farms/${farmId}/animals/bulk`, {
        animals: [ewe('1001', { name: 'غزال' }), ewe('1002'), ram('3001')],
      });

      const all = await client.get<ListBody>(`/v1/farms/${farmId}/animals`);
      assert.equal(all.body.total, 3);

      const females = await client.get<ListBody>(`/v1/farms/${farmId}/animals?sex=female`);
      assert.equal(females.body.total, 2);

      const byTag = await client.get<ListBody>(`/v1/farms/${farmId}/animals?q=100`);
      assert.equal(byTag.body.total, 2);

      const byName = await client.get<ListBody>(
        `/v1/farms/${farmId}/animals?q=${encodeURIComponent('غزال')}`,
      );
      assert.equal(byName.body.total, 1);
    });
  });

  test('sold animals drop out of the default roster', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);
      const created = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, ewe('1001'));

      await client.post(`/v1/farms/${farmId}/animals/${created.body.id}/status`, {
        status: 'sold',
      });

      assert.equal((await client.get<ListBody>(`/v1/farms/${farmId}/animals`)).body.total, 0);
      assert.equal(
        (await client.get<ListBody>(`/v1/farms/${farmId}/animals?status=sold`)).body.total,
        1,
      );
    });
  });

  test('one farm cannot read another farm’s animals', async () => {
    await withServer(testApp(), async (url) => {
      const a = await signInWithFarm(url, '+966501111111');
      const b = await signInWithFarm(url, '+966502222222');

      const created = await api(url, a.session.accessToken).post<AnimalBody>(
        `/v1/farms/${a.farmId}/animals`,
        ewe('1001'),
      );

      const viaOwnFarm = await api(url, b.session.accessToken).get<ErrorBody>(
        `/v1/farms/${b.farmId}/animals/${created.body.id}`,
      );
      assert.equal(viaOwnFarm.status, 404, 'the id does not exist inside farm B');

      const viaOtherFarm = await api(url, b.session.accessToken).get<ErrorBody>(
        `/v1/farms/${a.farmId}/animals/${created.body.id}`,
      );
      assert.equal(viaOtherFarm.status, 403, 'and farm A is not theirs to read');
    });
  });
});

describe('parentage', () => {
  test('a dam must be female and a sire must be male', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const dam = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, ewe('1001'));
      const sire = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, ram('3001'));

      const swapped = await client.post<ErrorBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('1002', { damId: sire.body.id }),
      );
      assert.equal(swapped.status, 400);
      assert.match(swapped.body.error.message, /dam must be female/);

      const ok = await client.post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('1003', { damId: dam.body.id, sireId: sire.body.id }),
      );
      assert.equal(ok.status, 201);
    });
  });

  test('a parent must be born before its offspring', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const dam = await client.post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('1001', { dateOfBirth: '2024-01-01' }),
      );
      const res = await client.post<ErrorBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('1002', { dateOfBirth: '2023-01-01', damId: dam.body.id }),
      );
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /born before/);
    });
  });

  test('a parent from another farm is not accepted', async () => {
    await withServer(testApp(), async (url) => {
      const a = await signInWithFarm(url, '+966501111111');
      const b = await signInWithFarm(url, '+966502222222');

      const foreignDam = await api(url, a.session.accessToken).post<AnimalBody>(
        `/v1/farms/${a.farmId}/animals`,
        ewe('1001'),
      );
      const res = await api(url, b.session.accessToken).post<ErrorBody>(
        `/v1/farms/${b.farmId}/animals`,
        ewe('9001', { damId: foreignDam.body.id }),
      );
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /not in this flock/);
    });
  });

  test('an animal cannot become its own ancestor', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const grandDam = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, ewe('1001'));
      const dam = await client.post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('1002', { damId: grandDam.body.id }),
      );

      const selfParent = await client.post<ErrorBody>(
        `/v1/farms/${farmId}/animals/${dam.body.id}`,
        {},
      );
      assert.ok(selfParent.status >= 400);

      // Closing the loop: making the granddam a daughter of her own descendant.
      const res = await fetch(`${url}/v1/farms/${farmId}/animals/${grandDam.body.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ damId: dam.body.id }),
      });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error.message, /loop/);
    });
  });

  test('the pedigree walks back through four generations', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const g3 = await client.post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('4001', { dateOfBirth: '2020-01-01' }),
      );
      const g2 = await client.post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('3002', { dateOfBirth: '2021-01-01', damId: g3.body.id }),
      );
      const g1 = await client.post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('2003', { dateOfBirth: '2022-01-01', damId: g2.body.id }),
      );
      const subject = await client.post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('1004', { dateOfBirth: '2023-01-01', damId: g1.body.id }),
      );

      const tree = await client.get<PedigreeBody>(
        `/v1/farms/${farmId}/animals/${subject.body.id}/pedigree?generations=4`,
      );
      assert.equal(tree.status, 200);
      assert.equal(tree.body.dam?.tagNumber, '2003');
      assert.equal(tree.body.dam?.dam?.tagNumber, '3002');
      assert.equal(tree.body.dam?.dam?.dam?.tagNumber, '4001');
      assert.equal(tree.body.dam?.dam?.dam?.dam, null, 'the line ends where records do');
    });
  });

  test('offspring are listed for the dam', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);

      const dam = await client.post<AnimalBody>(
        `/v1/farms/${farmId}/animals`,
        ewe('1001', { dateOfBirth: '2022-01-01' }),
      );
      await client.post(`/v1/farms/${farmId}/animals`, {
        ...ewe('1002', { dateOfBirth: '2024-01-01', damId: dam.body.id }),
      });
      await client.post(`/v1/farms/${farmId}/animals`, {
        ...ram('1003', { dateOfBirth: '2024-01-01', damId: dam.body.id }),
      });

      const res = await client.get<{ offspring: AnimalBody[] }>(
        `/v1/farms/${farmId}/animals/${dam.body.id}/offspring`,
      );
      assert.equal(res.body.offspring.length, 2);
    });
  });
});

describe('withdrawal periods gate sale', () => {
  test('an animal under withdrawal cannot be sold or slaughtered', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);
      const created = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, ewe('1001'));

      await Animal.updateOne(
        { _id: created.body.id },
        { $set: { withholdMeatUntil: new Date(Date.now() + 7 * 86_400_000) } },
      );

      const sold = await client.post<ErrorBody>(
        `/v1/farms/${farmId}/animals/${created.body.id}/status`,
        { status: 'sold' },
      );
      assert.equal(sold.status, 409);
      assert.match(sold.body.error.message, /withdrawal period/);

      const culled = await client.post(`/v1/farms/${farmId}/animals/${created.body.id}/status`, {
        status: 'culled',
      });
      assert.equal(culled.status, 200, 'culling is not the same as selling for meat');
    });
  });

  test('the withdrawal filter lists exactly the restricted animals', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111');
      const client = api(url, session.accessToken);
      await client.post(`/v1/farms/${farmId}/animals/bulk`, {
        animals: [ewe('1001'), ewe('1002')],
      });
      await Animal.updateOne(
        { tagNumber: '1001' },
        { $set: { withholdMeatUntil: new Date(Date.now() + 86_400_000) } },
      );

      const res = await client.get<ListBody>(`/v1/farms/${farmId}/animals?underWithdrawal=true`);
      assert.equal(res.body.total, 1);
      assert.equal(res.body.animals[0]?.tagNumber, '1001');
    });
  });
});

test('automatic numbers are unique across simultaneous creation, edits and retries', async () => {
  await withServer(testApp(), async (url) => {
    const { session, farmId } = await signInWithFarm(url, 'numbering');
    const client = api(url, session.accessToken);
    const path = `/v1/farms/${farmId}/animals`;
    await client.post(path, ewe('100'));
    const rows = await Promise.all(
      Array.from({ length: 8 }, () =>
        client.post<AnimalBody>(path, { species: 'sheep', sex: 'female' }),
      ),
    );
    assert.ok(rows.every((row) => row.status === 201));
    assert.equal(new Set(rows.map((row) => row.body.tagNumber)).size, 8);
    assert.ok(rows.every((row) => Number(row.body.tagNumber) > 100));
    assert.equal(
      (await client.patch(`${path}/${rows[0]!.body.id}`, { tagNumber: rows[1]!.body.tagNumber }))
        .status,
      409,
    );
    const id = randomUUID();
    const retried = await Promise.all(
      [1, 2].map(() => client.post<AnimalBody>(path, { id, species: 'sheep', sex: 'male' })),
    );
    assert.ok(retried.every((row) => row.status === 201));
    assert.equal(retried[0]!.body.tagNumber, retried[1]!.body.tagNumber);
    assert.equal(await Animal.countDocuments({ _id: id }), 1);
    const other = await signInWithFarm(url, 'numbering-other');
    const first = await api(url, other.session.accessToken).post<AnimalBody>(
      `/v1/farms/${other.farmId}/animals`,
      { species: 'sheep', sex: 'female' },
    );
    assert.equal(first.body.tagNumber, '1', 'another farm has its own sequence');
  });
});
