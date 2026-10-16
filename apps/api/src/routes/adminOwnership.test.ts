import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '../models/auditLog.model.ts';
import { Farm } from '../models/farm.model.ts';
import { Membership } from '../models/membership.model.ts';
import { User } from '../models/user.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import {
  api,
  makePlatformAdmin,
  signIn,
  signInWithFarm,
  testApp,
  withServer,
} from '../testing/harness.ts';

before(async () => {
  await startTestMongo();
});
after(async () => {
  await stopTestMongo();
});
beforeEach(async () => {
  await clearDatabase();
});

async function setup(url: string) {
  const { session: original, farmId } = await signInWithFarm(url, '+970590000001', 'North farm');
  const next = await signIn(url, '+970590000002', 'New owner');
  const staff = await signIn(url, '+970590000003', 'Operator');
  await makePlatformAdmin(staff.user.id);
  return {
    original,
    next,
    staff,
    farmId,
    client: api(url, staff.accessToken),
    input: { expectedOwnerUserId: original.user.id, ownerUserId: next.user.id },
  };
}

describe('operator ownership changes', () => {
  test('transfers membership and access, preserves unrelated farms and records before/after', async () => {
    await withServer(testApp(), async (url) => {
      const { original, next, staff, farmId, client, input } = await setup(url);
      const otherFarm = await api(url, original.accessToken).post<{ id: string }>('/v1/farms', {
        name: 'Other farm',
      });
      const workerSession = await signIn(url, '+970590000004');
      const worker = { _id: workerSession.user.id };
      await Membership.create({ farmId, userId: worker._id, role: 'worker', status: 'active' });
      const result = await client.patch<{ owner: { id: string } }>(
        `/v1/admin/farms/${farmId}/owner`,
        { ...input, reason: 'Owner requested transfer' },
      );
      assert.equal(result.status, 200);
      assert.equal(result.body.owner.id, next.user.id);
      assert.equal((await Farm.findById(farmId).lean())?.ownerUserId, next.user.id);
      assert.equal(
        (await Membership.findOne({ farmId, userId: original.user.id }).lean())?.status,
        'revoked',
      );
      assert.equal(
        (await Membership.findOne({ farmId, userId: next.user.id }).lean())?.role,
        'owner',
      );
      assert.equal(
        (await Membership.findOne({ farmId, userId: worker._id }).lean())?.role,
        'worker',
      );
      assert.equal((await api(url, original.accessToken).get(`/v1/farms/${farmId}`)).status, 403);
      assert.equal((await api(url, next.accessToken).get(`/v1/farms/${farmId}`)).status, 200);
      assert.equal(
        (await api(url, original.accessToken).get(`/v1/farms/${otherFarm.body.id}`)).status,
        200,
      );
      assert.equal(
        (await api(url, next.accessToken).get(`/v1/farms/${otherFarm.body.id}`)).status,
        403,
      );
      assert.equal((await api(url, staff.accessToken).get(`/v1/farms/${farmId}`)).status, 403);
      const profile = await api(url, next.accessToken).get<{
        farms: Array<{ farmId: string; role: string }>;
      }>('/v1/auth/me');
      assert.deepEqual(profile.body.farms, [{ farmId, role: 'owner' }]);
      const audit = await AuditLog.findOne({
        action: 'farm.owner.change',
        targetId: farmId,
      }).lean();
      assert.equal(audit?.actorId, staff.user.id);
      assert.equal(audit?.reason, 'Owner requested transfer');
      assert.deepEqual(audit?.before, { ownerUserId: original.user.id });
      assert.deepEqual(audit?.after, { ownerUserId: next.user.id, previousOwnerStatus: 'revoked' });
    });
  });

  test('a revoked or expired membership is reused and gains permanent owner access', async () => {
    await withServer(testApp(), async (url) => {
      const { next, farmId, client, input } = await setup(url);
      const member = await Membership.create({
        farmId,
        userId: next.user.id,
        role: 'vet',
        status: 'revoked',
        expiresAt: new Date(0),
      });
      assert.equal((await client.patch(`/v1/admin/farms/${farmId}/owner`, input)).status, 200);
      const updated = await Membership.findById(member._id).lean();
      assert.equal(updated?.role, 'owner');
      assert.equal(updated?.status, 'active');
      assert.equal(updated?.expiresAt, null);
      assert.equal(await Membership.countDocuments({ farmId, userId: next.user.id }), 1);
      assert.equal((await api(url, next.accessToken).get(`/v1/farms/${farmId}`)).status, 200);
    });
  });

  test('pending owners cannot be linked to farms', async () => {
    await withServer(testApp(), async (url) => {
      const { next, original, farmId, client, input } = await setup(url);
      await User.updateOne({ _id: next.user.id }, { $set: { status: 'pending' } });
      assert.equal((await client.patch(`/v1/admin/farms/${farmId}/owner`, input)).status, 404);
      assert.equal((await Farm.findById(farmId).lean())?.ownerUserId, original.user.id);
      assert.equal(await AuditLog.countDocuments(), 0);
    });
  });

  test('only staff can see users or transfer ownership', async () => {
    await withServer(testApp(), async (url) => {
      const { original, next, farmId, input } = await setup(url);
      for (const [client, status] of [
        [api(url), 401],
        [api(url, original.accessToken), 404],
      ] as const) {
        assert.equal((await client.get('/v1/admin/users')).status, status);
        assert.equal((await client.get(`/v1/admin/users/${next.user.id}`)).status, status);
        assert.equal((await client.patch(`/v1/admin/farms/${farmId}/owner`, input)).status, status);
      }
      assert.equal((await Farm.findById(farmId).lean())?.ownerUserId, original.user.id);
    });
  });

  test('invalid, missing and stale targets cannot change access', async () => {
    await withServer(testApp(), async (url) => {
      const { original, farmId, client, input } = await setup(url);
      for (const body of [
        {},
        { ...input, ownerPhone: '+970590000002' },
        { expectedOwnerUserId: original.user.id, ownerPhone: 'invalid' },
        { ...input, reason: 'x'.repeat(301) },
      ]) {
        assert.equal((await client.patch(`/v1/admin/farms/${farmId}/owner`, body)).status, 400);
      }
      assert.equal(
        (
          await client.patch(`/v1/admin/farms/${farmId}/owner`, {
            ...input,
            ownerUserId: 'missing',
          })
        ).status,
        404,
      );
      assert.equal((await client.patch('/v1/admin/farms/missing/owner', input)).status, 404);
      assert.equal(
        (
          await client.patch(`/v1/admin/farms/${farmId}/owner`, {
            ...input,
            expectedOwnerUserId: 'stale',
          })
        ).status,
        409,
      );
      assert.equal((await client.get('/v1/admin/users/missing')).status, 404);
      assert.equal((await Farm.findById(farmId).lean())?.ownerUserId, original.user.id);
      assert.equal(await Membership.countDocuments({ farmId, status: 'active', role: 'owner' }), 1);
      assert.equal(await AuditLog.countDocuments(), 0);
    });
  });

  test('simultaneous transfers have one winner and one audit entry', async () => {
    await withServer(testApp(), async (url) => {
      const { original, next, farmId, client, input } = await setup(url);
      const thirdSession = await signIn(url, '+970590000004');
      const third = { _id: thirdSession.user.id };
      const results = await Promise.all([
        client.patch(`/v1/admin/farms/${farmId}/owner`, input),
        client.patch(`/v1/admin/farms/${farmId}/owner`, { ...input, ownerUserId: third._id }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const farm = await Farm.findById(farmId).lean();
      const owners = await Membership.find({ farmId, role: 'owner', status: 'active' }).lean();
      assert.equal(owners.length, 1);
      assert.equal(owners[0]?.userId, farm?.ownerUserId);
      assert.ok([next.user.id, third._id].includes(farm!.ownerUserId));
      assert.notEqual(farm?.ownerUserId, original.user.id);
      assert.equal(await AuditLog.countDocuments({ targetId: farmId }), 1);
    });
  });

  test('an audit failure restores both existing memberships and the farm owner', async (t) => {
    await withServer(testApp(), async (url) => {
      const { original, next, farmId, client, input } = await setup(url);
      const expiresAt = new Date('2030-01-01');
      await Membership.create({
        farmId,
        userId: next.user.id,
        role: 'vet',
        status: 'invited',
        expiresAt,
      });
      t.mock.method(AuditLog, 'create', async () => {
        throw new Error('Audit unavailable');
      });
      assert.equal((await client.patch(`/v1/admin/farms/${farmId}/owner`, input)).status, 500);
      assert.equal((await Farm.findById(farmId).lean())?.ownerUserId, original.user.id);
      assert.equal(
        (await Membership.findOne({ farmId, userId: original.user.id }).lean())?.status,
        'active',
      );
      const restored = await Membership.findOne({ farmId, userId: next.user.id }).lean();
      assert.equal(restored?.role, 'vet');
      assert.equal(restored?.status, 'invited');
      assert.equal(restored?.expiresAt?.toISOString(), expiresAt.toISOString());
      assert.equal((await api(url, next.accessToken).get(`/v1/farms/${farmId}`)).status, 403);
    });
  });

  test('an audit failure removes a newly added membership and allows retry', async (t) => {
    await withServer(testApp(), async (url) => {
      const { original, next, farmId, client, input } = await setup(url);
      const mocked = t.mock.method(AuditLog, 'create', async () => {
        throw new Error('Audit unavailable');
      });
      assert.equal((await client.patch(`/v1/admin/farms/${farmId}/owner`, input)).status, 500);
      assert.equal((await Farm.findById(farmId).lean())?.ownerUserId, original.user.id);
      assert.equal(await Membership.countDocuments({ farmId, userId: next.user.id }), 0);
      mocked.mock.restore();
      assert.equal((await client.patch(`/v1/admin/farms/${farmId}/owner`, input)).status, 200);
    });
  });
});

describe('operator user directory', () => {
  test('supports name/username search, literal regex characters and pagination with owned counts', async () => {
    await withServer(testApp(), async (url) => {
      const { original, client } = await setup(url);
      await User.updateOne({ _id: original.user.id }, { $set: { name: 'Farmer (North)' } });
      const byName = await client.get<{
        users: Array<{ id: string; username: string; ownedFarmCount: number }>;
        total: number;
      }>('/v1/admin/users?q=%28North%29');
      assert.equal(byName.status, 200);
      assert.equal(byName.body.total, 1);
      assert.equal(byName.body.users[0]?.id, original.user.id);
      assert.equal(byName.body.users[0]?.ownedFarmCount, 1);
      assert.equal(byName.body.users[0]?.username, 'user970590000001');
      const byUsername = await client.get<{ total: number }>('/v1/admin/users?q=590000001');
      assert.equal(byUsername.body.total, 1);
      const first = await client.get<{ users: Array<{ id: string }>; total: number }>(
        '/v1/admin/users?limit=1',
      );
      const second = await client.get<{ users: Array<{ id: string }>; total: number }>(
        '/v1/admin/users?limit=1&skip=1',
      );
      assert.equal(first.body.total, 3);
      assert.notEqual(first.body.users[0]?.id, second.body.users[0]?.id);
    });
  });

  test('user details include owned, member and revoked farms but never unrelated farms', async () => {
    await withServer(testApp(), async (url) => {
      const { original, next, farmId, client, input } = await setup(url);
      const related = await Farm.create({ name: 'Related', ownerUserId: next.user.id });
      await Farm.create({ name: 'Unrelated', ownerUserId: next.user.id });
      await Membership.create({
        farmId: related._id,
        userId: original.user.id,
        role: 'worker',
        status: 'active',
      });
      const before = await client.get<{ farms: Array<{ id: string; owner: { id: string } }> }>(
        `/v1/admin/users/${original.user.id}`,
      );
      assert.deepEqual(before.body.farms.map((f) => f.id).sort(), [farmId, related._id].sort());
      assert.equal(before.body.farms.find((f) => f.id === related._id)?.owner.id, next.user.id);
      await client.patch(`/v1/admin/farms/${farmId}/owner`, input);
      const after = await client.get<{ farms: Array<{ id: string; status: string }> }>(
        `/v1/admin/users/${original.user.id}`,
      );
      assert.equal(after.body.farms.find((f) => f.id === farmId)?.status, 'revoked');
    });
  });
});
