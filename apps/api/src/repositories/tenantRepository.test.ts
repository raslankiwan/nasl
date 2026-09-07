import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { model } from 'mongoose';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { tenantSchema, type TenantDocument } from '../models/base.ts';
import { TenantRepository, TenantScopeError } from './tenantRepository.ts';

interface TestAnimalDoc extends TenantDocument {
  tagNumber: string;
  name?: string;
  weightKg?: number;
}

const TestAnimal = model<TestAnimalDoc>(
  'TestAnimal',
  tenantSchema<TestAnimalDoc>({
    tagNumber: { type: String, required: true },
    name: { type: String },
    weightKg: { type: Number },
  }),
);

const FARM_A = 'farm-aaaa';
const FARM_B = 'farm-bbbb';

const repo = new TenantRepository<TestAnimalDoc>(TestAnimal);

/** One animal in each of two farms, so every test can check the boundary between them. */
async function seed() {
  const a = await repo.create(FARM_A, { tagNumber: '1001', name: 'Ghazal', weightKg: 52 });
  const b = await repo.create(FARM_B, { tagNumber: '2001', name: 'Wadha', weightKg: 61 });
  return { a, b };
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

describe('tenant isolation — reads', () => {
  test('findById cannot reach another farm', async () => {
    const { a, b } = await seed();
    assert.equal((await repo.findById(FARM_A, a._id))?.tagNumber, '1001');
    assert.equal(await repo.findById(FARM_A, b._id), null, "farm A must not see farm B's animal");
    assert.equal(await repo.findById(FARM_B, a._id), null);
  });

  test('findOne cannot reach another farm, even with a matching filter', async () => {
    await seed();
    assert.equal(await repo.findOne(FARM_A, { tagNumber: '2001' }), null);
    assert.equal((await repo.findOne(FARM_B, { tagNumber: '2001' }))?.name, 'Wadha');
  });

  test('find returns only this farm', async () => {
    await seed();
    await repo.create(FARM_A, { tagNumber: '1002' });
    const found = await repo.find(FARM_A, {});
    assert.equal(found.length, 2);
    assert.ok(found.every((d) => d.farmId === FARM_A));
  });

  test('count is scoped', async () => {
    await seed();
    assert.equal(await repo.count(FARM_A, {}), 1);
    assert.equal(await repo.count(FARM_B, {}), 1);
  });

  test('exists is scoped', async () => {
    await seed();
    assert.equal(await repo.exists(FARM_A, { tagNumber: '2001' }), false);
    assert.equal(await repo.exists(FARM_B, { tagNumber: '2001' }), true);
  });
});

describe('tenant isolation — hostile input', () => {
  test('a farmId in the caller filter is ignored, not honoured', async () => {
    const { b } = await seed();
    const found = await repo.find(FARM_A, { farmId: FARM_B } as never);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.farmId, FARM_A, 'the scope must win over the caller');
    assert.notEqual(found[0]?._id, b._id);
  });

  test('a farmId inside $or cannot widen the scope', async () => {
    await seed();
    const found = await repo.find(FARM_A, {
      $or: [{ farmId: FARM_B }, { tagNumber: '2001' }],
    } as never);
    assert.equal(found.length, 0, '$or is ANDed with the farm scope, so it can only narrow');
  });

  test('$where is rejected outright', async () => {
    await seed();
    await assert.rejects(
      () => repo.find(FARM_A, { $where: 'return true' } as never),
      TenantScopeError,
    );
  });

  test('an empty farmId is refused rather than matching everything', async () => {
    await seed();
    await assert.rejects(() => repo.find('', {}), TenantScopeError);
    await assert.rejects(() => repo.create('', { tagNumber: 'x' }), TenantScopeError);
  });
});

describe('tenant isolation — writes', () => {
  test('create ignores a farmId in the payload', async () => {
    const created = await repo.create(FARM_A, { tagNumber: '1003', farmId: FARM_B } as never);
    assert.equal(created.farmId, FARM_A);
    assert.equal(await repo.count(FARM_B, {}), 0);
  });

  test('updateById cannot modify another farm', async () => {
    const { b } = await seed();
    const result = await repo.updateById(FARM_A, b._id, { $set: { name: 'hijacked' } });
    assert.equal(result, null);
    assert.equal((await repo.findById(FARM_B, b._id))?.name, 'Wadha', 'must be untouched');
  });

  test('an update cannot move a document to another farm', async () => {
    const { a } = await seed();
    await repo.updateById(FARM_A, a._id, { $set: { farmId: FARM_B, name: 'Reem' } } as never);
    const reloaded = await repo.findById(FARM_A, a._id);
    assert.equal(reloaded?.farmId, FARM_A, 'farmId is stripped from the update');
    assert.equal(reloaded?.name, 'Reem', 'the rest of the update still applies');
  });

  test('a top-level farmId in an update is stripped too', async () => {
    const { a } = await seed();
    await repo.updateById(FARM_A, a._id, { farmId: FARM_B, weightKg: 55 } as never);
    const reloaded = await repo.findById(FARM_A, a._id);
    assert.equal(reloaded?.farmId, FARM_A);
    assert.equal(reloaded?.weightKg, 55);
  });

  test('updateMany is scoped to one farm', async () => {
    await seed();
    const modified = await repo.updateMany(FARM_A, {}, { $set: { name: 'renamed' } });
    assert.equal(modified, 1);
    assert.equal((await repo.findOne(FARM_B, {}))?.name, 'Wadha');
  });

  test('softDelete and hardDelete cannot reach another farm', async () => {
    const { b } = await seed();
    assert.equal(await repo.softDelete(FARM_A, b._id), null);
    assert.equal(await repo.hardDelete(FARM_A, b._id), false);
    assert.ok(await repo.findById(FARM_B, b._id), 'farm B animal survives');
  });
});

describe('soft deletion', () => {
  test('deleted documents disappear from reads but survive in the collection', async () => {
    const { a } = await seed();
    await repo.softDelete(FARM_A, a._id);

    assert.equal(await repo.findById(FARM_A, a._id), null);
    assert.equal(await repo.count(FARM_A, {}), 0);

    const withDeleted = await repo.findById(FARM_A, a._id, { includeDeleted: true });
    assert.equal(withDeleted?.tagNumber, '1001', 'the record is an ancestor in a pedigree');
    assert.ok(withDeleted?.deletedAt);
  });

  test('restore brings it back', async () => {
    const { a } = await seed();
    await repo.softDelete(FARM_A, a._id);
    const restored = await repo.restore(FARM_A, a._id);
    assert.equal(restored?.deletedAt, null);
    assert.equal(await repo.count(FARM_A, {}), 1);
  });
});

describe('sync pull', () => {
  test('changedSince is scoped and includes soft deletions', async () => {
    const { a } = await seed();
    const cursor = new Date(Date.now() - 1000);
    await repo.softDelete(FARM_A, a._id);

    const changes = await repo.changedSince(FARM_A, cursor);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]?.farmId, FARM_A);
    assert.ok(changes[0]?.deletedAt, 'the device needs to know it was deleted');
  });

  test('changedSince ignores documents that have not moved', async () => {
    await seed();
    const changes = await repo.changedSince(FARM_A, new Date(Date.now() + 60_000));
    assert.equal(changes.length, 0);
  });
});
