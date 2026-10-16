import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { startTestMongo, stopTestMongo, clearDatabase } from '../testing/mongo.ts';
import { Farm } from '../models/farm.model.ts';
import { Membership } from '../models/membership.model.ts';
import { User } from '../models/user.model.ts';
import { AuditLog } from '../models/auditLog.model.ts';
import { reviewAccount } from './accountApproval.service.ts';

before(() => startTestMongo(true));
after(stopTestMongo);
beforeEach(clearDatabase);
async function pending() {
  return User.create({
    username: 'pending',
    email: 'pending@example.test',
    passwordHash: 'fixture',
  });
}
test('concurrent production reviews commit exactly one decision and audit', async () => {
  const user = await pending();
  const results = await Promise.allSettled(
    (['approved', 'rejected'] as const).map((status) =>
      reviewAccount(
        { userId: user._id, actorId: 'staff', status, expectedStatus: 'pending' },
        true,
      ),
    ),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const audit = await AuditLog.findOne({ targetId: user._id }).lean();
  assert.equal(await AuditLog.countDocuments(), 1);
  assert.deepEqual(audit?.after, { status: (await User.findById(user._id).lean())?.status });
});
test('production review rolls back completely when audit insertion fails', async (t) => {
  const user = await pending();
  t.mock.method(AuditLog, 'create', async () => {
    throw new Error('Audit failed');
  });
  await assert.rejects(
    reviewAccount(
      { userId: user._id, actorId: 'staff', status: 'approved', expectedStatus: 'pending' },
      true,
    ),
    /Audit failed/,
  );
  const unchanged = await User.findById(user._id).lean();
  assert.equal(unchanged?.status, 'pending');
  assert.equal(unchanged?.reviewedAt, undefined);
});

test('concurrent approvals create exactly one farm and one active owner membership', async () => {
  const user = await pending();
  const input = {
    userId: user._id,
    actorId: 'staff',
    status: 'approved' as const,
    expectedStatus: 'pending' as const,
    farm: { name: 'New farm', species: ['sheep', 'goat'] },
  };
  const results = await Promise.allSettled([
    reviewAccount(input, true),
    reviewAccount(input, true),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const farm = await Farm.findOne({ ownerUserId: user._id }).lean();
  assert.ok(farm);
  assert.equal(await Farm.countDocuments(), 1);
  assert.deepEqual(farm.species, ['sheep', 'goat']);
  assert.equal(farm.plan, 'free');
  assert.equal(farm.currency, 'ILS');
  const membership = await Membership.findOne({ farmId: farm._id, userId: user._id }).lean();
  assert.equal(membership?.role, 'owner');
  assert.equal(membership?.status, 'active');
  assert.equal(await Membership.countDocuments(), 1);
  assert.equal((await User.findById(user._id).lean())?.defaultFarmId, farm._id);
  assert.equal(await AuditLog.countDocuments(), 1);
  const audit = await AuditLog.findOne({ targetId: user._id }).lean();
  assert.deepEqual(audit?.after, {
    status: 'approved',
    farm: {
      id: farm._id,
      name: farm.name,
      species: farm.species,
      ownerUserId: user._id,
      plan: 'free',
    },
  });
});
for (const transactional of [true, false]) {
  for (const stage of ['membership', 'audit']) {
    test(`${transactional ? 'transaction' : 'standalone'} restores approval and removes farm on ${stage} failure`, async (t) => {
      const user = await pending();
      const model = stage === 'membership' ? Membership : AuditLog;
      t.mock.method(model, 'create', async () => {
        throw new Error('Injected failure');
      });
      await assert.rejects(
        reviewAccount(
          {
            userId: user._id,
            actorId: 'staff',
            status: 'approved',
            expectedStatus: 'pending',
            farm: { name: 'Rollback farm', species: ['sheep'] },
          },
          transactional,
        ),
        /Injected failure/,
      );
      const unchanged = await User.findById(user._id).lean();
      assert.equal(unchanged?.status, 'pending');
      assert.equal(unchanged?.defaultFarmId, undefined);
      assert.equal(await Farm.countDocuments(), 0);
      assert.equal(await Membership.countDocuments(), 0);
      assert.equal(await AuditLog.countDocuments(), 0);
    });
  }
  test(`${transactional ? 'transaction' : 'standalone'} prevents an extra farm for an existing member`, async () => {
    const user = await pending();
    const farm = await Farm.create({ name: 'Existing farm', ownerUserId: 'other-owner' });
    await Membership.create({
      farmId: farm._id,
      userId: user._id,
      role: 'worker',
      status: 'active',
    });
    await assert.rejects(
      reviewAccount(
        {
          userId: user._id,
          actorId: 'staff',
          status: 'approved',
          expectedStatus: 'pending',
          farm: { name: 'Duplicate', species: ['sheep'] },
        },
        transactional,
      ),
      /already has a farm/,
    );
    assert.equal((await User.findById(user._id).lean())?.status, 'pending');
    assert.equal(await Farm.countDocuments(), 1);
    assert.equal(await Membership.countDocuments(), 1);
  });
}
