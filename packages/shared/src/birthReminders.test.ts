import { test } from 'node:test';
import assert from 'node:assert/strict';
import { birthReminders } from './birthReminders.ts';
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
test('default reminder starts on day 139, three days before day 142; day 142 catches up', () => {
  assert.equal(birthReminders([ewe], addDays(mating, 138)).length, 0);
  for (const day of [139, 140, 141, 142]) {
    const [reminder] = birthReminders([ewe], addDays(mating, day));
    assert.equal(reminder?.daysUntilWindow, 142 - day);
    assert.equal(reminder?.windowStart, addDays(mating, 142).toISOString().slice(0, 10));
    assert.equal(reminder?.windowEnd, addDays(mating, 150).toISOString().slice(0, 10));
    assert.equal(reminder?.tagNumber, '001');
  }
  assert.equal(birthReminders([ewe], addDays(mating, 143)).length, 0);
});
test('custom lead times and goats use their own expected date', () => {
  assert.equal(birthReminders([ewe], addDays(mating, 135), 7).length, 1);
  assert.equal(birthReminders([ewe], addDays(mating, 140), 1).length, 0);
  const goat = {
    ...ewe,
    species: 'goat',
    repro: { state: 'mated', dueDate: expectedDueDate(mating, 'goat') },
  };
  assert.equal(birthReminders([goat], addDays(mating, 147))[0]?.daysUntilWindow, 3);
});
test('resolved pregnancies, inactive animals, missing and invalid dates never notify', () => {
  for (const state of ['open', 'nursing', 'barren', 'aborted'])
    assert.equal(
      birthReminders([{ ...ewe, repro: { ...ewe.repro, state } }], addDays(mating, 139)).length,
      0,
    );
  for (const animal of [
    { ...ewe, status: 'sold' },
    { ...ewe, sex: 'male' },
    { ...ewe, repro: null },
    { ...ewe, repro: { state: 'pregnant', dueDate: 'invalid' } },
  ])
    assert.equal(birthReminders([animal], addDays(mating, 139)).length, 0);
});
