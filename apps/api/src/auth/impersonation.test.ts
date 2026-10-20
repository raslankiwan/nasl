import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestMongo, stopTestMongo, clearDatabase } from '../testing/mongo.ts';
import { api, signIn, signInWithFarm, testApp, withServer } from '../testing/harness.ts';
import { User } from '../models/user.model.ts';
import { Animal } from '../models/animal.model.ts';
import { AuditLog } from '../models/auditLog.model.ts';
import { ImpersonationSession } from '../models/impersonationSession.model.ts';
import { Membership } from '../models/membership.model.ts';

before(() => startTestMongo());
after(stopTestMongo);
beforeEach(clearDatabase);
const origin = 'https://nasl-app.example.test';
const app = () => testApp({ USER_APP_URL: origin, ADMIN_APP_URL: 'https://admin.example.test' });
async function setup(url: string) {
  const admin = await signIn(url, 'supportadmin');
  await User.updateOne({ _id: admin.user.id }, { $set: { isPlatformAdmin: true } });
  const user = await signInWithFarm(url, 'supportfarmer');
  const launched = await api(url, admin.accessToken).post<{ url: string }>(
    `/v1/admin/users/${user.session.user.id}/impersonation`,
    { reason: 'Investigate animal entry' },
  );
  assert.equal(launched.status, 201);
  const code = new URLSearchParams(new URL(launched.body.url).hash.slice(1)).get('impersonation');
  const exchange = (requestOrigin = origin) =>
    fetch(`${url}/v1/auth/impersonation/exchange`, {
      method: 'POST',
      headers: { origin: requestOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  return { admin, user, exchange };
}

test('only an administrator can start support; one-use code grants audited target permissions and no refresh token', async () => {
  await withServer(app(), async (url) => {
    const { admin, user, exchange } = await setup(url);
    assert.equal(
      (
        await api(url, user.session.accessToken).post(
          `/v1/admin/users/${admin.user.id}/impersonation`,
          { reason: 'Denied' },
        )
      ).status,
      404,
    );
    assert.equal((await exchange('https://untrusted.test')).status, 403);
    const response = await exchange();
    const session = (await response.json()) as { accessToken: string; refreshToken?: string };
    assert.equal(response.status, 200);
    assert.equal(session.refreshToken, undefined);
    assert.equal((await exchange()).status, 401);
    const client = api(url, session.accessToken);
    const me = await client.get<{ id: string; impersonation: { adminId: string } }>('/v1/auth/me');
    assert.equal(me.body.id, user.session.user.id);
    assert.equal(me.body.impersonation.adminId, admin.user.id);
    const created = await client.post<{ id: string }>(`/v1/farms/${user.farmId}/animals`, {
      species: 'sheep',
      sex: 'female',
      name: 'Support edit',
    });
    assert.equal(created.status, 201);
    const change = await AuditLog.findOne({ action: 'impersonation.change.requested' }).lean();
    assert.equal(change?.actorId, admin.user.id);
    assert.equal(change?.targetId, user.session.user.id);
    assert.equal((change?.after as { input: { name: string } }).input.name, 'Support edit');
    const outcome = await AuditLog.findOne({ action: 'impersonation.change.completed' }).lean();
    assert.equal((outcome?.after as { status: number }).status, 201);
    assert.equal((await client.get('/v1/admin/stats')).status, 403);
    assert.equal((await client.post('/v1/auth/sign-out-everywhere')).status, 403);
    assert.equal((await client.get('/v1/auth/passkeys')).status, 403);
    const other = await signInWithFarm(url, 'otherfarmer');
    assert.equal((await client.get(`/v1/farms/${other.farmId}/animals`)).status, 403);
    assert.equal((await client.post('/v1/auth/impersonation/end')).status, 204);
    assert.equal((await client.get('/v1/auth/me')).status, 401);
    assert.equal((await api(url, admin.accessToken).get('/v1/admin/stats')).status, 200);
  });
});

test('support writes fail closed when the audit store is unavailable; viewers retain their role', async (t) => {
  await withServer(app(), async (url) => {
    const { user, exchange } = await setup(url);
    const session = (await (await exchange()).json()) as { accessToken: string };
    const client = api(url, session.accessToken);
    const path = `/v1/farms/${user.farmId}/animals`;
    const broken = t.mock.method(AuditLog, 'create', async () => {
      throw new Error('audit unavailable');
    });
    assert.equal((await client.post(path, { species: 'sheep', sex: 'female' })).status, 500);
    assert.equal(await Animal.countDocuments(), 0);
    broken.mock.restore();
    await Membership.updateOne(
      { userId: user.session.user.id, farmId: user.farmId },
      { $set: { role: 'viewer' } },
    );
    assert.equal((await client.post(path, { species: 'sheep', sex: 'female' })).status, 403);
    assert.equal((await client.get(path)).status, 200);
  });
});

test('expiry, target rejection and administrator demotion revoke support immediately', async () => {
  for (const change of ['expiry', 'target', 'admin']) {
    await clearDatabase();
    await withServer(app(), async (url) => {
      const { admin, user, exchange } = await setup(url);
      const session = (await (await exchange()).json()) as { accessToken: string };
      if (change === 'expiry')
        await ImpersonationSession.updateMany({}, { $set: { expiresAt: new Date(0) } });
      if (change === 'target')
        await User.updateOne({ _id: user.session.user.id }, { $set: { status: 'rejected' } });
      if (change === 'admin')
        await User.updateOne({ _id: admin.user.id }, { $set: { isPlatformAdmin: false } });
      assert.equal((await api(url, session.accessToken).get('/v1/auth/me')).status, 401);
    });
  }
});
