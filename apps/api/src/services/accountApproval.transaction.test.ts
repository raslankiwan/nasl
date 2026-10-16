import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { startTestMongo, stopTestMongo, clearDatabase } from '../testing/mongo.ts';
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
