import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWithdrawal, withdrawalFor } from './health.ts';
import { isUnderMeatWithdrawal } from './animal.ts';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('withdrawal periods', () => {
  test('a treatment sets meat and milk withhold dates', () => {
    const w = withdrawalFor({ withdrawalMeatDays: 28, withdrawalMilkDays: 7 }, d('2026-03-01'));
    assert.equal(w.meatUntil, '2026-03-29');
    assert.equal(w.milkUntil, '2026-03-08');
  });

  test('a zero-day period imposes no restriction', () => {
    const w = withdrawalFor({ withdrawalMeatDays: 0, withdrawalMilkDays: 0 }, d('2026-03-01'));
    assert.deepEqual(w, {});
  });

  test('overlapping treatments always widen, never shorten', () => {
    const first = withdrawalFor({ withdrawalMeatDays: 28, withdrawalMilkDays: 0 }, d('2026-03-01'));
    const second = withdrawalFor({ withdrawalMeatDays: 5, withdrawalMilkDays: 3 }, d('2026-03-10'));
    const merged = mergeWithdrawal(first, second);
    assert.equal(merged.meatUntil, '2026-03-29', 'keeps the later meat date');
    assert.equal(merged.milkUntil, '2026-03-13', 'adopts the milk date the first treatment lacked');
  });

  test('an animal is restricted through the final day of the period', () => {
    const animal = { withholdMeatUntil: '2026-03-29' };
    assert.equal(isUnderMeatWithdrawal(animal, d('2026-03-29')), true);
    assert.equal(isUnderMeatWithdrawal(animal, d('2026-03-30')), false);
  });
});
