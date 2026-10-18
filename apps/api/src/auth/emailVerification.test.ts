import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import {
  api,
  makePlatformAdmin,
  signIn,
  testApp,
  testConfig,
  TEST_DEVICE,
  TEST_PASSWORD,
  verificationMessages,
  withServer,
} from '../testing/harness.ts';
import { User } from '../models/user.model.ts';
import { EmailVerification } from '../models/emailVerification.model.ts';
import { createApp } from '../app.ts';
import { createLogger } from '../logger.ts';
import { verificationMailer } from './verificationEmail.ts';
import { AppError } from '../errors.ts';

before(() => startTestMongo());
after(stopTestMongo);
beforeEach(async () => {
  await clearDatabase();
  verificationMessages.length = 0;
});
const profile = {
  name: 'Farmer',
  email: 'verify@example.test',
  username: 'verify',
  password: TEST_PASSWORD,
};
type Registered = { id: string; verificationId: string; verificationSent: boolean };
const register = (url: string) => api(url).post<Registered>('/v1/auth/register', profile);
const confirm = (url: string, id: string, code = verificationMessages.at(-1)!.code) =>
  api(url).post('/v1/auth/email/verify', { verificationId: id, code });

test('verification is single-use and does not replace administrator approval', async () => {
  await withServer(testApp(), async (url) => {
    const { body } = await register(url);
    assert.ok(body.verificationSent);
    assert.equal(JSON.stringify(body).includes(verificationMessages.at(-1)!.code), false);
    const staff = await signIn(url, 'reviewer');
    await makePlatformAdmin(staff.user.id);
    const admin = api(url, staff.accessToken);
    const approval = { status: 'approved', expectedStatus: 'pending' };
    const path = `/v1/admin/users/${body.id}/approval`;
    assert.equal((await admin.patch(path, approval)).status, 403);
    const stored = await EmailVerification.findOne({ userId: body.id }).lean();
    assert.notEqual(stored!.codeHash, verificationMessages.at(-1)!.code);
    const results = await Promise.all([
      confirm(url, body.verificationId),
      confirm(url, body.verificationId),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    assert.equal((await User.findById(body.id).lean())?.status, 'pending');
    const login = { identifier: profile.email, password: TEST_PASSWORD, deviceId: TEST_DEVICE };
    assert.equal((await api(url).post('/v1/auth/login', login)).status, 403);
    assert.equal((await admin.patch(path, approval)).status, 200);
    assert.equal((await api(url).post('/v1/auth/login', login)).status, 200);
  });
});
test('codes expire and five wrong guesses exhaust a challenge; resend invalidates the old code', async () => {
  await withServer(testApp(), async (url) => {
    const { body } = await register(url);
    const correct = verificationMessages.at(-1)!.code;
    const wrong = correct === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt++)
      assert.equal((await confirm(url, body.verificationId, wrong)).status, 400);
    assert.equal((await confirm(url, body.verificationId, correct)).status, 400);
    await EmailVerification.updateOne({ userId: body.id }, { $set: { sentAt: new Date(0) } });
    const resent = await api(url).post<{ verificationId: string }>('/v1/auth/email/resend', {
      email: profile.email,
    });
    assert.notEqual(resent.body.verificationId, body.verificationId);
    assert.equal((await confirm(url, body.verificationId, correct)).status, 400);
    await EmailVerification.updateOne({ userId: body.id }, { $set: { expiresAt: new Date(0) } });
    assert.equal((await confirm(url, resent.body.verificationId)).status, 400);
  });
});
test('resend cooldown preserves a usable challenge and unknown addresses have the same response shape', async () => {
  await withServer(testApp(), async (url) => {
    const { body } = await register(url);
    const again = await api(url).post<{ verificationId: string }>('/v1/auth/email/resend', {
      email: profile.email,
    });
    assert.equal(again.body.verificationId, body.verificationId);
    assert.equal(verificationMessages.length, 1);
    const unknown = await api(url).post('/v1/auth/email/resend', { email: 'unknown@example.test' });
    assert.equal(unknown.status, again.status);
    assert.deepEqual(Object.keys(unknown.body as object), Object.keys(again.body));
    assert.equal((await confirm(url, again.body.verificationId)).status, 200);
  });
});
test('missing sender fails closed; provider failure retains a pending account for retry without a usable code', async () => {
  await withServer(
    createApp({ config: testConfig(), logger: createLogger('silent', false) }),
    async (url) => {
      assert.equal((await register(url)).status, 503);
      assert.equal(await User.countDocuments(), 0);
    },
  );
  await withServer(
    testApp({}, undefined, async () => {
      throw new Error('provider secret');
    }),
    async (url) => {
      const response = await register(url);
      assert.equal(response.status, 201);
      assert.equal(response.body.verificationSent, false);
      assert.equal(await EmailVerification.countDocuments(), 0);
      assert.equal((await User.findById(response.body.id).lean())?.status, 'pending');
      assert.equal(JSON.stringify(response.body).includes('secret'), false);
    },
  );
});
test('the verification sender uses a bound recipient and never exposes provider failures', async (t) => {
  const messages: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    messages.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ id: 'receipt' }), { status: 200 });
  });
  const sender = verificationMailer(
    testConfig({ RESEND_API_KEY: 'test-key', EMAIL_FROM: 'accounts@example.test' }),
  )!;
  await sender({ id: 'nonce', email: profile.email, code: '123456', locale: 'en' });
  assert.deepEqual(messages[0]!.to, [profile.email]);
  assert.match(String(messages[0]!.text), /123456/);
  t.mock.method(globalThis, 'fetch', async () => new Response('private', { status: 403 }));
  await assert.rejects(
    () => sender({ id: 'nonce2', email: profile.email, code: '654321', locale: 'ar' }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'email_delivery_failed' &&
      !error.message.includes('private'),
  );
});
