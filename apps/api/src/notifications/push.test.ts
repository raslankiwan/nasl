import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { addDays } from '@nasl/shared';
import { createApp } from '../app.ts';
import { createLogger } from '../logger.ts';
import { api, signInWithFarm, testConfig, withServer } from '../testing/harness.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { Animal } from '../models/animal.model.ts';
import { Membership } from '../models/membership.model.ts';
import { Farm } from '../models/farm.model.ts';
import { User } from '../models/user.model.ts';
import { PushSubscription } from '../models/pushSubscription.model.ts';
import {
  allowedPushEndpoint,
  endpointHash,
  dispatchBirthReminders,
  remindersFor,
  type PushMessage,
} from './push.ts';

const now = new Date('2026-10-18T06:00:00Z');
const vapid = webpush.generateVAPIDKeys();
const config = testConfig({
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'https://nasl-app.vercel.app',
  CRON_SECRET: 'test-cron-secret-at-least-32-characters',
});
const logger = createLogger('silent', false);
const sent: Array<{ userId: string; message: PushMessage }> = [];
const send = async (sub: { userId: string }, message: PushMessage) => {
  sent.push({ userId: sub.userId, message });
};
const app = () => createApp({ config, logger, pushSender: send });
const input = (id = 'one') => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/test-${id}`,
  keys: { p256dh: vapid.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') },
  locale: 'en',
  leadDays: 3,
});
async function fixture(url: string, identity = 'one') {
  const { session, farmId } = await signInWithFarm(url, identity);
  const client = api(url, session.accessToken);
  const animal = await client.post<{ id: string }>(`/v1/farms/${farmId}/animals`, {
    tagNumber: '001',
    species: 'sheep',
    sex: 'female',
  });
  await client.post(`/v1/farms/${farmId}/breeding/matings`, {
    damId: animal.body.id,
    startDate: addDays(now, -142).toISOString().slice(0, 10),
  });
  assert.equal((await client.post('/v1/notifications/subscribe', input(identity))).status, 200);
  return { client, userId: session.user.id, farmId, animalId: animal.body.id };
}
before(async () => {
  await startTestMongo();
});
after(async () => {
  await stopTestMongo();
});
beforeEach(async () => {
  await clearDatabase();
  sent.length = 0;
});

test('push endpoints require approved auth and reject arbitrary URLs and invalid settings', async () => {
  await withServer(app(), async (url) => {
    assert.equal((await api(url).get('/v1/notifications/config')).status, 401);
    const { client, userId } = await fixture(url);
    for (const endpoint of [
      'http://fcm.googleapis.com/x',
      'https://localhost/x',
      'https://169.254.169.254/x',
      'https://fcm.googleapis.com.evil.test/x',
      'https://fcm.googleapis.com:444/x',
    ])
      assert.equal(
        (await client.post('/v1/notifications/subscribe', { ...input(), endpoint })).status,
        400,
      );
    assert.equal(
      (await client.post('/v1/notifications/subscribe', { ...input(), leadDays: 100 })).status,
      400,
    );
    assert.equal(
      (
        await client.post('/v1/notifications/subscribe', {
          ...input(),
          keys: { auth: 'bad', p256dh: 'bad' },
        })
      ).status,
      400,
    );
    await User.updateOne({ _id: userId }, { $set: { status: 'pending' } });
    assert.equal((await client.get('/v1/notifications/config')).status, 401);
    assert.equal(allowedPushEndpoint('https://web.push.apple.com/Q/example'), true);
  });
});
test('an account cannot read, replace, test or disable another device subscription', async () => {
  await withServer(app(), async (url) => {
    await fixture(url, 'one');
    const other = await fixture(url, 'two');
    assert.equal(
      (await other.client.post<{ enabled: boolean }>('/v1/notifications/status', input())).body
        .enabled,
      false,
    );
    assert.equal((await other.client.post('/v1/notifications/subscribe', input())).status, 409);
    assert.equal((await other.client.post('/v1/notifications/test', input())).status, 429);
    await other.client.post('/v1/notifications/disable', input());
    assert.equal(await PushSubscription.countDocuments(), 2);
  });
});
test('dispatch is farm-isolated, batches animals and deduplicates repeated/concurrent runs', async () => {
  await withServer(app(), async (url) => {
    const first = await fixture(url, 'one');
    await fixture(url, 'two');
    const secondAnimal = await first.client.post<{ id: string }>(
      `/v1/farms/${first.farmId}/animals`,
      { tagNumber: '002', species: 'sheep', sex: 'female' },
    );
    await first.client.post(`/v1/farms/${first.farmId}/breeding/matings`, {
      damId: secondAnimal.body.id,
      startDate: addDays(now, -142).toISOString().slice(0, 10),
    });
    await Promise.all([
      dispatchBirthReminders(send, logger, now),
      dispatchBirthReminders(send, logger, now),
    ]);
    assert.equal(sent.length, 2);
    const message = sent.find((row) => row.userId === first.userId)!.message;
    assert.match(message.body, /Upcoming birth windows: 2/);
    assert.match(message.url, new RegExp(first.farmId));
    assert.ok([first.animalId, secondAnimal.body.id].some((id) => message.url.includes(id)));
    await dispatchBirthReminders(send, logger, addDays(now, 1));
    assert.equal(sent.length, 2, 'same pregnancy never repeats on a later day');
  });
});
test('births, revoked/expired membership and rejected accounts suppress scheduled delivery', async () => {
  await withServer(app(), async (url) => {
    const first = await fixture(url, 'one');
    const second = await fixture(url, 'two');
    const third = await fixture(url, 'three');
    const fourth = await fixture(url, 'four');
    await first.client.post(`/v1/farms/${first.farmId}/breeding/births`, {
      damId: first.animalId,
      date: now.toISOString().slice(0, 10),
      offspring: [{ sex: 'female', outcome: 'live' }],
    });
    await Membership.updateOne({ userId: second.userId }, { $set: { status: 'revoked' } });
    await Membership.updateOne({ userId: third.userId }, { $set: { expiresAt: addDays(now, -1) } });
    await User.updateOne({ _id: fourth.userId }, { $set: { status: 'rejected' } });
    await dispatchBirthReminders(send, logger, now);
    assert.equal(sent.length, 0);
  });
});
test('provider failures retry, expired endpoints are removed and disabled devices are skipped', async () => {
  await withServer(app(), async (url) => {
    const first = await fixture(url);
    const result = await dispatchBirthReminders(
      async () => {
        throw { statusCode: 503 };
      },
      logger,
      now,
    );
    assert.equal(result.failed, 1);
    assert.deepEqual((await PushSubscription.findOne().lean())?.notifiedKeys, []);
    await dispatchBirthReminders(send, logger, now);
    assert.equal(sent.length, 1);
    await first.client.post('/v1/notifications/disable', input());
    await dispatchBirthReminders(send, logger, now);
    assert.equal(sent.length, 1);
    await first.client.post('/v1/notifications/subscribe', input());
    assert.equal(
      (
        await dispatchBirthReminders(
          async () => {
            throw { statusCode: 410 };
          },
          logger,
          now,
        )
      ).expired,
      1,
    );
    assert.equal(await PushSubscription.countDocuments(), 0);
  });
});
test('farm timezone controls the date and changed pregnancy windows get a fresh reminder', async () => {
  await withServer(app(), async (url) => {
    const first = await fixture(url);
    const subscription = (await PushSubscription.findOne().lean())!;
    await Farm.updateOne({ _id: first.farmId }, { $set: { timezone: 'Asia/Hebron' } });
    assert.equal((await remindersFor(subscription, new Date('2026-10-17T21:30:00Z'))).length, 1);
    await dispatchBirthReminders(send, logger, now);
    await Animal.updateOne({ _id: first.animalId }, { $set: { 'repro.dueDate': addDays(now, 4) } });
    await dispatchBirthReminders(send, logger, now);
    assert.equal(sent.length, 2);
  });
});
test('test messages are rate limited and cron rejects missing or incorrect secrets', async () => {
  await withServer(app(), async (url) => {
    const { client } = await fixture(url);
    assert.equal((await client.post('/v1/notifications/test', input())).status, 200);
    assert.equal((await client.post('/v1/notifications/test', input())).status, 429);
    assert.equal((await api(url).get('/v1/cron/birth-reminders')).status, 401);
    assert.equal((await api(url, 'wrong').get('/v1/cron/birth-reminders')).status, 401);
    assert.equal((await api(url, config.CRON_SECRET).get('/v1/cron/birth-reminders')).status, 200);
  });
});

test('a full dispatch batch reports deferred devices even when expired endpoints were deleted', async () => {
  await withServer(app(), async (url) => {
    const { userId } = await fixture(url);
    await PushSubscription.insertMany(
      Array.from({ length: 500 }, (_, index) => {
        const data = input(`expired-${index}`);
        return { ...data, userId, endpointHash: endpointHash(data.endpoint) };
      }),
    );
    const result = await dispatchBirthReminders(
      async () => {
        throw { statusCode: 410 };
      },
      logger,
      now,
    );
    assert.equal(result.expired, 500);
    assert.equal(result.deferred, 1);
    assert.equal(await PushSubscription.countDocuments(), 1);
  });
});

test('multi-select settings round-trip, default to first day, and reject empty/duplicate choices', async () => {
  await withServer(app(), async (url) => {
    const { client } = await fixture(url);
    for (const reminderDays of [[], [1], [0, 0], [0, 3, 7, 7]])
      assert.equal(
        (await client.post('/v1/notifications/subscribe', { ...input(), reminderDays })).status,
        400,
      );
    const { leadDays: _legacy, ...fresh } = input();
    assert.equal((await client.post('/v1/notifications/subscribe', fresh)).status, 200);
    assert.deepEqual(
      (await client.post<{ reminderDays: number[] }>('/v1/notifications/status', input())).body
        .reminderDays,
      [0],
    );
    for (const reminderDays of [[3], [0, 7], [0, 3, 7]]) {
      await client.post('/v1/notifications/subscribe', { ...fresh, reminderDays });
      assert.deepEqual(
        (await client.post<{ reminderDays: number[] }>('/v1/notifications/status', input())).body
          .reminderDays,
        reminderDays,
      );
    }
  });
});
test('all three reminders deliver once on days 138, 142 and 145 without suppressing each other', async () => {
  await withServer(app(), async (url) => {
    const { client, animalId } = await fixture(url);
    await client.post('/v1/notifications/subscribe', { ...input(), reminderDays: [0, 3, 7] });
    await Animal.updateOne({ _id: animalId }, { $set: { 'repro.dueDate': addDays(now, 9) } }); // Today = day 138.
    for (const offset of [0, 4, 7]) {
      const day = addDays(now, offset);
      const before = sent.length;
      await dispatchBirthReminders(send, logger, day);
      assert.equal(sent.length, before + 1);
      await dispatchBirthReminders(send, logger, day);
      assert.equal(sent.length, before + 1);
    }
    assert.equal(new Set(sent.map((row) => row.message.tag)).size, 3);
    await dispatchBirthReminders(send, logger, addDays(now, 8));
    assert.equal(sent.length, 3);
  });
});
