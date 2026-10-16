import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, testApp, testConfig, withServer } from '../testing/harness.ts';
import { createChallenge, verifyChallenge } from './otp.ts';
import { mongoRateLimitStore } from './rateLimitStore.ts';
import { OtpChallenge } from '../models/otpChallenge.model.ts';
import { RateLimit } from '../models/rateLimit.model.ts';
import { sendOtpSms } from './sms.ts';

before(() => startTestMongo());
after(stopTestMongo);
beforeEach(clearDatabase);

test('independent API instances share a phone request budget', async () => {
  await withServer(testApp(), async (first) => {
    await withServer(testApp(), async (second) => {
      for (let i = 0; i < 5; i++) {
        assert.equal(
          (
            await api(i % 2 ? first : second).post('/v1/auth/otp/request', {
              phone: '+970590000001',
            })
          ).status,
          201,
        );
      }
      assert.equal(
        (await api(second).post('/v1/auth/otp/request', { phone: '+970590000001' })).status,
        429,
      );
    });
  });
});

test('concurrent rate-limit updates are counted and expired counters reset before TTL deletion', async () => {
  const first = mongoRateLimitStore('test');
  const second = mongoRateLimitStore('test');
  const hits = await Promise.all(
    Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).increment('client')),
  );
  assert.equal(Math.max(...hits.map((hit) => hit.totalHits)), 20);
  await RateLimit.updateMany({}, { $set: { expiresAt: new Date(0) } });
  assert.equal((await first.increment('client')).totalHits, 1);
});

test('a correct OTP is consumed by only one concurrent request', async () => {
  const challenge = await createChallenge('+970590000001', 5, true);
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => verifyChallenge(challenge.challengeId, challenge.devCode!, 5)),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
});

test('failed delivery removes the challenge', async () => {
  await assert.rejects(
    createChallenge('+970590000001', 5, false, async () => {
      throw new Error('Delivery failed');
    }),
  );
  assert.equal(await OtpChallenge.countDocuments(), 0);
});

test('disabled sign-in returns no development code and creates no challenge', async () => {
  await withServer(testApp({ NODE_ENV: 'production', SMS_PROVIDER: 'disabled' }), async (url) => {
    const response = await api(url).post<{ error: { code: string }; devCode?: string }>(
      '/v1/auth/otp/request',
      { phone: '+970590000001' },
    );
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'sign_in_unavailable');
    assert.equal(response.body.devCode, undefined);
    assert.equal(await OtpChallenge.countDocuments(), 0);
  });
});

test('production CORS only allows configured origins and responses are never CDN cached', async () => {
  await withServer(
    testApp({ NODE_ENV: 'production', CORS_ORIGINS: 'https://nasl.example' }),
    async (url) => {
      const allowed = await fetch(`${url}/health`, { headers: { origin: 'https://nasl.example' } });
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://nasl.example');
      assert.match(allowed.headers.get('cache-control')!, /no-store/);
      const denied = await fetch(`${url}/health`, { headers: { origin: 'https://other.example' } });
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
    },
  );
});

test('Twilio sends a short code and does not expose provider errors', async (t) => {
  const config = testConfig({
    SMS_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: 'ACexample',
    TWILIO_AUTH_TOKEN: 'secret',
    TWILIO_FROM_NUMBER: '+15550000000',
  });
  const calls: RequestInit[] = [];
  const mocked = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls.push(init);
    return new Response('{}', { status: 201 });
  });
  await sendOtpSms(config, '+970590000001', '123456');
  assert.equal((calls[0]?.body as URLSearchParams).get('Body'), 'Nasl: 123456');
  assert.equal((calls[0]?.body as URLSearchParams).get('To'), '+970590000001');
  mocked.mock.mockImplementation(
    async () => new Response('secret provider error', { status: 401 }),
  );
  await assert.rejects(sendOtpSms(config, '+970590000001', '123456'), /Unable to send/);
});
