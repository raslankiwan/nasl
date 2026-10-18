import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { startTestMongo, stopTestMongo, clearDatabase } from '../testing/mongo.ts';
import {
  api,
  signIn,
  makePlatformAdmin,
  testApp,
  TEST_PASSWORD,
  TEST_DEVICE,
} from '../testing/harness.ts';
import { withServer } from '../testing/harness.ts';
import { AdminInvitation } from '../models/adminInvitation.model.ts';
import { User } from '../models/user.model.ts';
import { AuditLog } from '../models/auditLog.model.ts';
import { seedFirstAdmin, invitationHash } from '../services/adminInvitations.service.ts';
import type { InvitationMessage } from './invitationEmail.ts';

before(() => startTestMongo(true));
after(stopTestMongo);
beforeEach(clearDatabase);
const origin = 'https://console.example.test';
const config = { NODE_ENV: 'production', ADMIN_APP_URL: origin } as const;
const first = {
  name: 'First Operator',
  email: 'first@example.test',
  username: 'firstoperator',
  locale: 'en' as const,
};
const acceptPath = '/v1/auth/admin-invitations/accept';
const inspectPath = '/v1/auth/admin-invitations/inspect';
const tokenOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('token')!;
type InvitationResult = { id: string; email: string; state: string };

test('seed creates the first approved admin directly, has no default password, and only the one-use setup activates it', async () => {
  const setupPassword = 'testpass';
  const seeded = await seedFirstAdmin(first, origin, true);
  assert.ok(seeded.setupUrl);
  const user = await User.findById(seeded.id).select('+passwordHash').lean();
  assert.equal(user?.isPlatformAdmin, true);
  assert.equal(user?.status, 'approved');
  assert.equal(user?.passwordHash, undefined);
  const again = await seedFirstAdmin(first, origin, true);
  assert.equal(again.id, seeded.id);
  assert.equal(again.setupUrl, undefined);
  assert.equal(await User.countDocuments(), 1);
  const token = tokenOf(seeded.setupUrl);
  await withServer(testApp(config), async (url) => {
    const client = api(url);
    assert.equal(
      (
        await client.post('/v1/auth/login', {
          identifier: first.email,
          password: TEST_PASSWORD,
          deviceId: TEST_DEVICE,
        })
      ).status,
      401,
    );
    assert.equal(
      (await client.post('/v1/auth/register', { ...first, password: TEST_PASSWORD })).status,
      409,
    );
    const info = await client.post<{ seeded: boolean; email: string; username: string }>(
      inspectPath,
      { token },
    );
    assert.equal(info.body.seeded, true);
    assert.equal(info.body.email, first.email);
    assert.equal(info.body.username, first.username);
    assert.equal((await client.post(acceptPath, { token, password: '1234567' })).status, 400);
    assert.equal((await client.post(acceptPath, { token, password: setupPassword })).status, 200);
    assert.equal((await client.post(acceptPath, { token, password: setupPassword })).status, 400);
    const session = await client.post<{ accessToken: string }>('/v1/auth/login', {
      identifier: first.username,
      password: setupPassword,
      deviceId: TEST_DEVICE,
    });
    assert.equal(session.status, 200);
    assert.equal((await api(url, session.body.accessToken).get('/v1/admin/users')).status, 200);
    assert.equal(
      (await seedFirstAdmin(first, origin, true, true)).setupUrl,
      undefined,
      'rerunning seed never resets an active password',
    );
  });
});

test('reissuing unused seed setup revokes the previous link; existing users and later admins cannot be seeded', async () => {
  const one = await seedFirstAdmin(first, origin, true);
  const two = await seedFirstAdmin(first, origin, true, true);
  assert.notEqual(one.setupUrl, two.setupUrl);
  await assert.rejects(
    seedFirstAdmin({ ...first, email: 'second@example.test', username: 'second' }, origin, true),
    /first administrator already exists/,
  );
  await withServer(testApp(config), async (url) => {
    assert.equal((await api(url).post(inspectPath, { token: tokenOf(one.setupUrl!) })).status, 400);
    assert.equal((await api(url).post(inspectPath, { token: tokenOf(two.setupUrl!) })).status, 200);
    const existing = await signIn(url, 'existing');
    const user = await User.findById(existing.user.id).lean();
    await assert.rejects(
      seedFirstAdmin({ ...first, email: user!.email }, origin, true),
      /will not overwrite/,
    );
  });
});

async function inviteFixture(
  url: string,
  messages: InvitationMessage[],
  email = 'new@example.test',
) {
  const staff = await signIn(url, 'staff');
  await makePlatformAdmin(staff.user.id);
  const client = api(url, staff.accessToken);
  const response = await client.post<InvitationResult>('/v1/admin/invitations', {
    email,
    locale: 'en',
  });
  assert.equal(response.status, 201);
  return { staff, client, response, token: tokenOf(messages.at(-1)!.url) };
}

test('only staff can send invites; the emailed token binds the recipient and is never returned by admin APIs', async () => {
  const messages: InvitationMessage[] = [];
  await withServer(
    testApp(config, async (message) => {
      messages.push(message);
    }),
    async (url) => {
      const regular = await signIn(url, 'regular');
      for (const [client, status] of [
        [api(url), 401],
        [api(url, regular.accessToken), 404],
      ] as const) {
        assert.equal(
          (await client.post('/v1/admin/invitations', { email: 'new@example.test' })).status,
          status,
        );
        assert.equal((await client.get('/v1/admin/invitations')).status, status);
      }
      const { client, response, token } = await inviteFixture(url, messages);
      assert.equal(messages[0]?.email, 'new@example.test');
      assert.equal(await User.findOne({ email: 'new@example.test' }).lean(), null);
      const raw = await AdminInvitation.findById(response.body.id).select('+tokenHash').lean();
      assert.equal(raw?.tokenHash, invitationHash(token));
      assert.equal(JSON.stringify(response.body).includes(token), false);
      assert.equal(
        JSON.stringify((await client.get('/v1/admin/invitations')).body).includes(token),
        false,
      );
      const input = {
        token,
        name: 'Invited Operator',
        username: 'invitedoperator',
        password: TEST_PASSWORD,
      };
      assert.equal(
        (await api(url).post(acceptPath, { ...input, email: 'attacker@example.test' })).status,
        400,
      );
      assert.equal(
        (await api(url).post(acceptPath, { ...input, isPlatformAdmin: true })).status,
        400,
      );
      const accepted = await api(url).post<{ id: string }>(acceptPath, input);
      assert.equal(accepted.status, 200);
      const operator = await User.findById(accepted.body.id).lean();
      assert.equal(operator?.email, messages[0]?.email);
      assert.equal(operator?.isPlatformAdmin, true);
      assert.equal(operator?.status, 'approved');
      assert.equal((await api(url).post(acceptPath, input)).status, 400);
      assert.equal(await AuditLog.countDocuments({ action: 'admin.invitation.accept' }), 1);
      assert.equal(JSON.stringify(await AuditLog.find().lean()).includes(token), false);
    },
  );
});

test('an existing account must prove its current password; an invitation cannot reset a squatted account and elevate its old password', async () => {
  const messages: InvitationMessage[] = [];
  await withServer(
    testApp(config, async (message) => {
      messages.push(message);
    }),
    async (url) => {
      const regular = await signIn(url, 'regular');
      const user = await User.findById(regular.user.id).select('+passwordHash').lean();
      await User.updateOne({ _id: user!._id }, { $set: { status: 'pending' } });
      const { token } = await inviteFixture(url, messages, user!.email);
      assert.equal(
        (await api(url).post(acceptPath, { token, password: 'replacement-password-123' })).status,
        400,
      );
      assert.equal((await User.findById(user!._id).lean())?.isPlatformAdmin, false);
      assert.equal(
        (await api(url).post(acceptPath, { token, password: TEST_PASSWORD })).status,
        200,
      );
      assert.equal(
        (await User.findById(user!._id).select('+passwordHash').lean())?.passwordHash,
        user!.passwordHash,
      );
    },
  );
});

test('missing email configuration and delivery failure never produce a usable invitation', async () => {
  await withServer(testApp(config), async (url) => {
    const staff = await signIn(url, 'staff');
    await makePlatformAdmin(staff.user.id);
    const client = api(url, staff.accessToken);
    assert.equal(
      (await client.post('/v1/admin/invitations', { email: 'new@example.test' })).status,
      503,
    );
    assert.equal(await AdminInvitation.countDocuments(), 0);
  });
  const messages: InvitationMessage[] = [];
  await withServer(
    testApp(config, async (message) => {
      messages.push(message);
      throw new Error('Delivery failed');
    }),
    async (url) => {
      const staff = await signIn(url, 'staff');
      const client = api(url, staff.accessToken);
      assert.equal(
        (await client.post('/v1/admin/invitations', { email: 'new@example.test' })).status,
        503,
      );
      assert.equal((await AdminInvitation.findOne().lean())?.state, 'failed');
      assert.equal(
        (await api(url).post(inspectPath, { token: tokenOf(messages[0]!.url) })).status,
        400,
      );
    },
  );
});

test('revoked, expired and invalidated-inviter links cannot grant access', async () => {
  const messages: InvitationMessage[] = [];
  await withServer(
    testApp(config, async (message) => {
      messages.push(message);
    }),
    async (url) => {
      const one = await inviteFixture(url, messages);
      assert.equal(
        (await one.client.post(`/v1/admin/invitations/${one.response.body.id}/revoke`)).status,
        200,
      );
      assert.equal((await api(url).post(inspectPath, { token: one.token })).status, 400);
      const two = await inviteFixture(url, messages);
      await AdminInvitation.updateOne(
        { _id: two.response.body.id },
        { $set: { expiresAt: new Date(0) } },
      );
      assert.equal((await api(url).post(inspectPath, { token: two.token })).status, 400);
      const three = await inviteFixture(url, messages);
      await User.updateOne({ _id: three.staff.user.id }, { $set: { isPlatformAdmin: false } });
      assert.equal(
        (
          await api(url).post(acceptPath, {
            token: three.token,
            name: 'Operator',
            username: 'operator',
            password: TEST_PASSWORD,
          })
        ).status,
        400,
      );
      assert.equal(await User.countDocuments({ email: 'new@example.test' }), 0);
    },
  );
});

test('concurrent redemption has one winner; audit failure rolls back account creation and token consumption', async (t) => {
  const messages: InvitationMessage[] = [];
  await withServer(
    testApp(config, async (message) => {
      messages.push(message);
    }),
    async (url) => {
      const { token, response } = await inviteFixture(url, messages);
      const input = { token, name: 'Operator', username: 'operator', password: TEST_PASSWORD };
      const audit = t.mock.method(AuditLog, 'create', async () => {
        throw new Error('Audit failed');
      });
      assert.equal((await api(url).post(acceptPath, input)).status, 500);
      assert.equal(await User.countDocuments({ email: 'new@example.test' }), 0);
      assert.equal((await AdminInvitation.findById(response.body.id).lean())?.state, 'sent');
      audit.mock.restore();
      const results = await Promise.all([1, 2].map(() => api(url).post(acceptPath, input)));
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
      assert.equal(await User.countDocuments({ email: 'new@example.test' }), 1);
      assert.equal(await AuditLog.countDocuments({ action: 'admin.invitation.accept' }), 1);
    },
  );
});

test('public signup remains pending and cannot claim seed or invitation privileges', async () => {
  await withServer(testApp(config), async (url) => {
    const input = {
      name: 'Farmer',
      email: 'farmer@example.test',
      username: 'farmer',
      password: TEST_PASSWORD,
    };
    assert.equal(
      (await api(url).post('/v1/auth/register', { ...input, adminProvisionedBy: 'seed' })).status,
      400,
    );
    const registered = await api(url).post<{ id: string }>('/v1/auth/register', input);
    assert.equal(registered.status, 201);
    const user = await User.findById(registered.body.id).lean();
    assert.equal(user?.status, 'pending');
    assert.equal(user?.isPlatformAdmin, false);
  });
});
