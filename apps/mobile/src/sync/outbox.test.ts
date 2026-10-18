import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Outbox, isStuck } from './outbox.ts';
import { memoryStore, type KeyValueStore } from './storage.ts';

/**
 * The outbox is what stands between a herder and a lost birth record. These are the cases that
 * decide whether a fortnight of work in a pen with no signal survives.
 */

let store: KeyValueStore;
let outbox: Outbox;

const entry = (id: string, path = '/v1/x') => ({ id, path, body: { id } });

beforeEach(() => {
  store = memoryStore();
  outbox = new Outbox(store);
});

describe('queueing', () => {
  test('a queued write is held until it is removed', async () => {
    await outbox.enqueue(entry('a'));
    assert.equal((await outbox.pending()).length, 1);

    await outbox.remove('a');
    assert.equal((await outbox.pending()).length, 0);
  });

  test('order is preserved — records are sent in the order they happened', async () => {
    await outbox.enqueue(entry('a'));
    await outbox.enqueue(entry('b'));
    await outbox.enqueue(entry('c'));
    assert.deepEqual(
      (await outbox.pending()).map((e) => e.id),
      ['a', 'b', 'c'],
    );
  });

  test('re-queuing the same id replaces rather than duplicates', async () => {
    await outbox.enqueue({ id: 'a', path: '/v1/x', body: { kg: 20 } });
    await outbox.enqueue({ id: 'a', path: '/v1/x', body: { kg: 25 } });

    const pending = await outbox.pending();
    assert.equal(pending.length, 1, 'the id is the record’s identity');
    assert.deepEqual(pending[0]?.body, { kg: 25 });
  });

  test('the queue survives a restart', async () => {
    await outbox.enqueue(entry('a'));
    // A fresh instance over the same storage is what a relaunched app sees.
    const afterRestart = new Outbox(store);
    assert.equal((await afterRestart.pending()).length, 1);
  });
});

describe('failure handling', () => {
  test('a failure is counted and its reason kept', async () => {
    await outbox.enqueue(entry('a'));
    await outbox.recordFailure('a', 'network down');

    const [first] = await outbox.pending();
    assert.equal(first?.attempts, 1);
    assert.equal(first?.lastError, 'network down');
  });

  test('an entry becomes stuck after three failures, so a person can be told', async () => {
    await outbox.enqueue(entry('a'));
    for (let i = 0; i < 3; i += 1) await outbox.recordFailure('a', 'nope');

    const [first] = await outbox.pending();
    assert.equal(isStuck(first!), true);
  });

  test('even prolonged failures retain the original record', async () => {
    await outbox.enqueue(entry('a'));
    await outbox.enqueue(entry('b'));

    for (let i = 0; i < 8; i += 1) await outbox.recordFailure('a', 'rejected');

    const pending = await outbox.pending();
    assert.deepEqual(
      pending.map((e) => e.id),
      ['a', 'b'],
      'failed records remain available for recovery',
    );
  });

  test('failing one entry does not disturb the others', async () => {
    await outbox.enqueue(entry('a'));
    await outbox.enqueue(entry('b'));
    await outbox.recordFailure('a', 'nope');

    const pending = await outbox.pending();
    assert.equal(pending.find((e) => e.id === 'b')?.attempts, 0);
  });
});

describe('resilience', () => {
  test('a corrupt outbox is never overwritten silently', async () => {
    const corrupt = memoryStore({ 'nasl.outbox': '{not json' });
    const recovered = new Outbox(corrupt);
    await assert.rejects(recovered.enqueue(entry('a')));
    assert.equal(await corrupt.get('nasl.outbox'), '{not json');
  });

  test('concurrent saves cannot overwrite one another', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => outbox.enqueue(entry(String(i)))));
    assert.equal((await new Outbox(store).pending()).length, 20);
  });

  test('failed storage writes are not presented as saved', async () => {
    const failing = new Outbox({
      ...store,
      set: async () => {
        throw new Error('disk full');
      },
    });
    await assert.rejects(failing.enqueue(entry('a')), /disk full/);
    assert.equal((await failing.pending()).length, 0);
  });

  test('subscribers are told when the queue changes', async () => {
    const seen: number[] = [];
    outbox.subscribe((entries) => seen.push(entries.length));

    await outbox.enqueue(entry('a'));
    await outbox.enqueue(entry('b'));
    await outbox.remove('a');

    assert.deepEqual(seen.slice(-3), [1, 2, 1]);
  });

  test('unsubscribing stops the notifications', async () => {
    let calls = 0;
    const stop = outbox.subscribe(() => {
      calls += 1;
    });
    await outbox.enqueue(entry('a'));
    const before = calls;

    stop();
    await outbox.enqueue(entry('b'));
    assert.equal(calls, before, 'no further notifications after unsubscribing');
  });
});
