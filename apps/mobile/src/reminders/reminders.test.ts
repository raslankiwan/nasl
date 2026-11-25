import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../sync/storage.ts';
import { MAX_REMINDER_LENGTH, openReminders, ReminderStore } from './reminders.ts';

const now = new Date('2026-11-25T10:00:00.000Z');

describe('ReminderStore', () => {
  test('adds, completes and removes a reminder', async () => {
    const reminders = new ReminderStore(memoryStore());
    await reminders.add('u1', 'f1', { id: 'a', text: '  Call the vet  ', dueDate: null, now });
    let list = await reminders.list('u1', 'f1');
    assert.equal(list.length, 1);
    assert.equal(list[0]!.text, 'Call the vet');
    assert.equal(list[0]!.done, false);

    list = await reminders.setDone('u1', 'f1', 'a', true);
    assert.equal(list[0]!.done, true);

    list = await reminders.remove('u1', 'f1', 'a');
    assert.deepEqual(list, []);
  });

  test('keeps each person and each farm apart', async () => {
    const store = memoryStore();
    const reminders = new ReminderStore(store);
    await reminders.add('u1', 'f1', { id: 'a', text: 'mine', dueDate: null, now });
    assert.deepEqual(await reminders.list('u2', 'f1'), []);
    assert.deepEqual(await reminders.list('u1', 'f2'), []);
  });

  test('ignores blank text and caps a long note', async () => {
    const reminders = new ReminderStore(memoryStore());
    assert.deepEqual(
      await reminders.add('u', 'f', { id: 'a', text: '   ', dueDate: null, now }),
      [],
    );
    const [long] = await reminders.add('u', 'f', {
      id: 'b',
      text: 'x'.repeat(MAX_REMINDER_LENGTH + 50),
      dueDate: null,
      now,
    });
    assert.equal(long!.text.length, MAX_REMINDER_LENGTH);
  });

  test('changes made at the same moment all land', async () => {
    const reminders = new ReminderStore(memoryStore());
    await reminders.add('u', 'f', { id: 'a', text: 'one', dueDate: null, now });
    await reminders.add('u', 'f', { id: 'b', text: 'two', dueDate: null, now });
    await Promise.all([
      reminders.setDone('u', 'f', 'a', true),
      reminders.setDone('u', 'f', 'b', true),
      reminders.add('u', 'f', { id: 'c', text: 'three', dueDate: null, now }),
    ]);
    const list = await reminders.list('u', 'f');
    assert.deepEqual(
      list.map((r) => [r.id, r.done]),
      [
        ['a', true],
        ['b', true],
        ['c', false],
      ],
    );
  });

  test('a corrupt entry reads as empty rather than throwing', async () => {
    const reminders = new ReminderStore(memoryStore({ 'nasl.reminders.u.f': '{not json' }));
    assert.deepEqual(await reminders.list('u', 'f'), []);
  });
});

describe('openReminders', () => {
  test('dated first by date, then undated newest first, done hidden', () => {
    const base = { done: false, text: 't' };
    const ordered = openReminders([
      { ...base, id: 'note-old', dueDate: null, createdAt: '2026-11-01T00:00:00Z' },
      { ...base, id: 'later', dueDate: '2026-12-01', createdAt: '2026-11-02T00:00:00Z' },
      { ...base, id: 'done', dueDate: '2026-11-01', createdAt: '2026-11-02T00:00:00Z', done: true },
      { ...base, id: 'late', dueDate: '2026-11-20', createdAt: '2026-11-03T00:00:00Z' },
      { ...base, id: 'note-new', dueDate: null, createdAt: '2026-11-04T00:00:00Z' },
    ]);
    assert.deepEqual(
      ordered.map((r) => r.id),
      ['late', 'later', 'note-new', 'note-old'],
    );
  });
});
