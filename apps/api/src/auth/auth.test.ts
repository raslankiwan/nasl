import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signIn, testApp, TEST_DEVICE, withServer } from '../testing/harness.ts';

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
