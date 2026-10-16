import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { Farm } from '../models/farm.model.ts';
import { User } from '../models/user.model.ts';
import { Membership } from '../models/membership.model.ts';
import { AuditLog } from '../models/auditLog.model.ts';
import { changeFarmOwner } from './farmOwnership.service.ts';

before(() => startTestMongo(true));
after(stopTestMongo);
beforeEach(clearDatabase);

async function setup() {
  const owner = await User.create({ phone: '+970590000001' });
  const second = await User.create({ phone: '+970590000002' });
  const third = await User.create({ phone: '+970590000003' });
  const farm = await Farm.create({ name: 'Transaction test', ownerUserId: owner._id });
  await Membership.create({ farmId: farm._id, userId: owner._id, role: 'owner', status: 'active' });
  return {
    owner,
    second,
    third,
    farm,
    input: { farmId: farm._id, expectedOwnerUserId: owner._id, actorId: owner._id },
  };
}

test('concurrent ownership transactions preserve exactly one owner and audit', async () => {
  const { second, third, farm, input } = await setup();
  const results = await Promise.allSettled([
    changeFarmOwner({ ...input, ownerUserId: second._id }, true),
    changeFarmOwner({ ...input, ownerUserId: third._id }, true),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const updated = await Farm.findById(farm._id).lean();
  const owners = await Membership.find({
    farmId: farm._id,
    role: 'owner',
    status: 'active',
  }).lean();
  assert.deepEqual(
    owners.map((owner) => owner.userId),
    [updated?.ownerUserId],
  );
  assert.equal(await AuditLog.countDocuments(), 1);
});

test('a failed audit rolls back the owner account, membership and farm change', async (t) => {
  const { owner, farm, input } = await setup();
  t.mock.method(AuditLog, 'create', async () => {
    throw new Error('Audit failed');
  });
  await assert.rejects(
    changeFarmOwner({ ...input, ownerPhone: '+970590000004' }, true),
    /Audit failed/,
  );
  assert.equal((await Farm.findById(farm._id).lean())?.ownerUserId, owner._id);
  assert.equal(await User.countDocuments({ phone: '+970590000004' }), 0);
  assert.equal(await Membership.countDocuments({ farmId: farm._id }), 1);
});
