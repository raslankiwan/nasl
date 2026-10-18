import { test } from 'node:test';
import assert from 'node:assert/strict';
import { birthReminderDays, birthReminders } from './birthReminders.ts';
import { addDays } from './dates.ts';
import { expectedDueDate } from './repro.ts';
import type { AlertSubject } from './alerts.ts';
const mating = new Date('2026-01-01');
const ewe: AlertSubject = {
  id: 'ewe',
  tagNumber: '001',
  status: 'active',
  sex: 'female',
  species: 'sheep',
  repro: { state: 'pregnant', dueDate: expectedDueDate(mating, 'sheep') },
};
test('the first day is the default, with the inclusive 145–152-day sheep window', () => {
  assert.equal(birthReminders([ewe], addDays(mating, 144)).length, 0);
  const [reminder] = birthReminders([ewe], addDays(mating, 145));
  assert.equal(reminder?.daysUntilWindow, 0);
  assert.equal(reminder?.reminderDays, 0);
  assert.equal(reminder?.windowStart, addDays(mating, 145).toISOString().slice(0, 10));
  assert.equal(reminder?.windowEnd, addDays(mating, 152).toISOString().slice(0, 10));
  assert.equal(birthReminders([ewe], addDays(mating, 146)).length, 0);
});
test('each chosen milestone becomes independently eligible and catches up until the next', () => {
  for (const selected of [[0], [3], [7], [0, 3], [0, 7], [3, 7], [0, 3, 7]]) {
    for (let day = 137; day <= 146; day++) {
      const remaining = 145 - day;
      const expected =
        remaining < 0
          ? undefined
          : [...selected].sort((a, b) => a - b).find((lead) => lead >= remaining);
      const rows = birthReminders([ewe], addDays(mating, day), selected);
      assert.equal(rows.length, expected === undefined ? 0 : 1, `${selected} on day ${day}`);
      assert.equal(rows[0]?.reminderDays, expected);
    }
  }
  assert.equal(birthReminders([ewe], addDays(mating, 145), []).length, 0);
});
test('goats retain their own date with the same reminder choices', () => {
  const goat = {
    ...ewe,
    species: 'goat',
    repro: { state: 'mated', dueDate: expectedDueDate(mating, 'goat') },
  };
  assert.equal(birthReminders([goat], addDays(mating, 147), [3])[0]?.daysUntilWindow, 3);
  assert.equal(birthReminders([goat], addDays(mating, 150))[0]?.reminderDays, 0);
});
test('new settings default to day zero and legacy preferences retain supported lead times', () => {
  assert.deepEqual(birthReminderDays(), [0]);
  assert.deepEqual(birthReminderDays(undefined, 1), [0]);
  assert.deepEqual(birthReminderDays(undefined, 3), [0, 3]);
  assert.deepEqual(birthReminderDays(undefined, 7), [0, 7]);
  assert.deepEqual(birthReminderDays([7, 0, 3]), [0, 3, 7]);
  assert.deepEqual(birthReminderDays([7]), [7]);
});
test('resolved pregnancies, inactive animals, missing and invalid dates never notify', () => {
  for (const state of ['open', 'nursing', 'barren', 'aborted'])
    assert.equal(
      birthReminders([{ ...ewe, repro: { ...ewe.repro, state } }], addDays(mating, 145)).length,
      0,
    );
  for (const animal of [
    { ...ewe, status: 'sold' },
    { ...ewe, sex: 'male' },
    { ...ewe, repro: null },
    { ...ewe, repro: { state: 'pregnant', dueDate: 'invalid' } },
  ])
    assert.equal(birthReminders([animal], addDays(mating, 145)).length, 0);
});
