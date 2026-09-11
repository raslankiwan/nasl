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

  test('repeated attempts are rate limited', async () => {
    await withServer(testApp(), async (url) => {
      const client = api(url);
      let limited = false;
      for (let i = 0; i < 8; i += 1) {
        const res = await client.post<ErrorBody>('/v1/auth/otp/request', {
          phone: '+96650000000' + (i % 10),
        });
        if (res.status === 429) {
          limited = true;
          break;
        }
      }
      assert.ok(limited, 'the OTP endpoint must refuse a flood of requests');
    });
  });
});

describe('refresh token rotation', () => {
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
