import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signIn, testApp, TEST_DEVICE, withServer } from '../testing/harness.ts';

interface ChallengeBody {
  challengeId: string;
  expiresAt: string;
  devCode: string;
}
interface SessionBody {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string | null; locale: string };
}
interface ErrorBody {
  error: { code: string; message: string };
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

describe('phone sign-in', () => {
  test('a first sign-in creates the account and returns a session', async () => {
    await withServer(testApp(), async (url) => {
      const session = await signIn(url, '+966501234567', 'أبو سعد');
      assert.ok(session.accessToken);
      assert.ok(session.refreshToken);
      assert.equal(session.user.name, 'أبو سعد');
      assert.equal(session.user.locale, 'ar', 'Arabic is the default locale');
    });
  });

  test('a phone number must be in international format', async () => {
    await withServer(testApp(), async (url) => {
      const res = await api(url).post<ErrorBody>('/v1/auth/otp/request', { phone: '0501234567' });
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /international format/);
    });
  });

  test('a wrong code is rejected', async () => {
    await withServer(testApp(), async (url) => {
      const client = api(url);
      const challenge = await client.post<ChallengeBody>('/v1/auth/otp/request', {
        phone: '+966501234567',
      });
      const res = await client.post<ErrorBody>('/v1/auth/otp/verify', {
        challengeId: challenge.body.challengeId,
        code: '000000',
        deviceId: TEST_DEVICE,
      });
      assert.equal(res.status, 400);
    });
  });

  test('a code cannot be redeemed twice', async () => {
    await withServer(testApp(), async (url) => {
      const client = api(url);
      const challenge = await client.post<ChallengeBody>('/v1/auth/otp/request', {
        phone: '+966501234567',
      });
      const body = {
        challengeId: challenge.body.challengeId,
        code: challenge.body.devCode,
        deviceId: TEST_DEVICE,
      };
      assert.equal((await client.post('/v1/auth/otp/verify', body)).status, 200);
      assert.equal((await client.post('/v1/auth/otp/verify', body)).status, 400);
    });
  });

  test('every failure returns the same message, so the endpoint is not a phone oracle', async () => {
    await withServer(testApp(), async (url) => {
      const client = api(url);
      const unknownChallenge = await client.post<ErrorBody>('/v1/auth/otp/verify', {
        challengeId: '00000000-0000-4000-8000-000000000000',
        code: '123456',
        deviceId: TEST_DEVICE,
      });
      const challenge = await client.post<ChallengeBody>('/v1/auth/otp/request', {
        phone: '+966501234567',
      });
      const wrongCode = await client.post<ErrorBody>('/v1/auth/otp/verify', {
        challengeId: challenge.body.challengeId,
        code: '000000',
        deviceId: TEST_DEVICE,
      });
      assert.equal(unknownChallenge.body.error.message, wrongCode.body.error.message);
    });
  });

  test('admin and mobile can sign in repeatedly from the same network', async () => {
    await withServer(testApp(), async (url) => {
      for (let i = 0; i < 8; i += 1) {
        const session = await signIn(url, i % 2 === 0 ? '+970590000001' : '+970590000002');
        assert.ok(session.accessToken);
      }
    });
  });

  test('SMS requests are limited per normalised phone, without blocking verification or other phones', async () => {
    await withServer(testApp(), async (url) => {
      const client = api(url);
      let challenge: ChallengeBody;
      for (let i = 0; i < 5; i += 1) {
        const res = await client.post<ChallengeBody>('/v1/auth/otp/request', {
          phone: i % 2 === 0 ? '+970590000002' : '+970 590-000-002',
        });
        assert.equal(res.status, 201);
        challenge = res.body;
      }
      const limited = await fetch(`${url}/v1/auth/otp/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '+970590000002' }),
      });
      assert.equal(limited.status, 429);
      assert.equal(((await limited.json()) as ErrorBody).error.code, 'rate_limited');
      assert.ok(Number(limited.headers.get('retry-after')) > 0);

      assert.equal(
        (
          await client.post('/v1/auth/otp/verify', {
            challengeId: challenge!.challengeId,
            code: challenge!.devCode,
            deviceId: TEST_DEVICE,
          })
        ).status,
        200,
        'the last issued code can still be redeemed',
      );
      assert.ok((await signIn(url, '+970590000001')).accessToken);
    });
  });

  test('a flood of SMS requests across different phones is still limited by network', async () => {
    await withServer(testApp(), async (url) => {
      const client = api(url);
      for (let i = 0; i < 30; i += 1) {
        const res = await client.post('/v1/auth/otp/request', {
          phone: '+970590001' + String(i).padStart(3, '0'),
        });
        assert.equal(res.status, 201);
      }
      const limited = await client.post<ErrorBody>('/v1/auth/otp/request', {
        phone: '+970590001999',
      });
      assert.equal(limited.status, 429);
      assert.equal(limited.body.error.code, 'rate_limited');
    });
  });

  test('a challenge still locks after five wrong guesses', async () => {
    await withServer(testApp(), async (url) => {
      const client = api(url);
      const { body: challenge } = await client.post<ChallengeBody>('/v1/auth/otp/request', {
        phone: '+970590000002',
      });
      const wrongCode = challenge.devCode === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i += 1) {
        const res = await client.post('/v1/auth/otp/verify', {
          challengeId: challenge.challengeId,
          code: wrongCode,
          deviceId: TEST_DEVICE,
        });
        assert.equal(res.status, 400);
      }
      const locked = await client.post('/v1/auth/otp/verify', {
        challengeId: challenge.challengeId,
        code: challenge.devCode,
        deviceId: TEST_DEVICE,
      });
      assert.equal(locked.status, 400);
      assert.ok((await signIn(url, '+970590000002')).accessToken, 'a fresh code allows recovery');
    });
  });

  test('a flood of failed verifications is limited separately from requesting codes', async () => {
    await withServer(testApp(), async (url) => {
      const client = api(url);
      const body = { challengeId: 'unknown-challenge', code: '123456', deviceId: TEST_DEVICE };
      for (let i = 0; i < 60; i += 1) {
        assert.equal((await client.post('/v1/auth/otp/verify', body)).status, 400);
      }
      assert.equal((await client.post('/v1/auth/otp/verify', body)).status, 429);
      assert.equal(
        (await client.post('/v1/auth/otp/request', { phone: '+970590000002' })).status,
        201,
      );
    });
  });
});

describe('refresh token rotation', () => {
  test('a session still renews after more than a day without signing in again', async (t) => {
    await withServer(testApp(), async (url) => {
      const session = await signIn(url, '+970592320299');
      t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 25 * 60 * 60_000 });
      const stale = await api(url, session.accessToken).get('/v1/auth/me');
      assert.equal(stale.status, 401);
      const refreshed = await api(url).post<SessionBody>('/v1/auth/refresh', {
        refreshToken: session.refreshToken,
        deviceId: TEST_DEVICE,
      });
      assert.equal(refreshed.status, 200);
      const me = await api(url, refreshed.body.accessToken).get<{ id: string }>('/v1/auth/me');
      assert.equal(me.status, 200);
      assert.equal(me.body.id, session.user.id);
    });
  });

  test('refreshing returns a new pair and retires the old token', async () => {
    await withServer(testApp(), async (url) => {
      const session = await signIn(url, '+966501234567');
      const client = api(url);

      const refreshed = await client.post<SessionBody>('/v1/auth/refresh', {
        refreshToken: session.refreshToken,
        deviceId: TEST_DEVICE,
      });
      assert.equal(refreshed.status, 200);
      assert.notEqual(refreshed.body.refreshToken, session.refreshToken, 'tokens rotate');

      const reused = await client.post<ErrorBody>('/v1/auth/refresh', {
        refreshToken: session.refreshToken,
        deviceId: TEST_DEVICE,
      });
      assert.equal(reused.status, 401, 'the retired token is dead');
    });
  });

  test('reusing a retired token revokes the whole family', async () => {
    await withServer(testApp(), async (url) => {
      const session = await signIn(url, '+966501234567');
      const client = api(url);

      const second = await client.post<SessionBody>('/v1/auth/refresh', {
        refreshToken: session.refreshToken,
        deviceId: TEST_DEVICE,
      });

      // A copied token being replayed is the signal that the device was compromised.
      await client.post('/v1/auth/refresh', {
        refreshToken: session.refreshToken,
        deviceId: TEST_DEVICE,
      });

      const afterBreach = await client.post<ErrorBody>('/v1/auth/refresh', {
        refreshToken: second.body.refreshToken,
        deviceId: TEST_DEVICE,
      });
      assert.equal(afterBreach.status, 401, 'the live token is revoked too');
    });
  });

  test('a refresh token is bound to the device that received it', async () => {
    await withServer(testApp(), async (url) => {
      const session = await signIn(url, '+966501234567');
      const res = await api(url).post<ErrorBody>('/v1/auth/refresh', {
        refreshToken: session.refreshToken,
        deviceId: 'another-device-9999',
      });
      assert.equal(res.status, 401);
    });
  });
});

describe('authenticated identity', () => {
  test('/me requires a token and returns the caller with their farms', async () => {
    await withServer(testApp(), async (url) => {
      assert.equal((await api(url).get('/v1/auth/me')).status, 401);

      const session = await signIn(url, '+966501234567', 'أبو سعد');
      const client = api(url, session.accessToken);
      const me = await client.get<{ id: string; name: string; farms: unknown[] }>('/v1/auth/me');

      assert.equal(me.status, 200);
      assert.equal(me.body.name, 'أبو سعد');
      assert.deepEqual(me.body.farms, [], 'a new user belongs to no farm yet');
      const response = await fetch(`${url}/v1/auth/me`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });
  });

  test('a malformed token is rejected', async () => {
    await withServer(testApp(), async (url) => {
      const res = await api(url, 'not-a-jwt').get<ErrorBody>('/v1/auth/me');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'unauthorized');
    });
  });
});
