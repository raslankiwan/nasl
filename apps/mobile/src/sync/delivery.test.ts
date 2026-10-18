import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../api/sessionClient.ts';
import { Delivery } from './delivery.ts';
import { Outbox } from './outbox.ts';
import { memoryStore } from './storage.ts';
const saved = { id: 'one', userId: 'alice', path: '/v1/farms/a/weights', body: { kg: 20 } };

test('writes to durable storage before attempting the network', async () => {
  const outbox = new Outbox(memoryStore());
  const delivery = new Delivery(
    outbox,
    async () => {
      assert.equal((await outbox.pending()).length, 1);
    },
    () => true,
  );
  assert.equal(await delivery.send(saved), true);
  assert.equal((await outbox.pending()).length, 0);
});
test('offline saves survive many retries and a restart, then send once', async () => {
  const store = memoryStore();
  const outbox = new Outbox(store);
  let offline = true;
  let received = 0;
  const post = async () => {
    if (offline) throw new TypeError('offline');
    received++;
  };
  const delivery = new Delivery(outbox, post, () => true);
  assert.equal(await delivery.send(saved), false);
  for (let i = 0; i < 12; i++) await delivery.flush();
  assert.equal((await new Outbox(store).pending()).length, 1);
  offline = false;
  await new Delivery(new Outbox(store), post, () => true).flush();
  assert.equal(received, 1);
  assert.equal((await new Outbox(store).pending()).length, 0);
});
test('server outages retain records; invalid records pause without blocking later entries', async () => {
  const outbox = new Outbox(memoryStore());
  await outbox.enqueue(saved);
  await outbox.enqueue({ ...saved, id: 'two' });
  const sent: string[] = [];
  const delivery = new Delivery(
    outbox,
    async (entry) => {
      if (entry.id === 'one') throw new ApiError(400, null);
      sent.push(entry.id);
    },
    () => true,
  );
  await delivery.flush();
  await delivery.flush();
  assert.deepEqual(sent, ['two']);
  assert.equal((await outbox.pending())[0]?.blocked, true);
});
test('signed-out users and other accounts never flush someone else’s work', async () => {
  const outbox = new Outbox(memoryStore());
  await outbox.enqueue(saved);
  let user: string | null = null;
  let sent = 0;
  const delivery = new Delivery(
    outbox,
    async () => {
      sent++;
    },
    (entry) => entry.userId === user,
  );
  await delivery.flush();
  user = 'bob';
  await delivery.flush();
  assert.equal(sent, 0);
  user = 'alice';
  await delivery.flush();
  assert.equal(sent, 1);
});
test('legacy records require an explicit claim limited to accessible farms', async () => {
  const outbox = new Outbox(memoryStore());
  await outbox.enqueue({ ...saved, userId: undefined });
  await outbox.enqueue({ ...saved, id: 'two', path: '/v1/farms/b/weights', userId: undefined });
  await outbox.claimLegacy('alice', (path) => path.startsWith('/v1/farms/a/'));
  assert.deepEqual(
    (await outbox.pending()).map((e) => e.userId),
    ['alice', undefined],
  );
});
test('a full disk prevents a network attempt and reports the failure', async () => {
  const outbox = new Outbox({
    ...memoryStore(),
    set: async () => {
      throw new Error('disk full');
    },
  });
  const delivery = new Delivery(
    outbox,
    async () => {
      assert.fail('must not post');
    },
    () => true,
  );
  await assert.rejects(delivery.send(saved), /disk full/);
});
