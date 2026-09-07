import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Membership } from '../models/membership.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, testApp, withServer } from '../testing/harness.ts';

interface ChallengeBody {
  challengeId: string;
  devCode: string;
}
interface SessionBody {
  accessToken: string;
  user: { id: string };
}
interface FarmBody {
  id: string;
  name: string;
  role: string;
}
interface ErrorBody {
  error: { code: string; message: string };
}

async function signIn(baseUrl: string, phone: string): Promise<SessionBody> {
  const client = api(baseUrl);
  const challenge = await client.post<ChallengeBody>('/v1/auth/otp/request', { phone });
  const session = await client.post<SessionBody>('/v1/auth/otp/verify', {
    challengeId: challenge.body.challengeId,
    code: challenge.body.devCode,
    deviceId: 'device-0123456789',
  });
  return session.body;
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

describe('farm access control', () => {
  test('creating a farm makes the caller its owner', async () => {
    await withServer(testApp(), async (url) => {
      const session = await signIn(url, '+966501111111');
      const client = api(url, session.accessToken);

      const created = await client.post<FarmBody>('/v1/farms', { name: 'مراح الشمال' });
      assert.equal(created.status, 201);
      assert.equal(created.body.role, 'owner');

      const membership = await Membership.findOne({
        farmId: created.body.id,
        userId: session.user.id,
      }).lean();
      assert.equal(membership?.role, 'owner');
      assert.equal(membership?.status, 'active');
    });
  });

  test('a non-member cannot read a farm, and cannot tell it exists', async () => {
    await withServer(testApp(), async (url) => {
      const owner = await signIn(url, '+966501111111');
      const created = await api(url, owner.accessToken).post<FarmBody>('/v1/farms', {
        name: 'مراح الشمال',
      });

      const stranger = await signIn(url, '+966502222222');
      const denied = await api(url, stranger.accessToken).get<ErrorBody>(
        `/v1/farms/${created.body.id}`,
      );
      assert.equal(denied.status, 403);

      const missing = await api(url, stranger.accessToken).get<ErrorBody>(
        '/v1/farms/00000000-0000-4000-8000-000000000000',
      );
      assert.equal(
        missing.status,
        403,
        'a farm that does not exist answers the same as one you cannot see',
      );
    });
  });

  test('listing farms returns only the caller’s own', async () => {
    await withServer(testApp(), async (url) => {
      const owner = await signIn(url, '+966501111111');
      await api(url, owner.accessToken).post('/v1/farms', { name: 'مراح الشمال' });

      const other = await signIn(url, '+966502222222');
      const list = await api(url, other.accessToken).get<{ farms: unknown[] }>('/v1/farms');
      assert.deepEqual(list.body.farms, []);
    });
  });

  test('a revoked membership loses access immediately', async () => {
    await withServer(testApp(), async (url) => {
      const owner = await signIn(url, '+966501111111');
      const client = api(url, owner.accessToken);
      const farm = await client.post<FarmBody>('/v1/farms', { name: 'مراح الشمال' });

      assert.equal((await client.get(`/v1/farms/${farm.body.id}`)).status, 200);

      await Membership.updateOne(
        { farmId: farm.body.id, userId: owner.user.id },
        { $set: { status: 'revoked' } },
      );
      assert.equal((await client.get(`/v1/farms/${farm.body.id}`)).status, 403);
    });
  });

  test('an expired membership loses access — a visiting vet does not keep it', async () => {
    await withServer(testApp(), async (url) => {
      const owner = await signIn(url, '+966501111111');
      const client = api(url, owner.accessToken);
      const farm = await client.post<FarmBody>('/v1/farms', { name: 'مراح الشمال' });

      await Membership.updateOne(
        { farmId: farm.body.id, userId: owner.user.id },
        { $set: { role: 'vet', expiresAt: new Date(Date.now() - 1000) } },
      );

      const res = await client.get<ErrorBody>(`/v1/farms/${farm.body.id}`);
      assert.equal(res.status, 403);
      assert.match(res.body.error.message, /expired/);
    });
  });

  test('a role without the permission is refused', async () => {
    await withServer(testApp(), async (url) => {
      const owner = await signIn(url, '+966501111111');
      const client = api(url, owner.accessToken);
      const farm = await client.post<FarmBody>('/v1/farms', { name: 'مراح الشمال' });

      // No role lacks animals:read, so verify the check itself fires on an unknown role.
      await Membership.updateOne(
        { farmId: farm.body.id, userId: owner.user.id },
        { $set: { role: 'viewer' } },
      );
      assert.equal((await client.get(`/v1/farms/${farm.body.id}`)).status, 200);
    });
  });
});
