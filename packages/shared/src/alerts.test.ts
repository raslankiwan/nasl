import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAlerts, type AlertSubject } from './alerts.ts';

const TODAY = new Date('2026-06-01T00:00:00.000Z');
const plus = (days: number) =>
  new Date(TODAY.getTime() + days * 86_400_000).toISOString().slice(0, 10);

const ewe = (id: string, extra: Partial<AlertSubject> = {}): AlertSubject => ({
  id,
  tagNumber: id,
  species: 'sheep',
  sex: 'female',
  status: 'active',
  ...extra,
});

describe('deriving alerts', () => {
  test('a ewe inside the drop-pen window is due', () => {
    const alerts = deriveAlerts(
      [ewe('1001', { repro: { state: 'pregnant', dueDate: plus(10) } })],
      TODAY,
    );
    assert.equal(alerts.dueSoon.length, 1);
    assert.equal(alerts.dueSoon[0]?.days, 5);
    assert.equal(alerts.dueSoon[0]?.windowStart, plus(5));
    assert.equal(alerts.dueSoon[0]?.windowEnd, plus(13));
    assert.equal(alerts.overdue.length, 0);
  });

  test('a ewe still well short of her date raises nothing', () => {
    const alerts = deriveAlerts(
      [ewe('1001', { repro: { state: 'pregnant', dueDate: plus(60) } })],
      TODAY,
    );
    assert.equal(alerts.dueSoon.length, 0);
  });

  test('a ewe past the final day of her window is overdue', () => {
    const alerts = deriveAlerts(
      [ewe('1001', { repro: { state: 'due', dueDate: plus(-4) } })],
      TODAY,
    );
    assert.equal(alerts.overdue.length, 1);
    assert.equal(alerts.overdue[0]?.days, -1);
    assert.equal(alerts.dueSoon.length, 0);
  });

  test('the entire inclusive 142–150-day window is due, never overdue', () => {
    for (const gestation of [142, 143, 147, 148, 149, 150]) {
      const alerts = deriveAlerts(
        [ewe('1001', { repro: { state: 'mated', dueDate: plus(147 - gestation) } })],
        TODAY,
      );
      assert.equal(alerts.overdue.length, 0, `day ${gestation}`);
      assert.equal(alerts.dueSoon[0]?.days, 0, `day ${gestation}`);
    }
    const before = deriveAlerts(
      [ewe('1001', { repro: { state: 'pregnant', dueDate: plus(6) } })],
      TODAY,
    );
    assert.equal(before.dueSoon[0]?.days, 1, 'day 141: one day to the window');
  });

  test('resolved pregnancies leave both lists even if an old due date remains', () => {
    for (const state of ['open', 'aborted', 'lambed', 'nursing', 'weaned']) {
      const alerts = deriveAlerts([ewe('1001', { repro: { state, dueDate: plus(-1) } })], TODAY);
      assert.equal(alerts.dueSoon.length + alerts.overdue.length, 0, state);
    }
  });

  test('the soonest comes first', () => {
    const alerts = deriveAlerts(
      [
        ewe('a', { repro: { state: 'pregnant', dueDate: plus(12) } }),
        ewe('b', { repro: { state: 'pregnant', dueDate: plus(2) } }),
      ],
      TODAY,
    );
    assert.deepEqual(
      alerts.dueSoon.map((d) => d.animalId),
      ['b', 'a'],
    );
  });

  test('a sold or dead animal raises nothing', () => {
    const alerts = deriveAlerts(
      [
        ewe('1001', { status: 'sold', repro: { state: 'due', dueDate: plus(1) } }),
        ewe('1002', { status: 'dead', withholdMilkUntil: plus(5) }),
      ],
      TODAY,
    );
    assert.equal(alerts.dueSoon.length, 0);
    assert.equal(alerts.milkWithheld.length, 0);
  });

  test('milk and meat holds are counted separately', () => {
    const alerts = deriveAlerts(
      [
        ewe('1001', { withholdMilkUntil: plus(3), withholdMeatUntil: plus(20) }),
        ewe('1002', { withholdMeatUntil: plus(9) }),
      ],
      TODAY,
    );
    assert.equal(alerts.milkWithheld.length, 1);
    assert.equal(alerts.meatWithheld.length, 2);
    assert.equal(alerts.milkWithheld[0]?.daysLeft, 3);
  });

  test('the final day of a hold is still a hold', () => {
    const today = deriveAlerts([ewe('1001', { withholdMilkUntil: plus(0) })], TODAY);
    assert.equal(today.milkWithheld.length, 1, 'today is the last restricted day');

    const yesterday = deriveAlerts([ewe('1001', { withholdMilkUntil: plus(-1) })], TODAY);
    assert.equal(yesterday.milkWithheld.length, 0);
  });

  test('nursing ewes are counted', () => {
    const alerts = deriveAlerts(
      [ewe('a', { repro: { state: 'nursing' } }), ewe('b', { repro: { state: 'nursing' } })],
      TODAY,
    );
    assert.equal(alerts.nursing, 2);
  });

  test('a ram with a due date somehow set raises nothing', () => {
    const alerts = deriveAlerts(
      [ewe('3001', { sex: 'male', repro: { state: 'pregnant', dueDate: plus(5) } })],
      TODAY,
    );
    assert.equal(alerts.dueSoon.length, 0);
  });

  test('goats use their own gestation window', () => {
    const goat = ewe('5001', {
      species: 'goat',
      repro: { state: 'pregnant', dueDate: plus(13) },
    });
    assert.equal(deriveAlerts([goat], TODAY).dueSoon.length, 1);
  });

  test('an unparseable date is ignored rather than crashing the list', () => {
    const alerts = deriveAlerts(
      [ewe('1001', { repro: { state: 'pregnant', dueDate: 'not a date' } })],
      TODAY,
    );
    assert.equal(alerts.dueSoon.length, 0);
    assert.equal(alerts.overdue.length, 0);
  });
});
