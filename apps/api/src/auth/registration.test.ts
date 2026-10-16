import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import {
  api,
  makePlatformAdmin,
  signIn,
  testApp,
  TEST_DEVICE,
  TEST_PASSWORD,
  withServer,
} from '../testing/harness.ts';
import { User } from '../models/user.model.ts';
import { RefreshToken } from '../models/refreshToken.model.ts';
import { AuditLog } from '../models/auditLog.model.ts';
import { verifyPassword } from './passwords.ts';

before(() => startTestMongo());
after(stopTestMongo);
beforeEach(clearDatabase);

const registration = {
  name: 'Farmer',
  email: 'Farmer@Example.test',
  username: 'Farmer_1',
  password: TEST_PASSWORD,
};
const login = { identifier: 'FARMER_1', password: TEST_PASSWORD, deviceId: TEST_DEVICE };
type Registered = { id: string; status: string };
type ErrorBody = { error: { code: string } };

test('registration is pending without tokens; only staff approval unlocks email and username login', async () => {
  await withServer(testApp(), async (url) => {
    const client = api(url);
    const created = await client.post<Registered>('/v1/auth/register', registration);
    assert.equal(created.status, 201);
    assert.deepEqual(Object.keys(created.body).sort(), ['id', 'status']);
    assert.equal(created.body.status, 'pending');
    const user = await User.findById(created.body.id).select('+passwordHash').lean();
    assert.equal(user?.email, 'farmer@example.test');
    assert.equal(user?.username, 'farmer_1');
    assert.equal(user?.isPlatformAdmin, false);
    assert.ok(await verifyPassword(TEST_PASSWORD, user?.passwordHash));
    assert.equal((await User.findById(created.body.id).lean())?.passwordHash, undefined);
    assert.equal(await RefreshToken.countDocuments(), 0);
    const pending = await client.post<ErrorBody>('/v1/auth/login', login);
    assert.equal(pending.status, 403);
    assert.equal(pending.body.error.code, 'account_pending');
    assert.equal(
      (await client.post('/v1/auth/login', { ...login, password: 'wrong' })).status,
      401,
    );
    assert.equal(await RefreshToken.countDocuments(), 0);
    const reviewPath = `/v1/admin/users/${created.body.id}/approval`;
    const approval = { status: 'approved', expectedStatus: 'pending' };
    assert.equal((await client.patch(reviewPath, approval)).status, 401);
    const regular = await signIn(url, 'regular');
    assert.equal((await api(url, regular.accessToken).patch(reviewPath, approval)).status, 404);
    const staff = await signIn(url, 'staff');
    await makePlatformAdmin(staff.user.id);
    const admin = api(url, staff.accessToken);
    assert.equal((await admin.patch(reviewPath, approval)).status, 200);
    assert.equal((await admin.patch(reviewPath, approval)).status, 409);
    for (const identifier of ['FARMER_1', ' Farmer@Example.test ']) {
      const session = await client.post<{ accessToken: string; refreshToken: string }>(
        '/v1/auth/login',
        { ...login, identifier },
      );
      assert.equal(session.status, 200);
      assert.ok(session.body.accessToken && session.body.refreshToken);
      const me = await api(url, session.body.accessToken).get('/v1/auth/me');
      assert.equal(me.status, 200);
      assert.equal(JSON.stringify(me.body).includes('password'), false);
      assert.equal((await api(url, session.body.accessToken).get('/v1/admin/users')).status, 404);
    }
    const detail = await admin.get(`/v1/admin/users/${created.body.id}`);
    assert.equal(JSON.stringify(detail.body).includes('password'), false);
    const audit = await AuditLog.findOne({ targetId: created.body.id }).lean();
    assert.deepEqual(audit?.before, { status: 'pending' });
    assert.deepEqual(audit?.after, { status: 'approved' });
    assert.equal(audit?.actorId, staff.user.id);
    assert.equal(JSON.stringify(audit).includes(TEST_PASSWORD), false);
  });
});

test('strict registration validation prevents role injection, invalid credentials and duplicates', async () => {
  await withServer(testApp(), async (url) => {
    const client = api(url);
    for (const extra of [
      { status: 'approved' },
      { isPlatformAdmin: true },
      { email: 'invalid' },
      { username: 'has@at' },
      { password: 'short' },
      { password: 'x'.repeat(129) },
    ]) {
      assert.equal(
        (await client.post('/v1/auth/register', { ...registration, ...extra })).status,
        400,
      );
    }
    assert.equal(await User.countDocuments(), 0);
    const results = await Promise.all(
      [1, 2].map(() => client.post('/v1/auth/register', registration)),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(
      (
        await client.post('/v1/auth/register', {
          ...registration,
          email: 'FARMER@example.test',
          username: 'different',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await client.post('/v1/auth/register', {
          ...registration,
          email: 'different@example.test',
          username: 'farmer_1',
        })
      ).status,
      409,
    );
    assert.equal(await User.countDocuments(), 1);
  });
});

test('rejection is enforced and stale reviewers cannot overwrite a decision', async () => {
  await withServer(testApp(), async (url) => {
    const created = await api(url).post<Registered>('/v1/auth/register', registration);
    const staff = await signIn(url, 'staff');
    await makePlatformAdmin(staff.user.id);
    const client = api(url, staff.accessToken);
    const path = `/v1/admin/users/${created.body.id}/approval`;
    assert.equal(
      (await client.patch(path, { status: 'rejected', expectedStatus: 'pending' })).status,
      200,
    );
    const rejected = await api(url).post<ErrorBody>('/v1/auth/login', login);
    assert.equal(rejected.body.error.code, 'account_rejected');
    assert.equal(
      (await client.patch(path, { status: 'approved', expectedStatus: 'pending' })).status,
      409,
    );
    assert.equal(
      (await client.patch(path, { status: 'approved', expectedStatus: 'rejected' })).status,
      200,
    );
    assert.equal(
      (
        await client.patch(`/v1/admin/users/${staff.user.id}/approval`, {
          status: 'rejected',
          expectedStatus: 'pending',
        })
      ).status,
      403,
    );
    assert.equal(
      (await client.get<{ total: number }>('/v1/admin/users?status=pending')).body.total,
      0,
    );
  });
});

test('approval audit failure restores the prior decision and review metadata', async (t) => {
  await withServer(testApp(), async (url) => {
    const created = await api(url).post<Registered>('/v1/auth/register', registration);
    const staff = await signIn(url, 'staff');
    await makePlatformAdmin(staff.user.id);
    const reviewedAt = new Date('2026-01-01');
    await User.updateOne(
      { _id: created.body.id },
      { $set: { status: 'rejected', reviewedAt, reviewedBy: staff.user.id } },
    );
    t.mock.method(AuditLog, 'create', async () => {
      throw new Error('Audit unavailable');
    });
    const result = await api(url, staff.accessToken).patch(
      `/v1/admin/users/${created.body.id}/approval`,
      { status: 'approved', expectedStatus: 'rejected' },
    );
    assert.equal(result.status, 500);
    const user = await User.findById(created.body.id).lean();
    assert.equal(user?.status, 'rejected');
    assert.equal(user?.reviewedAt?.toISOString(), reviewedAt.toISOString());
    assert.equal(user?.reviewedBy, staff.user.id);
  });
});

test('access and refresh tokens cannot bypass the current approval status', async () => {
  await withServer(testApp(), async (url) => {
    const session = await signIn(url, 'legacy');
    await User.updateOne({ _id: session.user.id }, { $set: { status: 'pending' } });
    assert.equal((await api(url, session.accessToken).get('/v1/auth/me')).status, 401);
    assert.equal(
      (
        await api(url).post('/v1/auth/refresh', {
          refreshToken: session.refreshToken,
          deviceId: TEST_DEVICE,
        })
      ).status,
      401,
    );
    assert.equal(
      await RefreshToken.countDocuments({ userId: session.user.id, revokedAt: null }),
      0,
    );
    for (const path of ['/v1/auth/otp/request', '/v1/auth/otp/verify']) {
      assert.equal(
        (await api(url).post(path, { phone: '+970590000000', code: '123456' })).status,
        404,
      );
    }
  });
});

test('password guessing limits are shared by independent application instances', async () => {
  await withServer(testApp(), async (first) =>
    withServer(testApp(), async (second) => {
      for (let i = 0; i < 10; i++) {
        assert.equal(
          (
            await api(i % 2 ? first : second).post('/v1/auth/login', {
              ...login,
              password: 'wrong',
            })
          ).status,
          401,
        );
      }
      assert.equal((await api(second).post('/v1/auth/login', login)).status, 429);
    }),
  );
});
